# Phase 0 — Học bằng Coolify (~1 tuần)

> Mục tiêu của phase này KHÔNG phải viết code. Mục tiêu là **nhìn tận mắt một PaaS hoạt động thật** để hiểu các mảnh ghép mà sau này chúng ta sẽ tự build trong [06-phase-1-mvp.md](06-phase-1-mvp.md). Coolify là PaaS tự host gần nhất với thứ DeployBox muốn trở thành — nó dùng đúng các thành phần chúng ta đã chọn trong [02-tech-stack.md](02-tech-stack.md) (Docker, Nixpacks, reverse proxy auto-SSL, Cloudflare DNS). Cài nó lên, bấm thử mọi nút, rồi tự hỏi: *"Nếu tự code thì cái này nằm ở đâu trong kiến trúc [01-kien-truc-tong-the.md](01-kien-truc-tong-the.md)?"*

**Tại sao Coolify mà không tự code luôn?** Vì một PaaS có ~6 hệ thống con (git clone → build → image → container → proxy → DNS/SSL) liên kết với nhau. Nếu chưa thấy chúng phối hợp ngoài thực tế, rất dễ thiết kế sai luồng ở Phase 1. Một tuần "chơi" với Coolify rẻ hơn rất nhiều so với một tháng thiết kế lại.

---

## 0. Tổng quan luồng sẽ tự trải nghiệm

```
            ┌──────────────────────────────────────────────────────┐
            │                    1 VPS (Ubuntu)                     │
            │                                                       │
  Git repo ─┼─► [Coolify] ──► git clone ──► Nixpacks/Dockerfile     │
            │       │              build  ──► Docker image          │
            │       │                          │                    │
            │       │                          ▼                    │
            │       │                    docker run (container)     │
            │       │                          │                    │
  Cloudflare│       └──► quản lý ENV/secret    │                    │
   (DNS) ───┼──────────────────────────────────┤                    │
            │                                   ▼                    │
  Internet ─┼──► :443 ──► [Reverse proxy] ──► container (auto-SSL)  │
            │             (Traefik/Caddy của Coolify)               │
            └──────────────────────────────────────────────────────┘
```

> Lưu ý: Coolify mặc định dùng **Traefik** làm reverse proxy (DeployBox sẽ dùng **Caddy** ở Phase 1 — xem [04-domain-ssl.md](04-domain-ssl.md)). Ở Phase 0 KHÔNG quan trọng proxy nào; quan trọng là hiểu *vai trò* của lớp proxy: nhận domain → route vào container → tự xin SSL. Coolify v4 có thể đổi sang Caddy nếu muốn so sánh, nhưng đừng sa đà.

---

## 1. Checklist tổng (theo thứ tự thực hiện)

| # | Việc | Thời gian | Trạng thái |
|---|------|-----------|------------|
| 1 | Thuê VPS + cấu hình cơ bản (SSH, firewall) | 45–60 phút | ☐ |
| 2 | Mua/chọn 1 domain test + đưa DNS về Cloudflare | 30 phút | ☐ |
| 3 | Cài Coolify (1 lệnh) | 20–30 phút | ☐ |
| 4 | Cấu hình ban đầu Coolify (admin, server, wildcard) | 30 phút | ☐ |
| 5 | Deploy **web tĩnh** (React/Vite hoặc HTML) | 45 phút | ☐ |
| 6 | Deploy **web backend + Postgres** | 60–90 phút | ☐ |
| 7 | Gắn **custom domain + bật SSL** cho cả 2 app | 45 phút | ☐ |
| 8 | Thêm **ENV + secret**, redeploy, kiểm chứng | 30 phút | ☐ |
| 9 | Đọc **build log**, mổ xẻ từng giai đoạn | 30 phút | ☐ |
| 10 | Thử **rollback** về version cũ | 30 phút | ☐ |
| 11 | Trả lời bộ **câu hỏi chốt phase** (mục 8) | 60 phút | ☐ |

**Tổng:** ~1–2 ngày làm việc tập trung, trải ra trong ~1 tuần để có thời gian "ngấm". Đừng vội — mục tiêu là *hiểu*, không phải xong nhanh.

---

## 2. Bước 1 — Thuê VPS

