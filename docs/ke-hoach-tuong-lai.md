# Kế hoạch tương lai — những gì CHƯA làm

> Nén từ bộ kế hoạch cũ (07-mobile, 08-saas, 09-bảo-mật, 10-chi-phí, feature-model-b — bản đầy đủ trong git history). Chỉ giữ phần **chưa làm** + đánh dấu ✓ phần đã xong. Lộ trình AI riêng: [../AI.md](../AI.md).

---

## 1. Lên SaaS (thu tiền người ngoài)

Nội bộ = MVP của SaaS. Trạng thái từng hạng mục:

| Hạng mục | Trạng thái |
|---|---|
| Team/RBAC (OWNER/MEMBER), mọi query scope theo team | ✅ xong |
| Plan FREE/PRO + giới hạn project/member/server (bật/tắt bằng flag `plan_limits_enabled`) | ✅ xong |
| Self-serve signup + xác thực email OTP | ✅ xong |
| Custom domain + verify TXT | ✅ xong |
| Sleep/scale-to-zero app nhàn rỗi | ✅ xong |
| **Billing Stripe** (Checkout, Subscription, webhook, Customer Portal) — hiện admin đổi plan tay | ❌ |
| **Metering** (CPU-giây, RAM-giờ, egress, build-phút) + quota engine chặn khi vượt | ❌ |
| **Cô lập code lạ** (bắt buộc trước khi mở public — xem mục 2) | ❌ |
| Pricing page + ToS/Privacy/AUP | ❌ |
| Tách log/artifact theo tenant (S3/R2), per-tenant dashboard + alert | ❌ |

**Bẫy kinh doanh cần nhớ:** phí hạ tầng cố định ăn gói Free (→ bắt buộc sleep + quota); user free build liên tục = đốt CPU (→ giới hạn build-phút); abuse (đào coin, spam) đến NGAY khi mở public.

## 2. Bảo mật — cô lập code lạ (rủi ro #1, BẮT BUỘC trước SaaS)

Hiện tại chạy theo mô hình "tin user" (nội bộ). Trước khi cho người lạ dùng:

| Rủi ro chính | Giảm thiểu |
|---|---|
| Build script thoát ra host (docker.sock) | Build bằng BuildKit/Kaniko rootless, KHÔNG mount docker.sock |
| Container escape | gVisor (runsc) khi run; Firecracker microVM ở quy mô SaaS |
| Chạy root trong container | Rootless Docker + `USER` non-root + `no-new-privileges` |
| App đọc filesystem host / app khác | `--read-only` rootfs + tmpfs `/tmp` + volume riêng từng app |
| Gọi metadata endpoint `169.254.169.254` lấy cloud credential | Egress filtering chặn IP nội bộ/link-local (rẻ, làm sớm được) |
| Quét mạng nội bộ (DB/Redis control plane) | Network namespace riêng, không chung network với control plane |
| Đào coin / spam mail / DDoS outbound | CPU quota + chặn egress port 25 + rate-limit băng thông |
| Secret lộ qua log/env dump | Không log env; mã hoá at-rest (✅ đã có); inject lúc runtime |

Đã có sẵn: memory/CPU limit per-project (`memoryMb`, `cpuLimit`), secret mã hoá AES-256-GCM, quét secret lộ trong repo (AI feature).

## 3. Mobile — phần còn thiếu

Đã có: ✅ build Flutter Android trong Docker (`buildImage` + `artifactPath`), tải APK/AAB từ dashboard, hỗ trợ flavor.

Chưa làm:
- **Ký số an toàn**: lưu keystore mã hoá, decode vào tmpfs lúc build, dọn sạch sau build (kể cả khi fail); bật Google Play App Signing.
- **Phân phối**: Fastlane lane upload Firebase App Distribution / Play Internal Testing; trang tải side-load có QR.
- **iOS**: bắt buộc macOS runner (Mac mini hoặc CI thuê — bắt đầu bằng CI thuê); ký số + TestFlight.
- OTA update Flutter (Shorebird) — tùy chọn.

## 4. Model B — "Kết nối server riêng" (BYO server, kiểu Coolify/Forge)

Ý tưởng: user tự mang VPS, DeployBox chỉ là bảng điều khiển → mình không chạy code lạ, không trả compute.

Đã có sẵn một nửa: ✅ model `Server` (LOCAL/REMOTE per team, SSH key mã hoá), ✅ deploy qua SSH lên server REMOTE (`runRemote` trong build.runner — git pull → build → docker run), ✅ test connection.

Chưa làm: onboarding tự động (script cài docker/chuẩn bị server), health-check định kỳ server của user, domain/SSL trỏ về server user (hiện chỉ `http://<host>:<port>`), stream log build từ xa realtime, dọn dẹp/rollback trên server xa.

## 5. Chi phí & vận hành (khi scale)

- **Tiền chảy về RAM, không phải CPU** → đòn bẩy: sleep app free (✅ có), quota RAM per app (✅ có `memoryMb`), dọn image/container cũ (✅ có cleanup service).
- Mốc giá VPS tham chiếu: Hetzner 2vCPU/4GB ~$5–8/tháng; 4vCPU/8GB ~$15–20; DO đắt gấp ~3.
- Chưa làm: monitoring chuẩn (Prometheus + Grafana + Uptime Kuma), backup DB tự động theo lịch, alert khi disk/RAM đầy, scale nhiều node (control plane tách khỏi worker).

## 6. Ý tưởng để dành khác

- Nixpacks/auto-detect buildpack (hiện đã có AI tự nhận diện cấu hình — đủ dùng).
- Preview deployment per-PR (deploy mỗi pull request ra URL riêng).
- CLI `deploybox deploy` (đã có API token — chỉ thiếu CLI).
