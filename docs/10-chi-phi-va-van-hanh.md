# Chi phí & vận hành

Tài liệu này phân tích **chi phí thật** và **vận hành** của DeployBox. Nó trả lời câu hỏi tiền bạc cốt lõi: vì sao mỗi app backend ăn RAM 24/7 và điều đó đáng bao nhiêu tiền, các cơ chế tiết kiệm (scale-to-zero, quota, dọn dẹp), bảng ước tính chi phí theo quy mô, và cách vận hành + scale từ 1 VPS lên nhiều node.

Bối cảnh stack đã chốt: xem [02-tech-stack.md](02-tech-stack.md). Luồng deploy theo loại app: xem [03-luong-deploy-theo-loai-app.md](03-luong-deploy-theo-loai-app.md). Phần cô lập bảo mật (gVisor/Firecracker) ảnh hưởng chi phí SaaS được phân tích sâu ở [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md).

---

## 1. Vì sao tiền chảy về RAM (không phải CPU)

Ba loại app trong DeployBox có hồ sơ chi phí **khác nhau hoàn toàn**:

| Loại app | Tài nguyên tốn | Khi nào tốn | Chi phí ẩn |
|---|---|---|---|
| **Web tĩnh** | Đĩa + băng thông | Chỉ khi có request | Gần như 0. File nằm trên đĩa, Caddy serve. Không có process chạy nền. |
| **Web backend** | **RAM 24/7** + CPU lúc xử lý | **Luôn luôn** (container phải sống để nhận request bất kỳ lúc nào) | Cao nhất. Đây là nguồn chi phí số 1. |
| **Mobile (build)** | CPU + RAM **lúc build** | Chỉ khi chạy job build | Theo đợt (bursty). iOS cần macOS — đắt đột biến. |

### 1.1. Cơ chế: vì sao backend ăn RAM 24/7

Một app backend (Node/Python/Go) là một **container chạy liên tục**. Nó phải sống để có thể trả lời request **bất kỳ lúc nào** — kể cả 3 giờ sáng không ai dùng. Khác hẳn web tĩnh (file nằm im trên đĩa, chỉ tốn lúc Caddy đọc).

```
Web tĩnh:     [đĩa] ──(request)──> Caddy đọc file ──> trả về      (0 RAM khi rảnh)
Web backend:  [container Node sống 24/7] <──(request)── Caddy proxy  (RAM cố định cả khi rảnh)
```

RAM là tài nguyên **không chia sẻ được như CPU**. CPU rảnh thì container khác dùng được ngay (time-sharing). Nhưng RAM một khi process đã cấp phát (heap V8, interpreter Python, buffer pool...) thì **giữ chặt** — kernel không thể "cho mượn" mà không swap (swap = chậm khủng khiếp, coi như chết). Nên:

> **RAM là yếu tố quyết định bao nhiêu app backend nhét được vào 1 VPS — không phải CPU, không phải đĩa.**

### 1.2. Con số thực tế: 1 app backend ăn bao nhiêu RAM

Ước tính RAM **thường trú (RSS)** lúc nhàn rỗi cho một app web backend nhỏ:

| Runtime | RAM nhàn rỗi điển hình | Ghi chú |
|---|---|---|
| Go (binary tĩnh) | 15–40 MB | Rẻ nhất. Khuyến khích cho app nội bộ nặng. |
| Node.js (Express/Nest nhỏ) | 60–120 MB | V8 heap + event loop. Phổ biến nhất. |
| Python (FastAPI/Django + gunicorn 2 worker) | 120–250 MB | Mỗi worker tốn riêng. |
| Java/Spring Boot | 250–500 MB+ | Nặng nhất. Tránh nếu được. |

Cộng thêm overhead nền của chính VPS (kernel, Docker daemon, Caddy, NestJS API của DeployBox, Redis, agent monitoring): **~1.5–2 GB cố định**.

**Phép tính sống còn — VPS 8 GB RAM:**

```
RAM khả dụng       = 8 GB
- Overhead hệ thống = 2 GB   (kernel + Docker + Caddy + API + Redis + Postgres nhỏ)
─────────────────────────────
RAM cho app        = 6 GB

Số app Node (giả định cấp 256 MB/app, gồm dư địa burst):
  6144 MB / 256 MB ≈ 24 app backend

Nhưng KHÔNG bao giờ chạy 100%. Để 25% dư địa (burst, GC, spike):
  ≈ 18 app backend an toàn / VPS 8 GB
```

Đây chính là nền tảng cho **quota** (mục 3) và **bảng chi phí** (mục 4).

---

## 2. Cơ chế tiết kiệm #1: Scale-to-zero ("ngủ" app nhàn rỗi)