Chọn 1 trong 3 nhà cung cấp đã chốt trong SPINE: **DigitalOcean / Hetzner / Vultr**. Hetzner rẻ nhất cho RAM nhiều; DigitalOcean dễ dùng nhất cho người mới.

### Cấu hình tối thiểu cho Phase 0

| Thông số | Tối thiểu | Khuyến nghị | Ghi chú |
|----------|-----------|-------------|---------|
| OS | Ubuntu 22.04 / 24.04 LTS | 24.04 LTS | Coolify hỗ trợ tốt nhất Debian/Ubuntu |
| vCPU | 2 | 2 | Build Docker ăn CPU |
| RAM | **4 GB** | 4 GB | Coolify khuyến nghị tối thiểu 2GB, nhưng build + 2 app + Postgres cần ≥4GB. **Dưới 2GB sẽ OOM khi build.** |
| Disk | 40 GB SSD | 60 GB SSD | Docker image + layer cache ăn disk rất nhanh |
| Băng thông | bất kỳ | — | Test thôi, không lo |

**Chi phí tham khảo:** Hetzner CPX21 (3 vCPU / 4GB) ~€5.8/tháng; DO/Vultr 4GB ~$24/tháng. Xem chi tiết ở [10-chi-phi-va-van-hanh.md](10-chi-phi-va-van-hanh.md). **Tip:** dùng theo giờ rồi destroy sau Phase 0 nếu muốn tiết kiệm.

### Cấu hình cơ bản sau khi có IP

```bash
# 1. SSH vào (lần đầu thường là user root)
ssh root@<VPS_IP>

# 2. Cập nhật hệ thống
apt update && apt upgrade -y

# 3. Mở firewall đúng cổng (Coolify dùng 8000 cho dashboard, 80/443 cho app)
ufw allow 22/tcp      # SSH
ufw allow 80/tcp      # HTTP (ACME/Let's Encrypt cần)
ufw allow 443/tcp     # HTTPS
ufw allow 8000/tcp    # Coolify dashboard
ufw --force enable
ufw status
```

> ⚠️ **Đừng** cài Docker thủ công trước — script cài Coolify sẽ tự lo Docker. Cài trùng dễ xung đột.

**Tiêu chí qua bước:** `ssh root@<VPS_IP>` vào được, `ufw status` thấy các cổng trên ở trạng thái ALLOW.

---

## 3. Bước 2 — Domain test + Cloudflare DNS

Bạn cần 1 domain thật để trải nghiệm SSL/Let's Encrypt cho ra hồn (dùng IP trần thì không xin được cert hợp lệ). Mua domain rẻ (`.xyz`, `.site`, `.dev` ~vài $/năm) hoặc dùng domain bạn đã có.

### Các bản ghi DNS cần tạo (trên Cloudflare)

DeployBox dùng **Cloudflare API** để tự động hoá DNS (xem [04-domain-ssl.md](04-domain-ssl.md)). Ở Phase 0 ta tạo tay trước để hiểu bản chất:

| Type | Name | Content | Proxy | Mục đích |
|------|------|---------|-------|----------|
| A | `coolify` | `<VPS_IP>` | **DNS only (xám)** | Truy cập dashboard |
| A | `app1` | `<VPS_IP>` | DNS only | Web tĩnh |
| A | `api` | `<VPS_IP>` | DNS only | Web backend |
| A | `*` (wildcard) | `<VPS_IP>` | DNS only | Để Coolify tự cấp subdomain |

> 🔶 **QUAN TRỌNG:** Để **proxy status = DNS only (mây xám), KHÔNG bật mây cam (proxied)** trong suốt Phase 0. Lý do: Cloudflare proxy can thiệp vào HTTP-01 challenge của Let's Encrypt và che IP gốc → dễ làm bạn bối rối khi debug SSL. Cứ để DNS thẳng, tự hiểu Let's Encrypt trước; chuyện wildcard cert qua **DNS-01 challenge** và Cloudflare proxy để dành kỹ ở [04-domain-ssl.md](04-domain-ssl.md).

### Kiểm chứng DNS đã trỏ đúng

```bash
dig +short app1.<domain-cua-ban>
# Phải trả về đúng <VPS_IP>

# hoặc
nslookup api.<domain-cua-ban>
```

