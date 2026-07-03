# DeployBox — Tài liệu

PaaS tự host: kết nối Git → build → chạy app → tự gắn domain + SSL. **Sản phẩm đã chạy production** tại `sneakup.io.vn`.

| Muốn gì | Đọc |
|---|---|
| **Bấm Deploy thì chuyện gì xảy ra?** (giải thích dễ hiểu cho backend/frontend) | [co-che-hoat-dong.md](co-che-hoat-dong.md) |
| Hiểu hệ thống đang chạy (kiến trúc, luồng deploy, data model, RBAC) | [kien-truc.md](kien-truc.md) |
| **Deploy lên VPS** | [deploy/vps.md](deploy/vps.md) — bản production hiện tại: [deploy/sneakup-vps.md](deploy/sneakup-vps.md) |
| Biến máy Mac thành server (pm2 + self-heal + Cloudflare Tunnel) | [deploy/home-mac.md](deploy/home-mac.md) |
| Biến máy Windows thành server (WSL2) | [deploy/home-windows.md](deploy/home-windows.md) |
| Những gì CHƯA làm (SaaS/billing, cô lập bảo mật, iOS, BYO server, vận hành) | [ke-hoach-tuong-lai.md](ke-hoach-tuong-lai.md) |
| Tính năng AI (đã làm + lộ trình) | [../AI.md](../AI.md) |
| Chạy dev trên máy | [../README.md](../README.md) |

> **Lịch sử:** bộ kế hoạch gốc trước khi code (00-tong-quan → 10-chi-phi + implementation/) đã được nén thành `kien-truc.md` + `ke-hoach-tuong-lai.md`. Cần bản đầy đủ: `git log --diff-filter=D -- docs` rồi `git show <commit>^:docs/<file>`.
