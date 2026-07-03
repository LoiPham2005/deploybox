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

### 14. 🕶️ Che secret trong log
Mọi dòng build log đi qua bộ che TỪ NGUỒN (file log, SSE stream, và cả AI đọc đều chỉ
thấy bản đã che): giá trị env `isSecret` của project + token/key khớp pattern chung.
- `maskSecrets()` trong `secret-scan.util.ts` — flag `ai_log_masking`

### 15. 🛡️ Gác lệnh phá dữ liệu
Lệnh install/build/start chứa `prisma migrate reset`, `--force-reset`, `migrate fresh`,
`DROP TABLE/DATABASE`, `TRUNCATE`, `FLUSHALL` → CHẶN deploy ngay với hướng dẫn.
Cố ý dùng → tắt flag `ai_migration_guard`.
- Đã test live: deploy với buildCommand chứa `prisma migrate reset` → FAILED tức thì ✓

### 16. 🧠 Auto-deploy có não
Webhook push (GitHub/GitLab gửi kèm danh sách file đổi):
- Chỉ đổi tài liệu/ảnh (md/png/docs/README…) → **bỏ qua deploy** (đỡ 1 lần build), ghi lý do vào lịch sử webhook
- Đụng `schema.prisma`/`migrations/` → vẫn deploy nhưng **cảnh báo Telegram** trước
- Flag `ai_smart_autodeploy` · đã test live webhook HMAC thật: push README.md → skipped ✓

### 17. ⚡ Cảnh báo sớm trước crash
Watchdog (60s/lần) soi phần log MỚI của app còn sống: ≥8 dòng error/exception trong 1 vòng
quét → Telegram ⚡ kèm dòng lỗi mẫu + gợi ý — báo TRƯỚC khi app chết. Cooldown 30ph/project.
- Flag `ai_early_warning` · đã test live: bơm 12 dòng error → cảnh báo bắn sau ≤60s ✓

### 18. 💡 Gợi ý vận hành theo loại lỗi
Crash/smoke-fail kèm gợi ý rule-based: OOM → "tăng memoryMb (hiện XMB)"; EADDRINUSE →
"cổng bị chiếm"; P1001 → "kiểm tra DATABASE_URL"; MODULE_NOT_FOUND → "npm ci --include=dev"…
- `opsTip()` — flag `ai_ops_tips` · đã test 5 loại lỗi ✓

### 19. 🐳 Sinh Dockerfile tự động
Project Docker mode mà repo không có Dockerfile → AI đọc repo đã clone → sinh Dockerfile
multi-stage (đúng port, Prisma generate, layer cache) → ghi vào workdir + in vào build log → build luôn.
- Hook `onMissingDockerfile` trong `DockerBackendEngine` — flag `ai_dockerfile_gen`
- Lưu ý: verify bằng typecheck (chưa có ca Docker thật để test live — app đang host-run)

---

## 🗺️ Lộ trình: ✅ ĐÃ XONG TẤT CẢ 31/31 (8 gốc + Đợt 1 + Đợt 2 + Vòng 3 + Đợt 3)

---

## 🎯 Việc tiếp theo — xếp hạng chung

### ~~Đợt 1~~ — ✅ XONG (mục 9–13) · ~~Đợt 2~~ — ✅ XONG (mục 14–19)

### ~~Vòng 3~~ — ✅ ĐÃ LÀM XONG CẢ 5 (xem mục 20–24)

### 20. 📚 Học từ lịch sử sửa lỗi (A)
Deploy thành công ngay sau 1 bản FAILED có chẩn đoán → hệ thống **tự học**: lưu
(chữ ký lỗi → cách sửa) vào bảng `FixMemory` (verified). Lỗi mới trùng chữ ký →
trả lời **ngay từ trí nhớ, 0 đồng**, model hiện "📚 Trí nhớ DeployBox" + đếm số lần dùng lại.
- Chữ ký lỗi (`error-sig.util.ts`): chuẩn hoá bỏ id/số/timestamp → cùng "bệnh" = cùng sig
- Áp dụng cho MỌI đường chẩn đoán (thủ công, tự động, watchdog, smoke) — flag `ai_fix_memory`
- Đã test live: trồng trí nhớ → diagnose trả từ lịch sử trong 1.5s, hits +1 ✓

### 21. 🎮 Bot Telegram thao tác được (B)
`/deploy <tên app>` · `/stop <tên app>` → bot hiện **nút xác nhận inline** (✅/❌, hết hạn 2ph)
→ bấm ✅ là làm thật, đúng RBAC của người nhắn (gọi DeploymentsService nên mọi luật quyền giữ nguyên).
- Tên mờ (khớp một phần) → gợi ý danh sách; nút chỉ người gọi lệnh bấm được
- Flag `ai_bot_actions` · cần test tay từ điện thoại (bot chỉ nhận tin từ người thật)