Phần lớn app nội bộ / demo / staging **không có traffic 90% thời gian**. Trả tiền RAM cho một app cả ngày để phục vụ 5 request là lãng phí. Giải pháp: **scale-to-zero** — dừng container khi nhàn rỗi, khởi động lại khi có request đầu tiên (đánh đổi: request đầu tiên bị chậm — "cold start").

### 2.1. Luồng hoạt động

```
                  Idle > N phút (không request)
   [Container RUNNING] ───────────────────────────> [Container STOPPED]  (RAM = 0)
          ▲                                                   │
          │  Caddy bắt request mới                            │ Request đến
          │  → gọi "waker" → docker start → chờ healthcheck   │
          └───────────────────────────────────────────────────┘
                       Cold start: 1–10s (user thấy "đang khởi động…")
```

Hai mảnh cần xây:

1. **Idle detector**: theo dõi request cuối qua access log của Caddy (hoặc metric request count). Nếu một app không có request > ngưỡng (vd 15 phút) → BullMQ job `stop-idle` → `docker stop`. Trạng thái app chuyển `sleeping` trong Postgres.
2. **On-demand waker**: khi request tới một app đang `sleeping`, Caddy không proxy thẳng mà trỏ tới một **wake handler** (service nhỏ của DeployBox). Handler `docker start` container, poll healthcheck, rồi mới chuyển tiếp request. Caddy hỗ trợ qua cấu hình `reverse_proxy` động + `handle` fallback.

### 2.2. Phác thảo idle detector (NestJS + BullMQ)

```ts
// Chạy định kỳ (vd mỗi 2 phút) qua BullMQ repeatable job.
// idleThresholdMs lấy từ cấu hình app (mặc định 15 phút).
async function sweepIdleApps() {
  const apps = await prisma.app.findMany({
    where: { type: 'BACKEND', status: 'RUNNING', sleepEnabled: true },
  });

  for (const app of apps) {
    const lastReq = await getLastRequestTs(app.id); // đọc từ Caddy access log / metric
    const idleMs = Date.now() - lastReq;
    if (idleMs > app.idleThresholdMs) {
      await sleepQueue.add('stop-idle', { appId: app.id });
    }
  }
}

// Worker xử lý stop-idle
sleepWorker.process('stop-idle', async (job) => {
  const { appId } = job.data;
  await docker.getContainer(containerName(appId)).stop({ t: 10 }); // SIGTERM, chờ 10s
  await prisma.app.update({ where: { id: appId }, data: { status: 'SLEEPING' } });
  logger.log(`App ${appId} put to sleep (RAM freed)`);
});
```

### 2.3. Khi nào BẬT / TẮT scale-to-zero

| Loại app | Scale-to-zero? | Lý do |
|---|---|---|
| Staging / preview / demo nội bộ | **BẬT** (idle 15 phút) | Traffic thưa, chấp nhận cold start. Tiết kiệm RAM khổng lồ. |
| Tool nội bộ ít dùng (cron dashboard, admin nội bộ) | **BẬT** (idle 30–60 phút) | Vài lần/ngày. |
| App production có user thật | **TẮT** | Cold start = trải nghiệm tệ + có thể mất request đang xử lý. |
| App có background job / cron của riêng nó | **TẮT** | Ngủ là job chết. |
| Web tĩnh | Không áp dụng | Vốn đã 0 RAM. |

> **Quan trọng:** với SaaS (Phase 3, xem [08-phase-3-saas.md](08-phase-3-saas.md)), scale-to-zero là **đòn bẩy lợi nhuận** — gói free/hobby ngủ tích cực; gói trả tiền mới được "always-on". Đây là ranh giới giá điển hình của Railway/Render.

---

## 3. Cơ chế tiết kiệm #2: Quota & resource limit

Không có quota, một app rò bộ nhớ (memory leak) hoặc một vòng lặp vô hạn sẽ **ăn sạch RAM/CPU của VPS** và kéo sập mọi app khác (noisy neighbor). Docker cho phép giới hạn cứng từng container.

### 3.1. Giới hạn cấp container (bắt buộc, kể cả bản nội bộ)

```bash
docker run -d \
  --name app_<id> \
  --memory="512m"           `# hard limit RAM — vượt là OOM-kill container đó, không phải cả máy` \
  --memory-swap="512m"      `# = --memory ⇒ CẤM swap (swap = chậm chết)` \
  --cpus="0.5"              `# tối đa 0.5 core (50% 1 vCPU)` \
  --pids-limit=256          `# chống fork bomb` \
  --restart=unless-stopped  `# tự sống lại nếu crash, nhưng tôn trọng lệnh stop (cho scale-to-zero)` \
  app_image:<tag>
