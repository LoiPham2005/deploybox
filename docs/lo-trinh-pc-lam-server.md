# 🖥️ Lộ trình: Biến máy tính cá nhân thành server deploy

> Kế hoạch 3 giai đoạn cho tính năng "PC nhà = server" — từ 0 dòng code tới "1 lệnh cài".
> Viết 16/07/2026. Liên quan: [y-tuong-tinh-nang.md](y-tuong-tinh-nang.md) · [ke-hoach-tuong-lai.md](ke-hoach-tuong-lai.md).

## TL;DR — kết luận trước

- **Kỹ thuật: khả thi (8/10).** Mô hình agent kết nối ngược là công nghệ đã chứng minh (GitHub Actions runner, Cloudflare Tunnel, ngrok). Rào cản thật không phải công nghệ mà là **độ tin cậy PC nhà** (mất điện, Windows update, người nhà tắt máy).
- **Kinh doanh: là PHỄU marketing, không phải nguồn thu chính.** Tệp "PC gaming để không" ở VN đông nhưng không chịu chi — giá trị nằm ở kéo người vào nền tảng, dùng quen rồi nâng PRO khi có dự án nghiêm túc.
- **Nguyên tắc:** không build trước nhu cầu. Giai đoạn 1 (0 code) đo nhu cầu thật → có người dùng mới build Giai đoạn 2.

---

## Vì sao đáng làm (business case)

| Góc nhìn | Phân tích |
|---|---|
| **Ai cần** | Sinh viên/dev có PC gaming idle: host bot Discord, side project, n8n, game server, tool nội bộ — không muốn tốn 100k+/tháng VPS |
| **Đối thủ** | Coolify/CapRover/Dokploy đều cần VPS public + biết DevOps. Chưa ai làm "PC nhà" tử tế **bằng tiếng Việt** |
| **Giá trị cho DeployBox** | 1️⃣ Content viral rẻ ("biến PC thành server miễn phí" — TikTok/FB dev VN)  2️⃣ Phễu: dùng quen dashboard → nâng PRO  3️⃣ Máy của user chịu tải, VPS 2GB của mình chỉ làm control plane |
| **Đường thu tiền có sẵn** | FREE = 1 server, thêm server = PRO (plan limit đã gate sẵn) |
| **Kỳ vọng đúng** | KHÔNG phải hosting production — định vị rõ là "hobby / dev / nội bộ" để tránh khiếu nại độ tin cậy |

---

## Nền móng ĐÃ CÓ (tính đến 16/07/2026)

Những thứ này đã live — Giai đoạn 1 dùng được NGAY không cần code:

| Đã có | Ghi chú |
|---|---|
| Server REMOTE qua SSH (form + test kết nối, key mã hoá AES-256) | trang `/servers` |
| Deploy remote: clone/build/chạy Docker **trên máy đích** | script sinh tự động, env đẩy theo |
| 🩺 Health-check sau deploy (bắt cả app chết-lặp) | deploy hỏng báo FAILED, dọn container hỏng |
| 🧠 `--memory/--cpus` cho container remote | theo "RAM tối đa" của project |
| 🛰️ Watchdog remote: 2 phút/lần SSH kiểm, chết → tự `docker start`, không cứu được → STOPPED + Telegram | flag `remote_watchdog` |

→ Tất cả đã test end-to-end (16/07, self-remote trên chính VPS). **Máy đích chỉ cần: SSH + git + docker.**

---

## 🟢 Giai đoạn 1 — Tailscale guide (0 dòng code, làm ngay được)

**Mục tiêu:** cho người dùng biến PC thành server bằng công cụ sẵn có + đo xem có ai thực sự cần.

### Cách hoạt động
PC nhà nằm sau NAT → VPS không SSH vào được. **Tailscale** (miễn phí 100 máy) tạo mạng riêng ảo: cả VPS lẫn PC có IP `100.x.x.x` ổn định, SSH xuyên NAT không cần mở port router.

### Các bước người dùng làm (viết thành bài hướng dẫn)

