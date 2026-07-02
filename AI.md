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

### 3. Nút "⚡ Áp dụng & deploy lại"
AI đề xuất sửa 1 trường config (`configField`/`configValue`) → bấm nút ở card chẩn đoán:
xác nhận → PATCH project → deploy lại → chuyển sang trang bản deploy mới. Khép kín vòng
fail → chẩn đoán → sửa → redeploy.
- Whitelist 7 trường (`installCommand/buildCommand/startCommand/outputDir/internalPort/rootDir/artifactPath`), `internalPort` ép kiểu + validate, đúng RBAC (chỉ OWNER)
- Đã test live bằng Gemini (`gemini-2.5-flash`): chẩn đoán đúng bệnh, PATCH 200

### 4. Chẩn đoán AI tự động + gửi Telegram khi deploy fail
Deploy fail → tin ❌ fail đi NGAY → AI chẩn đoán nền (không chặn luồng) → lưu
`aiDiagnosis` vào DB (mở web là có sẵn, không gọi AI lại) → gửi tin 🤖 bổ sung
(nguyên nhân + cách sửa + gợi ý config) tới nhóm + các thành viên đã nối Telegram.
- Fail lúc nửa đêm (auto-deploy) cũng có chẩn đoán chờ sẵn
- Best-effort: AI lỗi/tắt flag/thiếu key → im lặng bỏ qua, không ảnh hưởng deploy
- Đã test live: deploy fail thật → ~10s sau aiDiagnosis tự lưu + tin Telegram đi

### 5. ✨ Tự nhận diện cấu hình khi tạo project
Form tạo project: nhập repo URL → nút "✨ Tự nhận diện cấu hình (AI)" → clone nông →
AI đọc cây file + file chìa khóa (`package.json`, `pubspec.yaml`, `build.gradle`,
`.env.example`, Dockerfile…) → tự điền: loại project, rootDir, lệnh build/start/install,
port, buildImage, artifactPath + cảnh báo biến env app cần.
- Endpoint: `POST /git/analyze` · `GitService.snapshotRepo()` + `AiService.analyzeRepo()`
- Prompt chống placeholder ("không bịa giá trị"), chống bịa Docker image
- Đã test live: repo Flutter multi-flavor (nhận ra `--flavor prod -t lib/main_prod.dart`,
  đường dẫn AAB đúng flavor) + repo NestJS (build/start:prod/port 3000) — đều chính xác

### 6. 🔥 Watchdog + bác sĩ lỗi runtime (app đang chạy bị crash)
`HostRunReconcilerService` nâng từ "chỉ chạy lúc boot" thành watchdog quét mỗi 60s
cho app host-run (useDocker=false):
- App chết → **đọc đuôi runtime log trước** (restart sẽ ghi đè log) → tự khởi động lại
  → AI chẩn đoán nền → lưu `aiDiagnosis` + gửi Telegram 🔥 (crash lần mấy, nguyên nhân, cách sửa)
- Chống crash-loop: chết >3 lần / 10 phút → DỪNG hẳn (STOPPED) + báo "sửa lỗi rồi deploy lại"
- Chống spam AI: cùng chữ ký lỗi (đuôi log giống nhau) → không gọi AI lại
- Đã test live: kill -9 process thật → watchdog bắt trong ≤60s, restart OK, đếm crash
  đúng (lần 2/3), aiDiagnosis lưu vào DB, tin Telegram đi không lỗi

### 8. 🩺 Smoke test sau deploy
Deploy BACKEND báo "thành công" chưa chắc app sống — smoke test gọi thử app thật
(tối đa 7 lần / ~20s) sau khi RUNNING:
- App trả lời (HTTP < 500, kể cả 404) → ghi "🩺 Smoke test OK" vào build log
- Trả 5xx / không trả lời → lấy runtime log (host file / `docker logs`) → AI chẩn đoán
  → lưu `errorMessage` + `aiDiagnosis` vào deployment + gửi Telegram 🩺 cảnh báo
- Chạy nền best-effort, không ảnh hưởng kết quả deploy; kết hợp watchdog tự cứu app
- Đã test live cả 2 đường: deploy thật → "Smoke test OK (HTTP 404)"; kill app ngay sau
  RUNNING → phát hiện "KHÔNG trả lời sau ~20s", AI chẩn đoán + Telegram + watchdog cứu lại

