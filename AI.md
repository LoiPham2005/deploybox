# DeployBox — Kế hoạch tính năng AI

> Tài liệu tổng hợp lộ trình AI của DeployBox: đã làm gì, sắp làm gì, làm như thế nào.
> Cập nhật lần cuối: 02/07/2026

---

## Kiến trúc AI hiện tại (đã xây xong)

- **`AiService` đa nhà cung cấp** (`apps/api/src/infra/ai/`):
  - 3 adapter: `AnthropicProvider` (Claude) · `OpenaiProvider` (ChatGPT) · `GeminiProvider` (Gemini)
  - Cùng 1 interface `LlmProvider.complete()` → trả JSON đúng schema (structured output)
  - Muốn thêm nhà mới (vd Grok, DeepSeek): viết 1 adapter + đăng ký vào `AiModule` là xong
- **Admin chọn provider + model dùng toàn app** — lưu DB (bảng `Setting`, key `ai_provider`/`ai_model`), đổi lúc nào cũng được, không cần redeploy. UI: Admin → card "AI — nhà cung cấp & model"
- **Bật/tắt tổng** bằng feature flag `ai_features` (Admin → Tính năng hệ thống)
- **API key** đặt trong `.env` (nhà nào có key thì dùng được nhà đó):
  ```
  ANTHROPIC_API_KEY=   # Claude    — console.anthropic.com   (sk-ant-api03-...)
  OPENAI_API_KEY=      # ChatGPT   — platform.openai.com     (sk-...)
  GEMINI_API_KEY=      # Gemini    — aistudio.google.com     (AIza...)
  ```
  Đổi `.env` xong: `pm2 restart deploybox-api --update-env`

---

## ✅ Đã làm

### 1. Bác sĩ lỗi deploy 🩺
Deploy **FAILED** → mở trang deployment → card "🤖 AI chẩn đoán lỗi" tự chạy 1 lần:
- AI đọc build log (phần cuối) + cấu hình project → trả về: **nguyên nhân · cách sửa · lệnh cần chạy · trường config nên đổi** (`configField`/`configValue`) + mức tự tin
- Kết quả **cache vào DB** (`Deployment.aiDiagnosis`) — mở lại không gọi AI nữa; có nút "Chẩn đoán lại"
- Chỉ gọi khi deploy fail → chi phí thấp
- Endpoint: `POST /api/v1/deployments/:id/diagnose`

### 2. Đa nhà cung cấp + Admin chọn model
Như mô tả ở phần Kiến trúc. Đã test thật: lưu/đổi provider, persist, chặn provider sai (400).

---

## 🗺️ Lộ trình tiếp theo (xếp theo ưu tiên)

### Ưu tiên 1 — Nút "Áp dụng cách sửa & deploy lại" ⭐ (~1 buổi)
Bác sĩ lỗi đã trả về `configField` + `configValue` (vd `buildCommand = npx prisma generate && npm run build`).
- Thêm nút ở card chẩn đoán: bấm → `PATCH /projects/:id` với giá trị AI đề xuất → tự `POST /deploy` lại
- Biến "AI chỉ cách sửa" thành "AI sửa luôn" — khép kín vòng fail → fix → redeploy
- Việc: 1 server action + 1 nút UI (backend có sẵn hết)

### Ưu tiên 2 — Đính kèm chẩn đoán AI vào tin Telegram khi fail (~vài giờ)
Hiện tin nhắn fail chỉ có errorMessage thô.
- Trong `build.runner.service.ts` chỗ deploy fail: gọi `ai.tryDiagnose()` (best-effort, không chặn) → thêm 2 dòng "Nguyên nhân / Cách sửa" vào tin Telegram
- Lưu luôn kết quả vào `aiDiagnosis` → mở web đã có sẵn chẩn đoán, khỏi gọi lại
- Lưu ý: gọi AI nền làm chậm thông báo vài giây → gửi tin fail trước, gửi tin chẩn đoán bổ sung sau

### Ưu tiên 3 — Tự nhận diện cấu hình khi tạo project
Diệt tận gốc nguyên nhân fail (config sai).
- Lúc tạo project (đã có module `git` + token): clone nông / đọc `package.json` + cây thư mục → AI đoán: loại project (STATIC/BACKEND), installCommand, buildCommand, startCommand, internalPort, outputDir, env cần có
- UI: nút "✨ Tự nhận diện" ở form tạo project → điền sẵn các ô, user xem lại rồi bấm tạo
- Endpoint mới: `POST /git/analyze` (nhận repoUrl + token) hoặc phân tích sau khi tạo