```bash
# ── Trên PC (Ubuntu/WSL2/macOS) ──
# 1. Cài Tailscale + đăng nhập (tài khoản Google/GitHub)
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale ip -4        # → ghi lại IP 100.x.x.x

# 2. Cài Docker + git (nếu chưa có)
curl -fsSL https://get.docker.com | sh

# 3. Bật SSH server + tạo key cho DeployBox
sudo apt install -y openssh-server
ssh-keygen -t ed25519 -f ~/.ssh/deploybox -N ""
cat ~/.ssh/deploybox.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/deploybox    # → private key dán vào DeployBox
```

```
# ── Phía DeployBox (VPS đã cài sẵn Tailscale, cùng tailnet*) ──
Servers → Thêm server mới → Remote (VPS/SSH)
  Host = 100.x.x.x (IP Tailscale của PC)
  Username = <user PC>   ·   SSH Private Key = key vừa tạo
→ "Test kết nối" → gắn project vào server → Deploy như thường
```

\* Lưu ý vận hành: **VPS platform phải join tailnet của AI?** — mỗi user một tailnet riêng thì VPS không vào được. 2 cách:
- **Cách đơn giản (guide cá nhân):** user tự host cả DeployBox → không liên quan mình.
- **Cách cho khách của sneakup.io.vn:** khách mở port SSH trên router (port forward) HOẶC dùng `tailscale funnel`/Cloudflare Tunnel expose riêng cổng SSH. Bài guide viết cả 2 đường.
- **Cách gọn nhất về lâu dài** → chính là lý do cần Giai đoạn 2 (agent), vì SSH-vào-nhà-người-lạ vốn không đẹp.

### Việc cần làm (docs/marketing, ~1 buổi)
- [ ] Viết bài `docs/huong-dan-pc-lam-server.md` (theo các bước trên, có ảnh chụp)
- [ ] Đăng bài lên fanpage/TikTok/nhóm dev VN
- [ ] Thêm khối gợi ý ở trang `/servers`: "PC cá nhân cũng làm được server — xem hướng dẫn"

### Tiêu chí đo (sau 4–6 tuần)
| Chỉ số | Ngưỡng đáng để làm tiếp GĐ2 |
|---|---|
| Người làm theo guide thành công | ≥ 10 |
| Server remote "PC" hoạt động > 1 tuần | ≥ 5 |
| Người hỏi "có cách nào dễ hơn không" | ≥ 3 |

---

## 🟡 Giai đoạn 2 — Agent mode ("1 lệnh cài", xuyên NAT thật sự)

**Chỉ làm khi Giai đoạn 1 đạt ngưỡng.** Đây là feature cỡ LỚN (1–2 tuần làm + test).

### Kiến trúc

```
PC nhà (sau NAT)                      VPS DeployBox
┌────────────────────┐               ┌──────────────────────┐
│ deploybox-agent    │──kết nối ra──▶│ API /agent/ws        │
│ (1 binary Node/Go) │  WebSocket    │ (xác thực agent token)│
│  - nhận lệnh build │◀──lệnh────────│ Build runner:        │
│  - chạy docker     │               │  serverType=AGENT →  │
│  - báo trạng thái  │──log/status──▶│  đẩy job qua WS      │
└────────────────────┘               └──────────────────────┘
```

Điểm mấu chốt: **agent kết nối RA (outbound)** → xuyên NAT/firewall, không cần mở port, không cần user hiểu SSH.

### Trải nghiệm người dùng nhắm tới

```bash
# trên PC — 1 lệnh duy nhất (token lấy từ trang Servers):
curl -fsSL https://sneakup.io.vn/agent.sh | sh -s -- --token dbx_agent_xxx
```
→ Server tự hiện trong trang Servers (status ONLINE/OFFLINE realtime) → deploy như thường.

### Việc phải build

