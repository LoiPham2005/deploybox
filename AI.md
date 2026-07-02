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
- **Bật/tắt từng tính năng + nút tổng** (Admin → Tính năng hệ thống):
  - `ai_features` = **NÚT TỔNG** — tắt là tắt TOÀN BỘ AI (trạng thái nút con vẫn giữ)
  - 11 nút con (mặc định BẬT): `ai_diagnosis` (bác sĩ lỗi + nút áp dụng) · `ai_auto_diagnosis`
    (chẩn đoán tự động khi fail) · `ai_repo_analyze` (tự nhận diện) · `ai_env_check` ·
    `ai_secret_scan` · `ai_log_summary` · `ai_watchdog_diagnosis` (watchdog vẫn luôn restart) ·
    `ai_smoke_test` · `ai_auto_rollback` · `ai_telegram_qa` · `ai_daily_report`
  - Code: `FeatureFlagsService.aiEnabled(key)` = tổng BẬT **và** con BẬT — tính năng AI mới
    phải check qua hàm này
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

### 7. 💬 Hỏi đáp AI qua Telegram
Nhắn bot `@loipham_deploybox_bot` (chat riêng, hoặc nhắc @bot trong nhóm) → bot nhận diện
qua chat_id đã nối → lấy dữ liệu project **user có quyền xem** (OWNER: tất cả; MEMBER:
project được cấp) → AI trả lời dựa trên trạng thái/lỗi/chẩn đoán thật.
- Lệnh: `/status` (trạng thái project, không tốn AI), `/help`; còn lại là hỏi tự do
- Bảo mật: chưa nối tài khoản → từ chối; không lộ env/token; rate-limit 10s/câu/người
- `AiService.answer()` — dùng chung provider đã chọn ở Admin

### 9. 🚨 Quét secret lộ trong repo
Quét regex (không tốn AI) khi "Tự nhận diện"/"Kiểm tra AI": phát hiện file `.env` thật bị
commit, API key/token (Anthropic/OpenAI/Google/GitHub/GitLab/Slack/AWS/Telegram),
private key, connection string có mật khẩu → cảnh báo đỏ kèm hướng xử lý.
- `secret-scan.util.ts` — file `.env` thật CHỈ quét regex, KHÔNG đưa vào prompt AI
- Bỏ qua `.env.example`/`.env.sample` (placeholder) — đã test 4 loại secret + skip example ✓

### 10. ⚠️ Kiểm tra env trước deploy
- Card "🔍 Kiểm tra AI" ở trang project: quét repo → env app cần (lưu `Project.requiredEnvKeys`)
  → so với tab Env → báo **thiếu biến nào** + secret lộ. Endpoint `POST /git/projects/:id/check`
- Tạo project bằng "✨ Tự nhận diện" → envKeys tự lưu luôn
- Mỗi lần deploy: build log cảnh báo `⚠️ Thiếu N biến env app cần: …` (không chặn)
- Đã test live repo thật: NestJS, đọc 30 envKeys, chỉ đúng 1 biến thiếu (GOOGle_CALLBACK_URL)

### 11. ✨ Tóm tắt build log
Nút "✨ Tóm tắt AI" cạnh Build log: log dài → 3–6 dòng tiếng Việt (diễn biến, thời gian
đáng chú ý, lỗi/cảnh báo). Cache RAM theo deployment (log bất biến khi xong) — gọi lại ~0.4s.
- Endpoint `POST /deployments/:id/summarize` · đã test live: tóm tắt chuẩn cả vụ smoke fail

### 12. 📊 Báo cáo ngày/tuần qua Telegram
Mỗi ngày sau 8h sáng: gửi báo cáo 24h (thứ 2 → báo cáo TUẦN 7 ngày): số deploy ✅/❌,
crash/smoke fail, app đang chạy, breakdown theo project + AI nhận xét (best-effort).
- Chống gửi trùng qua bảng `Setting` (`report_last_sent`); không có hoạt động → không nhắn
- Admin xem trước: `GET /admin/report?days=1|7` · đã test live với số liệu thật

### 13. ⏪ Rollback thông minh (Docker mode)
Deploy Docker mới mà smoke test fail → tự tìm image ổn định gần nhất (bản cũ sạch lỗi)
→ tự tạo deployment rollback + Telegram "⏪ TỰ ĐỘNG ROLLBACK". Flag `auto_rollback` (Admin tắt được).
- Chống lặp: bản rollback không tự rollback tiếp; host-run không áp dụng (không lưu bản cũ)
- Lưu ý: mới verify bằng typecheck + logic (app của bạn chạy host-run nên chưa có ca Docker thật)