```

Bảng quota mặc định gợi ý theo "plan" (dùng được cho cả nội bộ lẫn SaaS sau này):

| Plan | RAM/app | CPU/app | Đĩa/app | Scale-to-zero | Đối tượng |
|---|---|---|---|---|---|
| **internal-default** | 512 MB | 0.5 vCPU | 5 GB | Tùy chọn | App nội bộ team |
| free / hobby (SaaS) | 256 MB | 0.25 vCPU | 1 GB | **Bắt buộc** | Khách free |
| starter (SaaS) | 512 MB | 0.5 vCPU | 5 GB | Tùy chọn | Khách trả tiền nhỏ |
| pro (SaaS) | 2 GB | 1–2 vCPU | 20 GB | Tắt | Production khách |

### 3.2. Quota cấp tài khoản/tenant (cho SaaS)

Lưu trong Postgres, kiểm tra **trước khi** cho deploy:

```prisma
model Tenant {
  id            String @id @default(cuid())
  plan          String                  // free | starter | pro
  maxApps       Int                     // số app tối đa
  maxRamMb      Int                     // tổng RAM được phép
  maxBuildsDay  Int                     // chống lạm dụng build runner
  storageQuotaMb Int                    // tổng artifact + log trong object storage
}
```

Gate khi deploy: tổng RAM các app đang chạy + RAM app mới `> maxRamMb` ⇒ chặn, báo "vượt quota, nâng plan hoặc tắt bớt app".

### 3.3. Build quota

Build cũng tốn tiền (CPU/RAM của runner). Giới hạn:
- Số build/ngày theo plan.
- Timeout build (vd 15 phút) — build treo bị kill.
- Concurrency: tối đa N build song song/VPS (mỗi build Nixpacks/Docker ăn ~1–2 GB RAM tạm thời). Hàng đợi BullMQ giữ phần còn lại.

---

## 4. Cơ chế tiết kiệm #3: Dọn image & container cũ (disk reclaim)

Đĩa đầy âm thầm là nguyên nhân **#1 gây sự cố downtime tự gây ra** trên các PaaS tự host. Mỗi lần build tạo image mới; image cũ, layer mồ côi, container chết, volume thừa, log chất đống.

### 4.1. Cái gì phình ra

| Thứ | Vì sao phình | Cách kiểm soát |
|---|---|---|
| Docker images (mỗi build = 1 image mới) | Deploy nhiều lần/ngày | Giữ N image gần nhất/app, xóa phần còn lại |
| Build cache (Nixpacks/BuildKit) | Layer trung gian | `docker builder prune` định kỳ |
| Container đã dừng | Scale-to-zero, build runner | `docker container prune` |
| Volume mồ côi | App bị xóa | `docker volume prune` (cẩn thận!) |
| Log container (json-file driver) | Chạy lâu | Giới hạn log-driver (mục 6.2) |
| Artifact/log cũ trên object storage | Tích lũy | Lifecycle policy (mục 4.3) |

### 4.2. Job dọn dẹp (chạy hằng đêm qua BullMQ repeatable)

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1) Xóa container đã dừng > 24h (trừ container đang ngủ có chủ đích — tag riêng)
docker container prune -f --filter "until=24h" --filter "label!=deploybox.keep=true"

# 2) Giữ 3 image gần nhất MỖI app, xóa phần thừa.
#    (Script DeployBox tự liệt kê image theo app rồi xóa; ở đây minh hoạ dạng tổng quát)
docker image prune -f --filter "until=168h"        # dangling/untagged > 7 ngày

# 3) Dọn build cache, giữ lại 20GB gần nhất
docker builder prune -f --keep-storage 20GB

# 4) Volume mồ côi — CHỈ chạy khi chắc chắn (app đã xóa khỏi DB).
#    KHÔNG prune mù quáng: dữ liệu user nằm đây.
# docker volume prune -f   # <-- để thủ công, có xác nhận

# 5) Cảnh báo nếu đĩa > 80%
USED=$(df --output=pcent / | tail -1 | tr -dc '0-9')
[ "$USED" -gt 80 ] && echo "ALERT: disk ${USED}% — cần dọn thêm / mở rộng"
```

> **Luật vàng:** image/container/cache prune **tự động** được; **volume prune KHÔNG bao giờ tự động** — đó là dữ liệu user. DeployBox chỉ xóa volume khi app bị xóa hẳn khỏi Postgres, qua flow có xác nhận.

### 4.3. Lifecycle cho object storage (MinIO / R2)

Artifact build và log cũ để mãi sẽ tốn tiền lưu trữ. Đặt policy:
- **Log**: giữ 30 ngày → xóa (hoặc chuyển cold). App nội bộ có thể 14 ngày.
- **Build artifact** (image tarball, web tĩnh bản cũ): giữ 5–10 bản gần nhất/app.

```bash
# Ví dụ với MinIO client (mc): hết hạn log sau 30 ngày
mc ilm rule add myminio/deploybox-logs --expire-days 30
```

---

## 5. BẢNG ƯỚC TÍNH CHI PHÍ THEO QUY MÔ

