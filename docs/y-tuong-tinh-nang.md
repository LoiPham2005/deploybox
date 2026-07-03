# Ý tưởng tính năng cho DeployBox

> Danh sách tính năng CÒN CÓ THỂ LÀM (đã loại những cái đã có). Cập nhật 03/07/2026.
> Liên quan: [ke-hoach-tuong-lai.md](ke-hoach-tuong-lai.md) (SaaS/bảo mật/mobile/BYO server) · [../AI.md](../AI.md) (lộ trình AI).

## Đã có rồi (để khỏi gợi ý trùng)

13 module API · ~13 tính năng AI · Copilot chat · Telegram bot Q&A · OTP email (đăng ký + quên mật khẩu) · CI/CD (GitHub Actions) · backup DB hằng đêm · rate-limit auth · sleep/scale-to-zero · cleanup tự động · báo cáo ngày · webhook auto-deploy · domain + SSL tự động · server LOCAL/REMOTE (SSH) · teams/RBAC 2 tầng · plan FREE/PRO + giới hạn · API token · metrics (prom-client) · watchdog self-heal · smoke test sau deploy.

---

## 🔥 Nhóm A — Tính năng PaaS "xịn" (ngang Railway/Vercel)

| # | Tính năng | Là gì | Tận dụng đồ có sẵn | Cỡ |
|---|---|---|---|---|
| A1 | **Preview deploy mỗi Pull Request** ⭐ | Mở PR → tự deploy ra URL riêng `pr-12.<slug>.sneakup.io.vn` để review; đóng/merge PR → tự xoá | Webhook + Caddy route + build pipeline | Vừa |
| A2 | **Cron jobs cho app user** | User đặt lịch chạy 1 lệnh/endpoint định kỳ (gửi mail, dọn data, sync…) | Đã có pattern chạy interval (sleep/report/cleanup) | Vừa |
| A3 | **Database 1-click** | Bấm nút tạo Postgres/Redis cho app (Docker container) + tự bơm connection string vào env | Docker engine đã có | Vừa–lớn |
| A4 | **CLI `deploybox`** | `deploybox deploy` / `logs` / `env` từ terminal, không cần mở web | API token đã có | Vừa |
| A5 | **Build/deploy hooks** | Chạy lệnh trước/sau deploy (migrate DB, warmup cache, gọi webhook) | Build runner đã có | Nhỏ |

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