### 8. 🩺 Smoke test sau deploy
Deploy BACKEND báo "thành công" chưa chắc app sống — smoke test gọi thử app thật
(tối đa 7 lần / ~20s) sau khi RUNNING:
- App trả lời (HTTP < 500, kể cả 404) → ghi "🩺 Smoke test OK" vào build log
- Trả 5xx / không trả lời → lấy runtime log (host file / `docker logs`) → AI chẩn đoán
  → lưu `errorMessage` + `aiDiagnosis` vào deployment + gửi Telegram 🩺 cảnh báo
- Chạy nền best-effort, không ảnh hưởng kết quả deploy; kết hợp watchdog tự cứu app
- Đã test live cả 2 đường: deploy thật → "Smoke test OK (HTTP 404)"; kill app ngay sau
  RUNNING → phát hiện "KHÔNG trả lời sau ~20s", AI chẩn đoán + Telegram + watchdog cứu lại

---

## 🗺️ Lộ trình chính: ✅ ĐÃ XONG 13/13 (8 lộ trình gốc + trọn Đợt 1)
Việc tiếp theo lấy từ bảng xếp hạng bên dưới (xếp theo **giá trị ÷ công sức**).

---

## 🎯 Việc tiếp theo — xếp hạng chung

### ~~Đợt 1~~ — ✅ ĐÃ LÀM XONG TẤT CẢ (xem mục 9–13 phần "Đã làm")

### Đợt 2 — làm khi chạm đến ngữ cảnh đó

| # | Tính năng | Mô tả | Cỡ | Khi nào đáng làm |
|---|---|---|---|---|
| 6 | Sinh Dockerfile tự động | Repo không có Dockerfile → AI sinh multi-stage đúng port | Vừa | Khi bạn thật sự dùng Docker mode (hiện chủ yếu host-run) |
| 7 | Che secret trong log | Tự che token/password lỡ in ra build log | Nhỏ | Trước khi cho người ngoài dùng |
| 8 | Gác cổng migration nguy hiểm | Chặn `prisma migrate reset`/`DROP TABLE` trong build, hỏi xác nhận | Nhỏ | Khi có DB production thật |
| 9 | Auto-deploy có não | Push chỉ đổi docs → bỏ qua; đổi schema → cảnh báo | Nhỏ | Khi auto-deploy chạy nhiều |
| 10 | Cảnh báo sớm trước crash | Error trong runtime log tăng vọt → báo TRƯỚC khi chết | Vừa | Khi app có traffic thật |
| 11 | Gợi ý tối ưu vận hành | "Crash vì OOM → tăng memoryMb" (ghép vào watchdog) | Nhỏ | Ghép khi sửa watchdog lần sau |

### Đợt 3 — khi DeployBox thành sản phẩm cho người khác dùng

| # | Tính năng | Mô tả | Cỡ | Vì sao để sau |
|---|---|---|---|---|
| 12 | Copilot chat trong dashboard | Chat + AI thao tác được (deploy/stop/xem log) qua tool use | Lớn | Ấn tượng nhất nhưng 2–3 buổi; bot Telegram đã cover 70% nhu cầu cá nhân |
| 13 | Gửi ảnh lỗi cho bot Telegram | AI đọc ảnh chụp màn hình (multimodal) chẩn đoán | Vừa | Hay nhưng không cấp thiết |
| 14 | Chẩn đoán domain/DNS | Domain kẹt PENDING_DNS → hướng dẫn trỏ record | Vừa | Chỉ đau khi có nhiều domain thật |
| 15 | Release notes tự động | Tóm tắt commit giữa 2 bản deploy | Nhỏ | Nice-to-have |
| 16 | AI sinh file CI | Sinh GitHub Actions gọi webhook deploy | Nhỏ | Nice-to-have |
| 17 | Gợi ý giờ ngủ/thức, chọn server | Phân tích SleepService / tải server | Nhỏ | Chỉ đáng khi nhiều app + nhiều server |
| 18 | Onboarding bằng chat | AI dẫn user mới từng bước | Lớn | Chỉ đáng khi có user mới thật |

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