**Tiêu chí qua bước:** `dig +short coolify.<domain>` trả về đúng IP VPS (chờ DNS propagate, thường < 5 phút với Cloudflare).

---

## 4. Bước 3 — Cài Coolify

Coolify cài bằng đúng 1 lệnh (chạy với quyền root trên VPS):

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Script này sẽ: cài Docker + Docker Compose → kéo các container của Coolify (app, Postgres riêng của Coolify, Redis, Traefik proxy) → khởi động. Mất ~5–15 phút tuỳ mạng.

Sau khi xong, mở trình duyệt:

```
http://<VPS_IP>:8000
```

> 👀 **Quan sát ngay (đây là bài học):** chạy `docker ps` trên VPS. Bạn sẽ thấy Coolify TỰ NÓ là một mớ container Docker (chính nó, db, redis, proxy). Đây là gợi ý kiến trúc: DeployBox cũng sẽ là tập hợp container điều phối các container khác.

```bash
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
```

**Tiêu chí qua bước:** mở được `http://<VPS_IP>:8000` thấy màn hình tạo tài khoản admin.

---

## 5. Bước 4 — Cấu hình ban đầu Coolify

1. **Tạo admin account** (email + mật khẩu mạnh). Đây là tài khoản root của dashboard.
2. **Onboarding wizard** → chọn server **"localhost / this server"** (chính cái VPS đang chạy Coolify). Coolify sẽ validate kết nối Docker.
3. **Đặt domain cho dashboard (tuỳ chọn):** vào *Settings → Instance Domain*, đặt `https://coolify.<domain>` để truy cập dashboard có SSL thay vì IP:8000.
4. **(Tuỳ chọn) Wildcard domain cho server:** vào *Server → Configuration → Wildcard Domain*, nhập `<domain>` để mỗi app mới tự nhận 1 subdomain ngẫu nhiên. Giúp thấy ngay "magic" auto-domain.
5. **Tạo một Project** (vd: `phase0-lab`) + **Environment** (`production`). Mọi app sẽ nằm trong đây.

> 📌 **Tự hỏi:** Coolify lưu cấu hình app/server/secret ở đâu? → Trong **Postgres nội bộ của chính Coolify** (không phải Postgres của app bạn). Đây chính là vai trò mà PostgreSQL + Prisma sẽ đảm nhận trong DeployBox (xem [02-tech-stack.md](02-tech-stack.md)).

**Tiêu chí qua bước:** đăng nhập được dashboard, thấy server "localhost" trạng thái **reachable/healthy**, đã tạo 1 Project.

---

## 6. Bước 5 — Deploy web TĨNH

Đây là loại app số 1 trong [03-luong-deploy-theo-loai-app.md](03-luong-deploy-theo-loai-app.md): build ra static → serve qua proxy.

### Chuẩn bị repo

Dùng repo công khai cho nhanh, ví dụ một app Vite + React tối giản, hoặc tự fork. Nếu chưa có, tạo nhanh local rồi push lên GitHub:

```bash
npm create vite@latest deploybox-static -- --template react
cd deploybox-static && git init && git add . && git commit -m "init"
# tạo repo trên GitHub rồi push
```

### Trong Coolify

1. *Project → + New Resource → Public Repository* (đơn giản nhất, không cần GitHub App).
2. Dán URL repo, branch `main`.
3. **Build Pack:** chọn **Nixpacks** (Coolify tự nhận React/Vite) — đây CHÍNH LÀ Nixpacks mà DeployBox sẽ dùng. Hoặc chọn "Static" nếu chỉ có HTML.
4. **Publish directory:** với Vite là `dist` (Coolify hỏi thư mục output static).
5. Bấm **Deploy**.

### Quan sát

- Mở tab **Logs / Deployments** → xem Nixpacks tự dò ngôn ngữ, chạy `npm install` → `npm run build`.
- Khi xong, Coolify cấp 1 URL (subdomain wildcard). Mở thử.

**Tiêu chí qua bước:** mở URL Coolify cấp → thấy trang web Vite chạy. **Câu hỏi cần trả lời:** Nixpacks đã quyết định build/serve thế nào mà mình không viết Dockerfile?

---

## 7. Bước 6 — Deploy web BACKEND + Database