> Giá tham khảo mặt bằng 2025–2026 (Hetzner/DigitalOcean/Vultr/Cloudflare). **Luôn kiểm tra lại giá hiện hành.** Quy đổi ~1 USD ≈ 25.000 VND chỉ để tham khảo. Các con số làm tròn để lập kế hoạch, không phải báo giá.

### 5.1. Đơn giá thành phần (mốc tham chiếu)

| Thành phần | Mốc giá (USD/tháng) | Ghi chú |
|---|---|---|
| VPS 2 vCPU / 4 GB / 80 GB (Hetzner CX/CPX) | ~5–8 | Rẻ nhất. DigitalOcean tương đương ~24. |
| VPS 4 vCPU / 8 GB | ~15–20 (Hetzner) / ~48 (DO) | "Ngựa thồ" cho nội bộ. |
| VPS 8 vCPU / 16 GB | ~30–35 (Hetzner) / ~96 (DO) | |
| VPS dành cho build runner 8 vCPU / 16 GB | ~30–35 | Tách riêng khi scale. |
| Băng thông egress | Hetzner: ~20 TB kèm theo, gần như free. DO: 1 TB free/droplet rồi ~$10/TB. Cloudflare R2 egress: **$0**. | Khác biệt LỚN giữa nhà cung cấp. |
| Object storage (Cloudflare R2) | $0.015/GB lưu + **egress $0** | Khuyến nghị cho artifact/log. |
| Object storage (MinIO tự host) | = chi phí đĩa VPS | Tự vận hành, không phí egress. |
| Mac mini M-series (mua đứt, cho iOS) | ~$600–800 **một lần** (≈ $50–70/tháng khấu hao 12 tháng) + điện + mạng | iOS build. Xem [07-phase-2-mobile.md](07-phase-2-mobile.md). |
| CI macOS thuê (Codemagic / GitHub Actions macOS) | $0.08–0.12/phút build | Thay cho mua Mac nếu build ít. |
| Apple Developer Program | **$99/năm** (≈ $8.25/tháng) | Bắt buộc để ký + phân phối iOS. |
| Cloudflare DNS + API | **$0** (gói free đủ dùng) | Tự động hóa DNS. Xem [04-domain-ssl.md](04-domain-ssl.md). |
| Domain (.com) | ~$10–15/năm/domain | Let's Encrypt SSL = $0 (Caddy lo). |
| Backup (volume snapshot nhà cung cấp) | ~20% giá VPS | Hoặc tự backup ra R2 rẻ hơn. |

### 5.2. Kịch bản chi phí theo quy mô

**A) Nội bộ team — 1 VPS (Phase 1, ~10–18 app backend + vài web tĩnh):**

| Khoản | Cấu hình | USD/tháng |
|---|---|---|
| VPS chính | 4 vCPU / 8 GB (Hetzner) | ~18 |
| Object storage | R2, ~20 GB artifact+log | ~1 |
| Băng thông | Trong hạn mức Hetzner | ~0 |
| DNS | Cloudflare free | 0 |
| Backup | Snapshot + dump ra R2 | ~4 |
| **Tổng (chưa có mobile)** | | **~23 USD/tháng (~575k VND)** |
| + iOS (nếu cần) | Mac mini khấu hao + Apple Dev | +~60 |

> Điểm mấu chốt: **bản nội bộ cực rẻ** vì 1 VPS gánh được cả chục app. Tiền chỉ nhảy vọt khi đụng iOS (cần macOS) hoặc khi mở SaaS phải cô lập từng tenant.

**B) SaaS — 10 app khách (early, vẫn gói gọn 1 VPS lớn):**

| Khoản | Cấu hình | USD/tháng |
|---|---|---|
| VPS app | 8 vCPU / 16 GB | ~32 |
| Object storage | R2, ~100 GB | ~2 |
| Băng thông | R2 egress $0 + VPS egress trong hạn mức | ~2 |
| DNS | Cloudflare free | 0 |
| Backup | Managed/snapshot | ~8 |
| **Tổng** | | **~44 USD/tháng** (~4.4 USD/app) |

**C) SaaS — 100 app khách (tách vai trò, nhiều node):**

| Khoản | Cấu hình | USD/tháng |
|---|---|---|
| 3–4 node app | 8 vCPU / 16 GB × 3–4 | ~100–130 |
| Node build runner | 8 vCPU / 16 GB ×1 (tách riêng) | ~32 |
| Node proxy/edge | 2 vCPU / 4 GB ×1 (Caddy) | ~8 |
| **Postgres managed** | DO/Hetzner managed, HA | ~30–60 |
| Object storage | R2, ~1 TB | ~15 |
| Băng thông | R2 egress $0; VPS egress | ~10–20 |
| Monitoring | Tự host Prometheus/Grafana (trên node nhỏ) | ~8 |
| **Tổng** | | **~210–280 USD/tháng** (~2.5 USD/app — đơn giá GIẢM nhờ scale-to-zero + chia sẻ overhead) |

