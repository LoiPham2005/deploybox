# Model B — "Kết nối server riêng" (BYO Server) — Kế hoạch triển khai

> Trạng thái: **CHƯA làm**, để dành. Đây là spec để triển khai sau.
> Mục tiêu: biến DeployBox thành **bảng điều khiển** deploy app lên **server của chính user** (không phải server mình) — kiểu **Coolify / Laravel Forge / Ploi**.

---

## 1. Ý tưởng & vì sao đáng làm

Hiện tại DeployBox deploy lên **1 server cố định** (chính máy chạy nó). Model B cho **mỗi team/user kết nối VPS riêng**, app chạy trên VPS của họ.

| | Hiện tại (1 server) | Model B (BYO server) |
|---|---|---|
| App chạy ở | Máy chạy DeployBox | **VPS của user** |
| Mình chạy code lạ? | Có | **Không** → né cô lập bảo mật |
| Mình trả compute? | Có | **Không** |
| Giống | tự host cho mình | **Coolify / Forge** (bán được) |

```
                    ┌──────────────────────────┐
  User (browser) ──►│  DeployBox (control plane)│
                    └─────────┬───────┬─────────┘
                       SSH/agent│      │SSH/agent
                    ┌───────────▼─┐ ┌──▼──────────┐
                    │ VPS user A  │ │ VPS user B  │   ← app chạy ở đây
                    │ Docker+Caddy│ │ Docker+Caddy│
                    └─────────────┘ └─────────────┘
```

---

## 2. Tận dụng cái đã có (KHÔNG phải làm lại)

- ✅ Engine đã **shell `docker` CLI** → tôn trọng `DOCKER_HOST`. Chỉ cần set `DOCKER_HOST=ssh://user@host` theo server cho mỗi deploy.
- ✅ `CaddyService` đã **reload qua CLI** → đẩy Caddyfile + `caddy reload` trên server từ xa qua SSH.
- ✅ `CryptoService` (AES-256-GCM) → mã hoá SSH key của user.
- ✅ Toàn bộ logic build/clone/run, rollback, webhook, scale-to-zero **giữ nguyên** — chỉ đổi "đích" từ local sang server từ xa.

→ Cốt lõi: **tham số hoá "deploy lên server nào"** thay vì 1 server cố định.

---

## 3. Thay đổi data model (Prisma)

```prisma
model Server {
  id           String   @id @default(cuid())
  team         Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
  teamId       String
  name         String
  host         String                       // IP hoặc hostname VPS
  sshUser      String   @default("deploy")
  sshPort      Int      @default(22)
  sshKey       String                       // private key — MÃ HOÁ at-rest (CryptoService)
  status       ServerStatus @default(PENDING) // PENDING | READY | ERROR
  lastCheckedAt DateTime?
  createdAt    DateTime @default(now())
  projects     Project[]
}

enum ServerStatus { PENDING READY ERROR }

// Project thêm:
//   server   Server? @relation(...)
//   serverId String?     // null = server local mặc định (tương thích ngược)
```

> `serverId` null ⇒ dùng server local như hiện tại ⇒ **không phá gì**.

---

## 4. Cách kết nối từ xa — 2 lựa chọn

### A. SSH trực tiếp (KHUYẾN NGHỊ bắt đầu — đơn giản)
- Control plane lưu **SSH key của user** (mã hoá). Mỗi deploy:
  - Docker: `docker -H ssh://deploy@host build/run …` (hoặc set env `DOCKER_HOST=ssh://...` khi spawn).
  - Caddy: `scp Caddyfile` + `ssh deploy@host caddy reload …`.
- **Ưu:** tái dùng engine gần như nguyên vẹn. **Nhược:** control plane giữ SSH key của user (phải bảo vệ kỹ).

### B. Agent trên VPS user (nâng cao — an toàn hơn)
- User cài 1 **agent** nhỏ trên VPS; agent kết nối **RA** tới control plane (như cloudflared), nhận lệnh build/deploy.
- **Ưu:** control plane KHÔNG cần SSH key; agent chỉ làm việc được giao. **Nhược:** phải viết + bảo trì agent.

→ **Bắt đầu A**, nâng lên **B** khi cần bán/scale.

---

## 5. Luồng onboarding (user thêm server)

1. Trang **"Servers" → "Thêm server"**.
2. Dán **IP + SSH private key** (hoặc chọn provider/API key).
3. (Tùy chọn) DeployBox đưa **1 lệnh setup** chạy trên VPS:
   `curl -fsSL https://control-plane/setup.sh | bash` → cài Docker + Caddy + tạo user `deploy` + nạp public key của control plane.
4. DeployBox **test kết nối**: `docker -H ssh://... version` → đánh dấu **READY**.
5. Tạo project → **chọn server** để deploy lên.

---

## 6. Việc cần làm (task list)

**Backend**
- [ ] Prisma: `Server` model + `Project.serverId` + migration.
- [ ] `ServersModule`: CRUD server (add/list/test/delete), **mã hoá sshKey** qua CryptoService.
- [ ] `POST /servers/:id/test` — kiểm tra `docker version` qua SSH → cập nhật status.
- [ ] **Refactor `DockerService` / `CaddyService`** nhận một `ServerContext` (host, sshUser, sshKey) thay vì `DOCKER_HOST` global. Engine lấy server từ `project.serverId` (null → local).
- [ ] Build runner: nếu remote, build trên server đó (clone + docker build chạy qua SSH/DOCKER_HOST).

**Frontend**
- [ ] Trang **"Servers"** (thêm/test/xóa) — nối vào sidebar.
- [ ] **Chọn server** khi tạo project + hiển thị server của project.

**Ops**
- [ ] **Setup script** cho VPS user (cài Docker + Caddy + deploy user + public key).

---

## 7. Bảo mật

- SSH key **mã hoá at-rest** (CryptoService — đã có).
- Mỗi `Server` thuộc **1 team** → user khác không dùng được.
- Code chạy trên **VPS của user** → control plane **không gánh rủi ro chạy code lạ** (khác hẳn Model A).
- Đổi lại: control plane giữ SSH key → **bảo vệ control plane** rất kỹ (đây là điểm tấn công).

---

## 8. Domain / SSL

- Domain của user **trỏ về VPS của họ**. Caddy trên VPS đó tự lấy **Let's Encrypt** (đặt `PUBLIC_TLS=true` cho server đó).
- Control plane chỉ **ra lệnh cấu hình** Caddy qua SSH; không cần đứng giữa traffic.

---

## 9. Thứ tự triển khai (gợi ý)

1. `Server` model + `ServersModule` (CRUD + test connection).
2. Refactor engine: `DockerService`/`CaddyService` nhận server context.
3. Frontend: trang Servers + chọn server khi tạo project.
4. Setup script cho VPS user.
5. (Sau) Agent (lựa chọn B) để khỏi lưu SSH key.

**Độ khó:** trung bình. Khó nhất: quản Caddy trên server từ xa + đồng bộ nhiều server.
**Tương thích ngược:** `serverId` null ⇒ chạy như hiện tại — không phá gì.