Đây là loại app số 2 trong [03-luong-deploy-theo-loai-app.md](03-luong-deploy-theo-loai-app.md): chạy container 24/7 + proxy + healthcheck. Đây là phần "thật" nhất, làm kỹ.

### 7.1 Tạo Database trước

1. *Project → + New Resource → Databases → PostgreSQL*.
2. Coolify tạo 1 container Postgres, sinh sẵn user/password/dbname.
3. **Quan sát:** Coolify cung cấp 2 connection string:
   - **Internal** (`postgres://...@<db-name>:5432/...`) — để app khác *trong cùng server* gọi qua mạng Docker nội bộ.
   - **External** — chỉ bật nếu muốn connect từ ngoài (thường tắt cho bảo mật).

> 📌 **Bài học mạng nội bộ:** app backend KHÔNG connect DB qua `localhost` mà qua **tên service trên Docker network**. DeployBox cũng phải tự dựng mạng Docker per-project (liên quan cô lập network ở [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md)).

### 7.2 Deploy app backend

Dùng một app Node/NestJS hoặc Express nhỏ có endpoint `/health` và 1 route đọc/ghi DB. Ví dụ Express tối giản:

```js
// index.js
const express = require('express');
const { Pool } = require('pg');
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.get('/health', (_, res) => res.json({ status: 'ok' }));
app.get('/db', async (_, res) => {
  const r = await pool.query('SELECT NOW()');
  res.json({ now: r.rows[0].now });
});

app.listen(process.env.PORT || 3000, () => console.log('up'));
```

Trong Coolify:

1. *+ New Resource → Public Repository* → repo backend.
2. **Build Pack: Nixpacks** (hoặc Dockerfile nếu repo có sẵn — thử cả 2 cách để so sánh).
3. **Port:** khai báo cổng app listen (vd `3000`). Đây là cổng proxy sẽ route vào.
4. **Healthcheck:** trỏ tới `/health` để Coolify biết container "khoẻ".
5. Deploy.

### 7.3 Nối app với DB qua ENV

- Vào app → tab **Environment Variables** → thêm:
  ```
  DATABASE_URL = <internal connection string của Postgres ở 7.1>
  ```
- Redeploy. Mở `https://<url-app>/db` → phải trả về timestamp từ Postgres.

**Tiêu chí qua bước:** `/health` trả `{status:ok}`, `/db` trả về `now` từ Postgres → tức là **build → container → mạng nội bộ → DB** đã thông suốt.

---

## 8. Bước 7 — Custom domain + SSL

Đây là phần "ảo diệu" của PaaS mà DeployBox phải tự làm bằng Caddy (xem [04-domain-ssl.md](04-domain-ssl.md)).

1. DNS đã trỏ `app1` và `api` về VPS IP từ Bước 2 (DNS only).
2. Trong Coolify, mỗi app → field **Domains** → nhập:
   - Web tĩnh: `https://app1.<domain>`
   - Backend: `https://api.<domain>`
3. Lưu → Coolify cập nhật cấu hình proxy (Traefik) và **tự động xin Let's Encrypt cert** qua HTTP-01 challenge (cổng 80 phải mở — đã làm ở Bước 1).
4. Chờ vài chục giây, mở `https://app1.<domain>` → thấy ổ khoá 🔒 hợp lệ.

### Kiểm chứng SSL

```bash
curl -vI https://api.<domain> 2>&1 | grep -E "subject:|issuer:|HTTP/"
# issuer phải là Let's Encrypt; HTTP/2 200
```

> 📌 **Tự hỏi (cốt lõi cho Phase 1):** Khi mình gõ domain vào ô đó, Coolify đã (a) ghi route domain→container vào proxy, và (b) trigger ACME xin cert — **TỰ ĐỘNG, không reload tay**. DeployBox phải tái tạo đúng 2 hành động này bằng Caddy API + Cloudflare API.

**Tiêu chí qua bước:** cả 2 app mở được qua `https://` với cert Let's Encrypt hợp lệ (không cảnh báo trình duyệt).

---

## 9. Bước 8 — ENV + Secret