**D) SaaS — 1000 app khách (cần điều phối thật):**

| Khoản | Cấu hình | USD/tháng (bậc lớn) |
|---|---|---|
| Cụm node app | ~12–20 node 8 vCPU/16 GB (hoặc K8s, mục 8) | ~600–800 |
| Build runner farm | 3–4 node + autoscale | ~120 |
| Proxy/edge | 2 node Caddy + LB | ~30 |
| Postgres managed HA + replica | | ~150–250 |
| Redis managed (BullMQ) | | ~30–50 |
| Object storage | R2, ~10 TB | ~150 |
| Băng thông | | ~50–150 |
| Monitoring + log tập trung | Loki/Grafana/Prometheus cụm | ~50 |
| **Tổng (rất xấp xỉ)** | | **~1.200–1.700 USD/tháng** |

> Ở quy mô D, **scale-to-zero quyết định sống còn**: nếu 70% app là free và ngủ phần lớn thời gian, RAM thực dùng thấp hơn nhiều con số "1000 × 256 MB". Đây là lý do gói free phải ngủ tích cực — nếu không, biên lợi nhuận âm.

### 5.3. Hai trục chi phí phải nhớ

```
CHI PHÍ = (RAM thường trú của app KHÔNG ngủ)  ← scale-to-zero ép xuống
        + (số phút build × giá runner)         ← build quota ép xuống
        + (GB lưu artifact/log)                ← lifecycle policy ép xuống
        + (egress GB)                          ← chọn R2 (egress $0) ép xuống
        + (iOS: macOS + Apple Dev $99/năm)     ← cố định, không né được nếu làm iOS
```

---

## 6. Vận hành: Monitoring

Stack đã chốt: **Prometheus + Grafana** (metric), **Uptime Kuma** (healthcheck/uptime). Tất cả tự host (chạy chính trên DeployBox — ăn cây nhà lá vườn).

### 6.1. Cần đo cái gì (tối thiểu)

| Tầng | Metric | Nguồn | Ngưỡng cảnh báo |
|---|---|---|---|
| **Host (VPS)** | CPU, RAM, đĩa %, load | `node_exporter` → Prometheus | Đĩa > 80%, RAM > 90% |
| **Docker/container** | RAM/CPU mỗi container, OOM-kill, restart count | `cAdvisor` → Prometheus | Restart > 3 lần/10 phút, OOM-kill bất kỳ |
| **App (uptime)** | HTTP 200 ở healthcheck, response time | **Uptime Kuma** ping endpoint | Down > 2 lần liên tiếp |
| **Hàng đợi build** | Số job chờ, job thất bại, thời gian build | BullMQ → metric tự xuất → Prometheus | Hàng đợi > 50, fail rate > 10% |
| **Caddy** | Request/s, 5xx rate, cert sắp hết hạn | Caddy metrics endpoint → Prometheus | 5xx rate cao, cert < 14 ngày |
| **Postgres** | Connection, slow query, replication lag | `postgres_exporter` | Conn gần max, lag cao |

### 6.2. Sơ đồ thu thập

```
 node_exporter ─┐
 cAdvisor       ├─> Prometheus ──> Grafana (dashboard + alert)
 postgres_exp.  │        │
 caddy /metrics ┘        └──> Alertmanager ──> Slack/Telegram/email (on-call)

 App healthcheck ──> Uptime Kuma ──> Telegram/Slack (status page nội bộ)
```

Dashboard Grafana tối thiểu cho bản nội bộ: **1 dashboard "Host"** (CPU/RAM/đĩa) + **1 dashboard "Apps"** (RAM/restart từng container) + Uptime Kuma làm status page.

---

## 7. Vận hành: Log, Backup, Patch, On-call

### 7.1. Tập trung log

Container log mặc định (json-file) phình đĩa và rời rạc. Hai mức:

**Mức tối thiểu (nội bộ) — giới hạn log tại chỗ + đẩy ra object storage:**

```jsonc
// /etc/docker/daemon.json — giới hạn log MỖI container, chống phình đĩa
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }   // tối đa 30MB/container
}
```

App log truy cập qua API DeployBox (`docker logs` stream → UI). Log của app bị xóa/đã ngủ thì lưu bản nén ra object storage (R2), theo lifecycle 30 ngày (mục 4.3).

**Mức nâng cao (khi nhiều node) — Grafana Loki + Promtail:**
- Promtail trên mỗi node gom log container → đẩy về **Loki** (rẻ hơn ELK nhiều, hợp hệ Grafana sẵn có).
- Truy vấn log tập trung trong Grafana (`{app="x"}`), tương quan với metric cùng timeline.

### 7.2. Backup PostgreSQL + chiến lược khôi phục