| # | Hạng mục | Nội dung | Cỡ |
|---|---|---|---|
| 1 | Schema | `Server.type` thêm `AGENT`; bảng `AgentToken` (hash, serverId, lastSeen) | nhỏ |
| 2 | Kênh WS | Gateway `/agent/ws` (NestJS WebSocket): auth token, heartbeat 30s, mất kết nối → server OFFLINE | vừa |
| 3 | Protocol lệnh | `{type:'deploy', script}` / `{type:'exec'}` / `{type:'status'}` → agent chạy, stream log về (tái dùng format log build sẵn có) | vừa |
| 4 | Agent binary | Node single-file (pkg/bun compile) hoặc Go: nhận job → chạy `bash -c` → stream output. Tự cài như systemd service/launchd để sống sau reboot | **lớn** |
| 5 | Build runner | Nhánh `serverType === 'AGENT'`: thay vì SSH → đẩy script qua WS (script deploy remote TÁI DÙNG NGUYÊN — đã có health-check/limits) | nhỏ |
| 6 | Watchdog | Tái dùng remote watchdog nhưng qua WS thay vì SSH (gửi `docker ps` định kỳ) | nhỏ |
| 7 | UI | Trang Servers: nút "Thêm PC cá nhân" → sinh token + hiện lệnh cài; badge ONLINE/OFFLINE | nhỏ |
| 8 | Bảo mật | Token 1 server 1 token, thu hồi được; agent CHỈ nhận lệnh từ platform (không mở port nào trên PC); rate limit đăng ký | vừa |

**Flag Admin:** `agent_servers` (bật/tắt toàn tính năng).

### Rủi ro & cách né
| Rủi ro | Né |
|---|---|
| PC ngủ/tắt → app chết thất thường | Badge OFFLINE rõ ràng + docs định vị "hobby, không phải production" + app tự chạy lại khi PC bật (docker restart policy — đã có) |
| Windows thuần (không WSL) | v1 CHỈ hỗ trợ Linux/macOS/WSL2 — ghi rõ. Windows native để sau |
| Support đủ kiểu mạng | Agent outbound WSS port 443 → gần như không bao giờ bị chặn |
| Agent bị dùng làm botnet? | Agent chỉ nhận lệnh từ platform của mình, code mở để user kiểm chứng |

---

## 🔵 Giai đoạn 3 — Public HTTPS cho app trên PC (combo "ăn tiền")

**Vấn đề còn lại sau GĐ2:** app chạy trên PC chỉ truy cập được trong mạng riêng. Muốn PUBLIC → cần tunnel.

**Giải pháp: tích hợp Cloudflare Tunnel** (miễn phí, không cần mở port):
- Agent cài kèm `cloudflared` → khi user bật "Public" cho project, platform tạo tunnel + route `ten-app.sneakup.io.vn` (CNAME → tunnel) → **app trên PC nhà có HTTPS public y như app trên VPS**.
- Yêu cầu: domain `sneakup.io.vn` chuyển DNS sang Cloudflare (việc DNS đã bàn — làm lúc nào cũng được, miễn phí).
- Đây là lúc tính năng thành "magic" thật sự: *PC gaming + 1 lệnh = hosting công khai có HTTPS*. Không đối thủ VN nào có.

Cỡ: vừa (sau khi có GĐ2, phần lớn là gọi API Cloudflare tạo tunnel/route).

---

## Những thứ CỐ TÌNH KHÔNG làm (non-goals)

- ❌ Cam kết SLA/production cho PC nhà — định vị hobby/dev/nội bộ, ghi rõ mọi nơi.
- ❌ Windows native agent ở v1 (chỉ Linux/macOS/WSL2).
- ❌ Tự mở port router hộ user (UPnP) — rủi ro bảo mật, không đáng.
- ❌ Chạy build nặng của NGƯỜI KHÁC trên PC user (chỉ deploy project của chính chủ PC — không phải mạng chia sẻ tài nguyên kiểu Golem).

## Thứ tự ưu tiên trong bức tranh chung

1. **Trước tiên:** kiếm khách trả tiền đầu tiên cho hosting chính (landing ✅, thanh toán ✅) — mọi thứ khác xếp sau.
2. GĐ1 guide làm lúc rảnh (1 buổi) — vừa là content marketing.
3. GĐ2 agent chỉ khi GĐ1 chứng minh nhu cầu (xem ngưỡng đo ở trên).
4. GĐ3 tunnel đi kèm việc chuyển DNS sang Cloudflare (quyết định riêng, đã có phân tích).