### 22. 💰 Theo dõi chi phí AI (C)
Mọi lượt gọi AI ghi token vào bảng `AiUsage` (theo tính năng/provider/model) →
card **"💰 Chi phí AI"** ở Admin: tổng lượt, ước tính $, bảng chi tiết từng tính năng.
- Endpoint `GET /admin/ai-usage?days=30` · flag `ai_usage_tracking`
- Đã test live: 2 lượt Gemini ghi đúng feature/token, ước tính $0.0016 ✓

### 23. 🗂 Nhận diện monorepo đa app (D)
"✨ Tự nhận diện" giờ phát hiện repo chứa NHIỀU app: trả mảng `apps[]` (tên, type,
rootDir, lệnh, cổng riêng từng app) → form tạo project hiện panel "Monorepo: N app"
với nút chọn từng app để điền form (tạo lần lượt, cùng repo URL).
- Đã test live trên chính repo deploybox: phát hiện đúng `api` (apps/api, 4000) + `web` (apps/web, 3000) ✓

### 24. 📈 Cảnh báo RAM bất thường (E)
Watchdog lấy mẫu RAM (RSS) app host-run mỗi phút; RAM **tăng ≥1.5x và ≥150MB trong ≥30 phút**
→ Telegram 📈 "nghi memory leak" (cooldown 6h/project). Lịch sử giữ trong RAM (~2h).
- Flag `ai_metrics_anomaly` · verify bằng typecheck + logic (cần app chạy ≥30ph có leak thật mới bắn)

### 25. 🤖 Copilot trong dashboard (#12)
Nút 🤖 nổi góc phải dưới mọi trang → khung chat: hỏi về project (dữ liệu thật, đúng quyền),
AI đề xuất hành động deploy/stop → **hiện nút xác nhận trong chat, bấm mới chạy** (RBAC
qua DeploymentsService). Module mới `modules/copilot` (`POST /copilot/message|action`).
- Flag `ai_copilot` · đã test live: hỏi trạng thái + xin deploy → action đúng project ✓

### 26. 🧭 Onboarding bằng chat (#18)
User **chưa có project nào** → copilot tự vào chế độ dẫn từng bước (chuẩn bị repo →
Tự nhận diện → Tạo → Deploy → xem log/domain), mỗi lượt 1 bước. Flag `ai_onboarding`.

### 27. 🖼 Gửi ảnh lỗi cho bot Telegram (#13)
Gửi ảnh chụp màn hình (kèm caption làm câu hỏi) cho bot → tải ảnh qua getFile → AI **vision**
đọc ảnh chẩn đoán. Cả 3 provider đều thêm `completeVision` (Claude image block / GPT-4o
image_url / Gemini inlineData). Trong nhóm phải nhắc @bot ở caption. Flag `ai_photo_diagnosis`.
- Cần test tay từ điện thoại (bot chỉ nhận tin người thật)

### 28. 🩺 Chẩn đoán domain/DNS (#14)
Nút "🩺 AI" cạnh domain chưa ACTIVE (card Domains) → tra DNS THẬT (A record hiện tại,
A record đích, TXT verify) → AI hướng dẫn trỏ record từng bước. `POST /domains/:id/diagnose`.
- Flag `ai_dns_diagnosis` · đã test live: giải thích đúng ca `.localhost` không có DNS công khai ✓

### 29. 📝 Release notes tự động (#15)
Nút "📝 Release notes AI" ở trang deployment → `git log` giữa commit của bản này và bản
thành công trước (repo private dùng token đã lưu; deploy tay → 15 commit gần nhất) →
AI viết changelog tiếng Việt theo nhóm ✨/🐛/🔧. Cache theo deployment.
- Flag `ai_release_notes` · phần git đã chạy live ✓ (phần AI vướng quota Gemini trong ngày — mai chạy)

### 30. ⚙️ AI sinh file CI (#16)
Nút "⚙️ Sinh GitHub Actions (AI)" ở card "Deploy qua API" → workflow YAML gọi
`POST /projects/:id/deploy` với `secrets.DEPLOYBOX_TOKEN`, kèm hướng dẫn tạo secret. Copy là chạy.
- Flag `ai_ci_generator` · đã test live: YAML hợp lệ, đủ on:/secret ✓

### 31. 💡 Gợi ý giờ ngủ/chọn server (#17)
Nút ở card "🔍 Kiểm tra AI" → đọc access log Caddy đếm request theo giờ-trong-ngày +
tải từng server → AI gợi ý bật sleep khung giờ nào, đặt app server nào.
- Flag `ai_ops_advice` · code path đã verify (vướng quota Gemini trong ngày)

> 🏁 **TOÀN BỘ danh sách AI đã làm xong: 31 tính năng.** Từ đây trở đi: dùng thật hằng ngày
> để lọc — cái nào phiền thì TẮT (mỗi cái 1 công tắc), cái nào hay dùng thì mài sắc.
> Không thêm tính năng AI mới nếu không có pain thật.

### ~~Đợt 3~~ — ✅ ĐÃ LÀM XONG (xem mục 25–31)

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
