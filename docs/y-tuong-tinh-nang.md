# Ý tưởng tính năng cho DeployBox

> Danh sách tính năng CÒN CÓ THỂ LÀM (đã loại những cái đã có). Cập nhật 03/07/2026.
> Liên quan: [ke-hoach-tuong-lai.md](ke-hoach-tuong-lai.md) (SaaS/bảo mật/mobile/BYO server) · [../AI.md](../AI.md) (lộ trình AI).

## Đã có rồi (để khỏi gợi ý trùng)

13 module API · ~13 tính năng AI · Copilot chat · Telegram bot Q&A · OTP email (đăng ký + quên mật khẩu) · CI/CD (GitHub Actions) · backup DB hằng đêm · rate-limit auth · sleep/scale-to-zero · cleanup tự động · báo cáo ngày · webhook auto-deploy · domain + SSL tự động · server LOCAL/REMOTE (SSH) · teams/RBAC 2 tầng · plan FREE/PRO + giới hạn · API token · metrics (prom-client) · watchdog self-heal · smoke test sau deploy.

---

## 🔥 Nhóm A — Tính năng PaaS "xịn" (ngang Railway/Vercel) — ✅ ĐÃ LÀM HẾT (2026-07-03)

Cả 5 tính năng đã code + typecheck + test + deploy production + verify live.

| # | Tính năng | Là gì | Trạng thái |
|---|---|---|---|
| A1 | **Preview deploy mỗi Pull Request** ⭐ | PR cùng repo mở → tự deploy ra `pr-<số>-<slug>.sneakup.io.vn`; đóng/merge → tự xoá. Chặn PR từ fork (bảo mật). Bật ở Sửa cấu hình. | ✅ live |
| A2 | **Cron jobs cho app user** | User đặt lịch chạy lệnh định kỳ (cron 5 trường); chạy host-run hoặc `docker exec` | ✅ live |
| A3 | **Database 1-click** | 1 nút tạo Postgres/Redis (Docker container + volume) + tự bơm connection string vào env (mã hoá) | ✅ live |
| A4 | **CLI `deploybox`** | `deploybox login/whoami/list/deploy/logs` từ terminal (dùng API token) | ✅ live |
| A5 | **Build/deploy hooks** | Lệnh pre/post-deploy (migrate DB, warmup) cho BACKEND | ✅ live |

> Ghi chú vận hành: preview cần **wildcard DNS `*.sneakup.io.vn`** (đã có) + PUBLIC_TLS (đã bật) → subdomain động tự có HTTPS. A3 cần **Docker** trên VPS (đã cài 2026-07-03, v29.6.1).

## 🔒 Nhóm B — Bảo mật & tài khoản

| # | Tính năng | Là gì | Tận dụng | Cỡ |
|---|---|---|---|---|
| B1 | **2FA đăng nhập** ⭐ | Xác thực 2 lớp qua email/authenticator app | Hạ tầng OTP + mail đã làm xong | Nhỏ–vừa |
| B2 | **Nhật ký hoạt động (audit log)** | Ghi ai deploy / đổi env / xoá project + thời điểm | — (thêm 1 bảng + middleware) | Vừa |
| B3 | **Quản lý phiên đăng nhập** | Xem đang đăng nhập từ đâu, thu hồi phiên lạ | — | Vừa |

## 📊 Nhóm C — Quan sát cho USER (không chỉ cho admin)

| # | Tính năng | Là gì | Ghi chú |
|---|---|---|---|
| C1 | **Biểu đồ CPU/RAM theo thời gian** | Hiện metrics chỉ là số tức thời → thêm biểu đồ lịch sử per app | Có prom-client rồi, thiếu lưu + vẽ |
| C2 | **DeployBox tự canh app user** | Ping app đã deploy, app chết thì báo (giống UptimeRobot cho từng app) | Watchdog host-run đã có mầm |
| C3 | **Tìm kiếm / tải log** | Log hiện realtime + file → thêm search, giữ lịch sử, nút tải xuống | — |

## 🧰 Nhóm D — DevEx / Mobile / Thông báo

| # | Tính năng | Là gì |
|---|---|---|
| D1 | **Deploy 1-click template** | "Deploy WordPress / Ghost / n8n / Metabase" bằng 1 nút |
| D2 | **Thông báo đa kênh** | Giờ chỉ Telegram → thêm Email / Discord / Slack (webhook) |
| D3 | **iOS build** | Bổ sung cho Android đã có — cần macOS runner (Mac mini hoặc CI thuê) |
| D4 | **Ký số & phân phối mobile** | Firebase App Distribution / TestFlight / Play Internal Testing |
| D5 | **Billing thật** | Trang billing mới hiện gói, chưa thanh toán. VN nên **PayOS / VNPay / MoMo** (Stripe khó ở VN) — chỉ làm nếu định bán PRO |

## 🤖 Nhóm E — AI (đã rất nhiều, còn vài ý)

Xem chi tiết ở [../AI.md](../AI.md). Còn lại đáng làm: **AI cost optimizer** (phân tích app nào ngốn RAM → gợi ý giảm), **AI viết Dockerfile** khi repo thiếu, **AI release notes** từ commit giữa 2 bản deploy.

---

## Đề xuất thứ tự làm

| Ưu tiên | Tính năng | Vì sao |
|---|---|---|
| 1 | **A1 — Preview deploy mỗi PR** | Ấn tượng nhất, tận dụng gần hết đồ có sẵn (webhook/Caddy/build) → "ngang tầm Vercel" |
| 2 | **B1 — 2FA đăng nhập** | Rẻ (tái dùng OTP + mail), vá nốt lỗ hổng tài khoản |
| 3 | **A2 — Cron jobs cho app** | Tính năng PaaS cốt lõi đang thiếu, dev hay cần |

**Nếu định thương mại hoá:** bộ đôi bán được tiền = **A3 Database 1-click + D5 Billing (PayOS)**.

## Quy tắc khi thêm tính năng mới (giữ hệ thống sạch)

- Type/schema dùng chung **chỉ khai báo ở `packages/shared`** — FE/BE import chung.
- Tính năng bật/tắt được → thêm **feature flag** (admin tắt được ngay).
- Có secret → mã hoá at-rest bằng `ENCRYPTION_KEY` (đừng log, đừng commit).
- Web thao tác cần auth từ client → đi qua **server action** (cookie httpOnly).
- Route công khai → gắn **rate-limit** (`@UseGuards(ThrottlerGuard)`).
- Xong → viết test, push, để CI/CD tự deploy (xem [deploy/cicd.md](deploy/cicd.md)).