1. Mở app backend → **Environment Variables**.
2. Thêm 1 biến thường: `APP_NAME=DeployBox` và 1 biến đánh dấu **secret/locked** (vd `API_KEY=xxxx`, bật toggle "is secret" / 🔒).
3. **Quan sát khác biệt:** biến secret bị che (`••••`) trong UI, biến thường hiện rõ.
4. Redeploy → kiểm chứng app đọc được biến (vd thêm route `/env` in `process.env.APP_NAME`).

> 📌 **Tự hỏi:** Secret được lưu **ở đâu** và **mã hoá không**? → Coolify lưu trong DB nội bộ, có lớp mã hoá (key trong file `.env` của Coolify). DeployBox phải tự quyết: mã hoá-at-rest trong Postgres, hay dùng secret manager? Ghi chú lại cho [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md).

**Tiêu chí qua bước:** thay đổi 1 ENV → redeploy → giá trị mới phản ánh trong app; secret bị che trong UI.

---

## 10. Bước 9 — Đọc build log

Vào tab **Deployments** của một app → click vào 1 lần deploy → đọc log đầy đủ. **Nhận diện các giai đoạn** (đây là bản đồ của build runner mà Phase 1 phải tự code):

```
[1] Cloning repository ...............  ← git clone branch/commit
[2] Nixpacks detecting ...............  ← dò ngôn ngữ (package.json → Node)
[3] Building image ...................  ← docker build (install deps, build)
[4] Pushing/Loading image ............  ← image vào local registry/daemon
[5] Stopping old container ...........  ← graceful stop bản cũ
[6] Starting new container ...........  ← docker run + env + network
[7] Healthcheck ......................  ← chờ /health OK mới cắt traffic
[8] Updating proxy ...................  ← route domain → container mới
```

> 📌 **Đây là phần quan trọng nhất Phase 0.** Mỗi dòng trên = 1 đầu việc trong job queue **BullMQ** của DeployBox (xem [06-phase-1-mvp.md](06-phase-1-mvp.md)). Hãy chép lại trình tự này.

**Tiêu chí qua bước:** chỉ ra được trong log: dòng nào là *clone*, dòng nào là *build image*, dòng nào là *start container*, dòng nào là *gắn proxy*.

---

## 11. Bước 10 — Rollback

1. Đổi gì đó trong code app (vd sửa text trang chủ) → commit → push → **Deploy** lần 2. Giờ có 2 version.
2. Vào tab **Deployments** → tìm bản deploy cũ (thành công) → bấm **Rollback / Redeploy this version**.
3. Mở lại app → thấy nội dung quay về bản cũ.

> 📌 **Tự hỏi:** Rollback nhanh được nhờ đâu? → Coolify **giữ lại Docker image cũ** (theo tag/commit), rollback = `docker run` lại image cũ, KHÔNG build lại. DeployBox phải lưu image theo commit để rollback rẻ (liên quan lưu artifact ở S3-compatible/registry — xem [10-chi-phi-va-van-hanh.md](10-chi-phi-va-van-hanh.md)).

**Tiêu chí qua bước:** rollback thành công và nhanh (giây/chục-giây, không build lại từ đầu).

---

## 12. Các câu hỏi BẮT BUỘC trả lời được sau Phase 0

Viết câu trả lời ra giấy/notion. Nếu chưa trả lời được → quay lại bấm thử Coolify cho đến khi rõ. Đây là điều kiện *thực sự* để kết thúc phase.

| # | Câu hỏi | Gợi ý nơi tìm câu trả lời |
|---|---------|---------------------------|
| 1 | **Build runner** chạy ở đâu, theo trình tự nào? Nó dùng gì để build (Nixpacks/Dockerfile)? | Bước 9 (build log) |
| 2 | Vì sao có app cần **Dockerfile** còn app khác **Nixpacks tự lo**? Khi nào fallback? | Bước 5 & 6 |
| 3 | **Reverse proxy gắn domain vào container** bằng cách nào? Đổi domain có cần reload tay không? | Bước 7 |
| 4 | **SSL/cert** được cấp tự động ra sao? HTTP-01 vs DNS-01 (wildcard)? Cổng nào bắt buộc mở? | Bước 7 + [04-domain-ssl.md](04-domain-ssl.md) |
| 5 | **Secret/ENV lưu ở đâu**, có mã hoá không, app nhận biến lúc nào (build-time vs run-time)? | Bước 8 |
| 6 | App backend **kết nối DB** qua đâu — `localhost` hay tên service Docker network? | Bước 6.1 |
| 7 | **Container "khoẻ"** được xác định thế nào (healthcheck)? Khi nào proxy mới cắt traffic sang bản mới? | Bước 6 & 9 |
| 8 | **Rollback** dựa trên cái gì (image cũ theo commit)? Tốn build lại không? | Bước 10 |
| 9 | Một deploy thất bại thì **fail ở giai đoạn nào**, log báo ra sao? (thử cố ý làm hỏng 1 lần) | Bước 9 |
| 10 | Mỗi app backend là **1 container 24/7** — nó ăn bao nhiêu RAM khi idle? (mở `docker stats`) | `docker stats` trên VPS |