Postgres giữ **toàn bộ trạng thái điều khiển**: user, app, domain, build history, quota. Mất nó = mất cả nền tảng (dù container app vẫn chạy, ta không còn quản được). **Backup Postgres là ưu tiên #1.**

**Chiến lược 3 lớp:**

| Lớp | Cách | Tần suất | Lưu ở |
|---|---|---|---|
| **Logical dump** | `pg_dump` (hoặc `pg_dumpall`) | Hằng ngày | Nén → đẩy R2 (off-site) |
| **PITR** (point-in-time recovery) | WAL archiving (`archive_mode=on`) → đẩy WAL ra R2 | Liên tục | R2. Cho phép khôi phục về **bất kỳ giây nào** |
| **Snapshot máy** | Snapshot volume của nhà cung cấp | Hằng ngày | Hạ tầng provider |

```bash
# Dump hằng đêm, nén, mã hóa, đẩy R2 (qua rclone/aws-cli trỏ R2)
#!/usr/bin/env bash
set -euo pipefail
TS=$(date +%F_%H%M)
FILE="/tmp/deploybox_${TS}.sql.gz"
pg_dump -Fc -d deploybox | gzip > "$FILE"
# Mã hóa trước khi rời máy (gpg) rồi upload
gpg --symmetric --cipher-algo AES256 --batch --passphrase-file /etc/deploybox/backup.key "$FILE"
aws s3 cp "${FILE}.gpg" s3://deploybox-backups/postgres/ --endpoint-url "$R2_ENDPOINT"
rm -f "$FILE" "${FILE}.gpg"
```

**Quy tắc 3-2-1**: 3 bản sao, 2 loại lưu trữ khác nhau, 1 bản off-site (R2 chính là off-site).

**Chiến lược khôi phục — định nghĩa rõ RTO/RPO:**

| Chỉ số | Mục tiêu nội bộ | Ý nghĩa |
|---|---|---|
| **RPO** (mất tối đa bao nhiêu data) | ≤ 5 phút (nhờ WAL/PITR) hoặc ≤ 24h (nếu chỉ dump) | Quyết định có cần PITR không |
| **RTO** (khôi phục mất bao lâu) | ≤ 1 giờ | Phải đo bằng diễn tập thật |

> **BẮT BUỘC diễn tập khôi phục** (ít nhất 1 lần/quý): tải dump mới nhất về **máy/VPS test**, `pg_restore`, kết nối API tới DB phục hồi, kiểm tra đăng nhập + danh sách app khớp. **Backup chưa từng restore = không có backup.**

```bash
# Diễn tập restore (trên VPS test, KHÔNG phải prod)
createdb deploybox_restore_test
gpg --decrypt deploybox_2026-06-24_0300.sql.gz.gpg | gunzip | pg_restore -d deploybox_restore_test
# rồi trỏ một instance API test vào DB này và smoke-test
```

### 7.3. Cập nhật / Patch

| Đối tượng | Cách | Nhịp |
|---|---|---|
| OS (kernel, openssl, sshd...) | `unattended-upgrades` cho bản vá bảo mật tự động; reboot có kế hoạch | Tự động + reboot hằng tuần/khi cần |
| Docker engine | Patch theo bản vá bảo mật | Theo CVE |
| Caddy / Postgres / Redis | Bản minor vá lỗi; major thì test trước | Hằng tháng review |
| DeployBox (Next.js + NestJS) | Deploy bản mới có rollback; migrate Prisma cẩn thận | Theo release |
| Base image build (Nixpacks) | Cập nhật để vá lỗ hổng trong app build ra | Định kỳ |

> Lỗ hổng trong **base image** lan sang **mọi app build sau đó** — đây là điểm patch dễ quên nhưng quan trọng (chi tiết bảo mật ở [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md)).

### 7.4. On-call

Bản nội bộ **không cần on-call 24/7** — chỉ cần **alert đến đúng người + runbook**:

- Alert (Alertmanager + Uptime Kuma) bắn vào **một kênh Telegram/Slack** team đọc được.
- **Runbook ngắn** cho 5 sự cố hay gặp, để cạnh tay:

| Triệu chứng | Hành động đầu tiên |
|---|---|
| Đĩa đầy (>90%) | Chạy job dọn (mục 4.2); `docker system df` xem ai ngốn; xóa image cũ |
| 1 app OOM-kill liên tục | Xem log, tăng `--memory` tạm hoặc bảo chủ app sửa leak |
| VPS RAM > 90% | Xem container nào ngốn (cAdvisor); ép ngủ app idle; cân nhắc tách node (mục 8) |
| Caddy 5xx hàng loạt | Kiểm tra cert hết hạn? upstream chết? reload Caddy |
| Build treo / hàng đợi nghẽn | Kiểm tra runner, kill job timeout, xem Redis/BullMQ |
| DB không kết nối | Postgres còn sống? hết connection? restart có kiểm soát; nặng thì restore |