### Ưu tiên 4 — Bác sĩ lỗi runtime (app đang chạy bị crash)
Phủ nốt nửa còn lại: build OK nhưng chạy thì chết.
- Đã có: runtime log stream + `host-run-reconciler` phát hiện process chết
- Thêm: app crash / restart liên tục → lấy đuôi runtime log → `AiService.diagnose` → thông báo "app X crash vì thiếu env DATABASE_URL"
- Chống spam: chỉ chẩn đoán lại khi "chữ ký lỗi" thay đổi

### Ưu tiên 5 — Hỏi đáp AI qua Telegram
Bot `@loipham_deploybox_bot` đang long-poll sẵn (`telegram-link.service.ts`).
- Nhắn bot *"vì sao sports-booking-web fail?"* → bot tìm deployment gần nhất của user (đã link chat_id) → trả lời bằng chẩn đoán
- Cần: map chat_id → user → project được phép xem (bảo mật theo đúng quyền hiện có)

---

## 📦 Backlog (làm sau, chưa xếp lịch)

| Tính năng | Mô tả | Cỡ |
|---|---|---|
| Báo cáo tuần/ngày qua Telegram | Cron tổng hợp: số deploy, tỉ lệ fail, app hay crash, gợi ý sửa | Vừa |
| Sinh Dockerfile tự động | BACKEND `useDocker=true` mà repo không có Dockerfile → AI sinh (multi-stage, đúng port) | Vừa |
| Chẩn đoán domain/DNS | Domain kẹt PENDING_DNS/FAILED → hướng dẫn trỏ record cụ thể | Vừa |
| Tóm tắt build log dài | Log 2000 dòng → 5 dòng diễn biến (dùng model rẻ: Haiku / gemini-flash) | Nhỏ |
| Copilot chat trong dashboard | Chat hỏi về project của mình, AI gọi API nội bộ (tool use) để trả lời/thao tác | Lớn |
| Release notes tự động | Tóm tắt commit giữa 2 bản deploy thành changelog | Nhỏ |
| Gợi ý tối ưu vận hành | "App restart 5 lần → có thể thiếu RAM, tăng memoryMb" | Vừa |

---

## Nguyên tắc khi thêm tính năng AI mới

1. **Dùng lại `AiService`** — không gọi SDK trực tiếp trong module khác; cần khuôn JSON mới thì thêm method + schema mới vào `AiService`
2. **Structured output** — luôn ép JSON schema, có hàm `coerce()` chuẩn hoá, không tin đầu ra thô
3. **Cache kết quả** — lưu DB theo đối tượng (deployment/project), tránh gọi lại cho cùng 1 input
4. **Best-effort ở đường nền** — chỗ chạy nền (notify, webhook) dùng `tryDiagnose()` (trả null khi lỗi), không được làm fail luồng chính
5. **Feature flag** — tính năng AI mới nên có flag riêng hoặc dùng chung `ai_features`, admin tắt được ngay
6. **Chọn model theo việc** — việc rẻ & nhiều (tóm tắt, parse) → Haiku/gemini-flash/gpt-4o-mini; việc khó (chẩn đoán, sinh code) → Opus/Sonnet/gpt-4o
7. **Cắt log trước khi gửi** — giữ phần cuối (~12k ký tự), lỗi thường nằm ở cuối; tiết kiệm token
8. **Không lộ secret** — không bao giờ đưa env values, token, key vào prompt

---

## Chi phí tham khảo (giá / 1 triệu token)

| Model | Input | Output | Dùng cho |
|---|---|---|---|
| claude-opus-4-8 | $5 | $25 | Chẩn đoán khó, sinh code |
| claude-sonnet-5 | $3 | $15 | Cân bằng — mặc định tốt |
| claude-haiku-4-5 | $1 | $5 | Tóm tắt, parse, việc nhiều lượt |
| gpt-4o / gpt-4o-mini | ~$2.5 / ~$0.15 | ~$10 / ~$0.6 | Thay thế tương đương |
| gemini-2.0-flash | rất rẻ | rất rẻ | Tóm tắt, việc khối lượng lớn |

Một lần chẩn đoán lỗi ≈ 5–15k token input + ~500 token output → **dưới ~$0.1/lần với Opus, không đáng kể với Haiku/flash**. Chỉ gọi khi fail + có cache nên chi phí tháng rất thấp.