> Câu #10 đặc biệt quan trọng cho rủi ro chi phí trong SPINE: chạy `docker stats` xem RAM thực mỗi container idle → đây là cơ sở cho bài toán quota + "ngủ app nhàn rỗi" ở [10-chi-phi-va-van-hanh.md](10-chi-phi-va-van-hanh.md) và [08-phase-3-saas.md](08-phase-3-saas.md).

---

## 13. Bài tập "phá hoại" (tuỳ chọn nhưng nên làm)

Hiểu hệ thống = hiểu nó *hỏng* thế nào. Mỗi cái ~10 phút:

- [ ] Push commit có **lỗi build** (vd syntax sai) → xem deploy fail ở giai đoạn nào, app cũ có bị chết không (hi vọng KHÔNG — proxy chỉ cắt sang bản mới khi healthcheck pass).
- [ ] Khai báo **sai PORT** → xem proxy báo gì (502/504?).
- [ ] **Tắt healthcheck** rồi deploy app khởi động chậm → xem traffic bị cắt sớm gây lỗi.
- [ ] `docker stats` lúc **đang build** vs lúc **idle** → cảm nhận chi phí RAM/CPU thật.
- [ ] Xoá DNS record của 1 app → reload → quan sát cert/route hỏng thế nào.

---

## 14. ĐỊNH NGHĨA HOÀN THÀNH (Definition of Done) Phase 0

Phase 0 coi là **xong** khi tất cả các ô dưới được tick:

- [ ] VPS chạy, firewall đúng cổng, SSH ổn định.
- [ ] 1 domain test trỏ về VPS qua Cloudflare (DNS only).
- [ ] Coolify cài xong, dashboard truy cập được (qua domain có SSL càng tốt).
- [ ] **Web tĩnh** deploy thành công, mở qua `https://app1.<domain>`.
- [ ] **Web backend + Postgres** deploy thành công; `/health` OK và `/db` đọc được từ DB.
- [ ] Cả 2 app có **custom domain + cert Let's Encrypt hợp lệ**.
- [ ] Đã thêm/sửa **ENV + secret**, redeploy, giá trị phản ánh đúng; secret bị che.
- [ ] Đã đọc và **chú giải được build log** theo 8 giai đoạn (mục 10).
- [ ] Đã **rollback** thành công về version cũ không cần build lại.
- [ ] Đã **viết câu trả lời cho cả 10 câu hỏi** ở mục 12.
- [ ] Đã chạy `docker stats` và ghi lại **RAM idle/peak** của container backend.

> ✅ Khi DoD đạt: bạn đã có "bản đồ tinh thần" đầy đủ của một PaaS. Giờ mở [06-phase-1-mvp.md](06-phase-1-mvp.md) và bắt đầu tự build từng mảnh — nhưng lần này bằng stack của chúng ta: **NestJS + BullMQ + Docker + Nixpacks + Caddy + Cloudflare API + Postgres/Prisma**. Coolify từ đây chỉ còn là *tài liệu tham khảo sống* — khi bí ở Phase 1, quay lại xem Coolify làm gì.

### Dọn dẹp (sau khi xong)

Nếu không giữ VPS này cho Phase 1: snapshot lại (để có thể dựng lại), rồi destroy để khỏi tốn tiền. Nếu giữ: **xoá hết app/DB lab**, giữ máy sạch để Phase 1 cài stack riêng (hoặc dùng VPS mới — khuyến nghị tách bạch để không lẫn Coolify với code của mình).