---

## 8. Lộ trình SCALE: từ 1 VPS lên nhiều node

Nguyên tắc: **scale theo nhu cầu thật, đừng đoán trước**. Đi qua các nấc, mỗi nấc giải quyết một nút cổ chai cụ thể.

### 8.1. Các nấc tiến hóa

```
Nấc 0 — TẤT CẢ TRÊN 1 VPS  (Phase 1 nội bộ)
  [VPS] = Caddy + NestJS API + Postgres + Redis + build + tất cả container app
  Đủ cho: nội bộ team, ~10–18 app backend.
  Nút cổ chai đầu tiên gặp: RAM (do app), HOẶC build ngốn CPU làm app giật.

        │  build làm app giật / build chậm
        ▼
Nấc 1 — TÁCH BUILD RUNNER
  [VPS app] = Caddy + API + Postgres + Redis + container app
  [VPS build] = chỉ chạy worker BullMQ build (Nixpacks/Docker build)
  Vì sao trước tiên: build là tải bursty, nặng CPU/RAM, dễ làm hàng xóm giật.
  Tách ra → app ổn định, build co giãn riêng. (Cũng là bước cô lập bảo mật cho SaaS.)

        │  cần HA cho proxy / nhiều IP vào / nhiều node app
        ▼
Nấc 2 — TÁCH PROXY (edge) + NHIỀU NODE APP
  [LB/proxy] = Caddy đứng trước, route theo domain tới node app đúng
  [VPS app #1..#N] = chứa container app, đăng ký lên proxy
  Cần: service registry nhẹ (DeployBox biết app nào ở node nào — lưu Postgres) +
       Caddy cấu hình động (admin API) để cập nhật upstream khi app dời node.

        │  Postgres thành nút cổ chai / cần HA dữ liệu điều khiển
        ▼
Nấc 3 — TÁCH DATABASE (và Redis) RA RIÊNG / MANAGED
  [Postgres managed HA + replica]  (DO/Hetzner managed, hoặc tự dựng Patroni)
  [Redis managed] cho BullMQ
  Vì sao sau cùng: DB là stateful, tách trễ nhất, nhưng khi tách phải có HA +
  backup/PITR (mục 7.2) vì giờ nó phục vụ cả cụm.
```

### 8.2. Thứ tự tách (và lý do)

| Thứ tự | Tách cái gì | Kích hoạt khi | Vì sao thứ tự này |
|---|---|---|---|
| 1 | **Build runner** | Build làm app giật / build chậm / mở SaaS (cần cô lập build) | Tải bursty, dễ cô lập, lợi ích tức thì |
| 2 | **Proxy + thêm node app** | 1 VPS hết RAM cho app / cần HA vào | Mở rộng ngang phần "ngốn RAM" |
| 3 | **Database + Redis** | DB nghẽn / cần HA dữ liệu điều khiển | Stateful, rủi ro cao nhất, tách sau cùng |

> Lý do **build runner tách trước**: nó stateless, tải theo đợt, và là nguồn gây "giật" rõ nhất cho app cùng máy. Lý do **DB tách sau cùng**: stateful, cần backup/HA, sai một ly mất dữ liệu điều khiển.

### 8.3. Khi nào cần Kubernetes — và khi nào CHƯA

**CHƯA cần K8s (phần lớn hành trình DeployBox):**
- Bản nội bộ và SaaS nhỏ–vừa (tới ~vài trăm app) chạy tốt với **Docker + vài VPS + Caddy + service registry tự code trong Postgres**. K8s lúc này là **gánh nặng vận hành** (control plane, etcd, networking, RBAC, nâng cấp...) lớn hơn lợi ích.
- DeployBox **bản chất là một orchestrator** — ta đang tự xây phần điều phối container ở mức vừa đủ. Thêm K8s = hai lớp orchestrator chồng nhau, phức tạp gấp đôi.
- Triết lý của Dokku/CapRover/Coolify: **tránh K8s cho tới khi thật sự cần** — DeployBox theo đúng tinh thần đó.

**KHI NÀO cân nhắc K8s (hoặc Nomad — nhẹ hơn):**

| Tín hiệu cần K8s | Vì sao |
|---|---|
| Nhiều chục node app, đặt lịch container thủ công không xuể | K8s scheduler giải bài toán bin-packing + reschedule khi node chết |
| Cần tự phục hồi (node chết → tự dời pod sang node khác) trong vài giây | Self-healing là sở trường K8s |
| Cần autoscale app theo metric (HPA) ở quy mô lớn | Cơ chế sẵn có |
| Đội ngũ ĐÃ thạo K8s và có người vận hành chuyên | Chi phí học không còn là rào cản |
| Quy mô ~1000+ app, đa vùng | Bài toán điều phối vượt khả năng tự code |