### 7. 💬 Hỏi đáp AI qua Telegram
Nhắn bot `@loipham_deploybox_bot` (chat riêng, hoặc nhắc @bot trong nhóm) → bot nhận diện
qua chat_id đã nối → lấy dữ liệu project **user có quyền xem** (OWNER: tất cả; MEMBER:
project được cấp) → AI trả lời dựa trên trạng thái/lỗi/chẩn đoán thật.
- Lệnh: `/status` (trạng thái project, không tốn AI), `/help`; còn lại là hỏi tự do
- Bảo mật: chưa nối tài khoản → từ chối; không lộ env/token; rate-limit 10s/câu/người
- `AiService.answer()` — dùng chung provider đã chọn ở Admin

---

## 🗺️ Lộ trình chính: ✅ ĐÃ XONG 8/8
Việc tiếp theo lấy từ Backlog + Ý tưởng vòng 2 bên dưới.
Gợi ý thứ tự: Báo cáo tuần → Tóm tắt log → Sinh Dockerfile → Rollback thông minh.

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

## 💡 Ý tưởng vòng 2 (brainstorm — chưa cam kết làm)

### Chất lượng deploy
| Ý tưởng | Mô tả | Cỡ |
|---|---|---|
| ~~Smoke test sau deploy~~ | ✅ ĐÃ LÀM — xem mục 8 phần "Đã làm" | — |
| **Rollback thông minh** 🌟 | Bản mới crash liên tục (watchdog đã đếm) / smoke fail → AI so với bản trước → đề xuất (hoặc tự động) rollback về bản ổn định gần nhất, báo Telegram | Vừa |
| **Gác cổng migration nguy hiểm** | Phát hiện lệnh phá dữ liệu trong build (`prisma migrate reset`, `--force`, `DROP TABLE`…) → chặn lại hỏi xác nhận trước khi chạy | Nhỏ |
| **Auto-deploy có não** | Webhook git push → AI đọc commit/diff: chỉ đổi docs/README → bỏ qua không deploy; đổi schema DB → cảnh báo trước khi deploy | Nhỏ |

### Bảo mật (bài học thật: bot token từng bị lộ)
| Ý tưởng | Mô tả | Cỡ |
|---|---|---|
| **Quét secret lộ** 🌟 | Lúc analyze/deploy: quét repo phát hiện `.env` commit nhầm, API key/token nằm trong code → cảnh báo đỏ ngay | Nhỏ |
| **Kiểm tra env trước deploy** | So env đã khai trong DeployBox vs env app cần (Ưu tiên 3 đã đọc được `envKeys`) → thiếu biến nào báo TRƯỚC khi deploy thay vì để fail | Nhỏ |
| **Che secret trong log** | Phát hiện + tự che token/password lỡ in ra build log trước khi hiện/gửi AI | Nhỏ |

### Vận hành & giám sát
| Ý tưởng | Mô tả | Cỡ |
|---|---|---|
| **Cảnh báo sớm trước khi crash** | Theo dõi runtime log realtime: tần suất dòng error tăng vọt / OOM warning → báo Telegram TRƯỚC khi app chết hẳn | Vừa |
| **Gợi ý giờ ngủ/thức** | Phân tích lịch sử wake của SleepService → gợi ý bật sleep app nào, giờ nào (tiết kiệm RAM máy) | Nhỏ |
| **Chọn server phù hợp** | Nhiều server: AI gợi ý deploy app mới lên server nào dựa trên tải hiện tại | Nhỏ |

### Trải nghiệm
| Ý tưởng | Mô tả | Cỡ |
|---|---|---|
| **Gửi ảnh lỗi cho bot Telegram** | Chụp màn hình lỗi gửi bot → AI đọc ảnh (multimodal) chẩn đoán luôn — hợp khi đang ngoài đường không mở được máy | Vừa |
| **Chế độ "giải thích cho người mới"** | Toggle: chẩn đoán lỗi viết kiểu kỹ sư ⇄ kiểu dễ hiểu cho người không rành backend | Nhỏ |
| **AI sinh file CI** | Sinh sẵn GitHub Actions workflow gọi webhook deploy của project (copy-paste là chạy) | Nhỏ |
| **Onboarding bằng chat** | User mới được AI dẫn từng bước: nối repo → config → deploy đầu tiên | Lớn |

> 🌟 = đáng làm nhất trong nhóm. Ý tưởng nào "lên lịch" thì chuyển sang Backlog / lộ trình.

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