> **Lựa chọn trung gian:** trước khi nhảy lên K8s, cân nhắc **Docker Swarm** (đơn giản, đủ cho self-healing + multi-node cơ bản) hoặc **HashiCorp Nomad** (nhẹ hơn K8s nhiều, vẫn lo scheduling + self-healing). Với DeployBox, **chỉ lên K8s khi đã chạm ngưỡng nấc 3 + quy mô hàng trăm–nghìn app + có người vận hành chuyên trách**. Trước đó: đừng.

---

## 9. CHECKLIST VẬN HÀNH TỐI THIỂU (bản nội bộ)

Đây là mức **bắt buộc** để bản nội bộ chạy an toàn — không hơn, không kém.

**Trước khi coi là "đang chạy production nội bộ":**

- [ ] Firewall: chỉ mở 22 (SSH, tốt nhất giới hạn IP), 80, 443. Đóng còn lại.
- [ ] SSH key-only, tắt password login; user không phải root chạy daemon.
- [ ] Mọi container có `--memory`, `--cpus`, `--pids-limit` (mục 3.1) — **không container nào không giới hạn**.
- [ ] `--memory-swap = --memory` (cấm swap) trên container.
- [ ] `/etc/docker/daemon.json` giới hạn log `max-size`/`max-file` (mục 7.1).
- [ ] Job dọn dẹp hằng đêm bật (image/container/cache prune — mục 4.2).
- [ ] Cảnh báo đĩa > 80% (Prometheus alert hoặc cron đơn giản).

**Monitoring & cảnh báo:**

- [ ] Prometheus + node_exporter + cAdvisor chạy; Grafana có dashboard Host + Apps.
- [ ] Uptime Kuma ping healthcheck mọi app + endpoint API DeployBox.
- [ ] Alert (đĩa, RAM, OOM-kill, app down, cert < 14 ngày) bắn vào kênh Telegram/Slack team.

**Backup & khôi phục:**

- [ ] `pg_dump` hằng đêm → nén → mã hóa → đẩy R2 (off-site).
- [ ] (Nếu cần RPO thấp) WAL archiving/PITR bật.
- [ ] **Đã diễn tập restore ít nhất 1 lần** và đo được RTO thực tế.
- [ ] Có tài liệu ghi rõ: dump ở đâu, key giải mã ở đâu (KHÔNG để chung chỗ với dump), lệnh restore.

**Bảo trì:**

- [ ] `unattended-upgrades` bật cho bản vá bảo mật OS.
- [ ] Cửa sổ reboot có kế hoạch (vd Chủ nhật đêm) để áp patch kernel.
- [ ] Base image build được cập nhật định kỳ (vá lỗ hổng lan xuống app).
- [ ] DeployBox tự nâng cấp có đường rollback; migration Prisma test trước khi chạy prod.

**Runbook & con người:**

- [ ] Runbook 5 sự cố hay gặp (mục 7.4) để chỗ ai cũng truy cập được.
- [ ] Ít nhất 2 người biết SSH vào, đọc log, restore DB (tránh bus factor = 1).
- [ ] Ghi rõ danh sách app "không được ngủ" và app "production" để không vô tình scale-to-zero nhầm.

> Khi tiến lên SaaS (Phase 3), checklist này **mở rộng** thêm: cô lập tenant (gVisor/Firecracker — [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md)), quota cứng theo tenant (mục 3.2), billing theo usage, và on-call nghiêm túc hơn. Nhưng nền tảng vận hành ở đây **không làm lại** — chỉ bồi thêm.

---

## 10. Tóm tắt

- **RAM, không phải CPU**, quyết định bao nhiêu app backend/VPS — đó là trục chi phí chính. Web tĩnh gần như free; mobile tốn theo đợt build (iOS đắt đột biến vì cần macOS + Apple Dev $99/năm).
- Ba đòn bẩy tiết kiệm: **scale-to-zero** (ngủ app idle), **quota/resource limit** (chống noisy neighbor + định hình giá SaaS), **dọn dẹp** (image/container/cache tự động; volume thì không).
- **1 VPS gánh được cả chục app nội bộ với ~23 USD/tháng.** Đơn giá/app GIẢM khi scale nhờ chia sẻ overhead + scale-to-zero — miễn là quản chặt RAM và egress (chọn R2).
- Vận hành tối thiểu = Prometheus/Grafana + Uptime Kuma + backup Postgres **có diễn tập restore** + runbook. Đừng on-call 24/7 cho bản nội bộ; hãy alert đúng người + runbook.
- Scale theo thứ tự: **build runner → proxy/node app → database**. **Chưa cần Kubernetes** cho tới khi chạm hàng trăm–nghìn app và có người vận hành chuyên trách — trước đó Docker + vài VPS + Caddy là đủ và rẻ hơn nhiều.