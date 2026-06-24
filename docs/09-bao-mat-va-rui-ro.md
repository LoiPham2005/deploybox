# Bảo mật & rủi ro

> Tài liệu này tập trung vào **rủi ro số 1 của DeployBox: chạy CODE KHÔNG TIN CẬY của người dùng** — cả lúc **BUILD** (build script là code tuỳ ý do user kiểm soát) lẫn lúc **RUN** (container chạy 24/7). Nó cũng bao quát chống lạm dụng, quản lý secrets và cô lập tenant.
>
> Nguyên tắc xuyên suốt: **bản nội bộ làm NHẸ vì TIN user; bản SaaS làm NẶNG vì KHÔNG tin ai.** Hạ tầng giống nhau, chỉ bồi thêm lớp cô lập khi lên SaaS. Liên quan: [08-phase-3-saas.md](08-phase-3-saas.md), [06-phase-1-mvp.md](06-phase-1-mvp.md), [10-chi-phi-va-van-hanh.md](10-chi-phi-va-van-hanh.md).

---

## 1. Mô hình mối đe doạ (threat model)

### 1.1 Hai thời điểm code lạ chạy

```
                  GIT REPO của user (code + Dockerfile/Nixpacks)
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
   ┌──────────────────┐            ┌──────────────────┐
   │  BUILD TIME      │            │   RUN TIME       │
   │  (build worker)  │            │  (app container) │
   │                  │            │                  │
   │ • npm install    │            │ • web backend    │
   │   chạy postinstall│           │   24/7           │
   │ • Dockerfile RUN │            │ • nhận request   │
   │ • Nixpacks build │            │   từ internet    │
   │ → CODE TUỲ Ý     │            │ → CODE TUỲ Ý     │
   └──────────────────┘            └──────────────────┘
       Ngắn hạn, đặc quyền cao        Dài hạn, bề mặt mạng lớn
       (đụng Docker daemon!)          (egress, lưu dữ liệu)
```

**Hiểu nhầm chết người cần tránh:** nhiều người chỉ lo cô lập RUN time mà quên BUILD time. Nhưng `npm install` chạy script `postinstall`, `pip install` chạy `setup.py`, `Dockerfile` có `RUN <bất kỳ lệnh nào>` — **build script CHÍNH LÀ code tuỳ ý với quyền cao**. Nếu build chạy bằng Docker daemon mặc định (socket `/var/run/docker.sock`), kẻ tấn công build được image rồi **thoát ra host = chiếm cả VPS** (xem [§3.1](#31-build-time-không-bao-giờ-mount-docker-sock)).

### 1.2 Tài sản cần bảo vệ (xếp ưu tiên)

| # | Tài sản | Hậu quả nếu mất |
|---|---------|-----------------|
| 1 | **Host VPS** (kernel, root) | Mất toàn bộ — mọi app, mọi tenant, mọi secret |
| 2 | **Docker daemon / control plane** | Tạo/xoá container tuỳ ý → tương đương mất host |
| 3 | **Secrets** (DB password, API key Cloudflare, JWT secret, S3 key) | Chiếm domain, đọc DB, giả mạo |
| 4 | **Dữ liệu tenant khác** | Rò rỉ dữ liệu chéo → mất khách, vi phạm pháp lý |
| 5 | **Danh tiếng IP / domain** | IP bị blacklist (spam/DDoS) → mọi app gửi mail/gọi API fail |
| 6 | **Hạn mức tài nguyên** (CPU/RAM/disk/băng thông) | Hoá đơn VPS tăng vọt, app khác bị bóp |

### 1.3 Kẻ tấn công là ai theo từng phase

| Phase | "User" là ai | Mức độ tin | Tư thế bảo mật |
|-------|--------------|-----------|----------------|
| Phase 1 (nội bộ) | Thành viên team mình | **TIN** | **Nhẹ** — hardening cơ bản, lo nhầm lẫn hơn là tấn công |
| Phase 3 (SaaS) | Người lạ trên internet | **KHÔNG TIN** | **Nặng** — coi mọi build/app là thù địch |

> Quy ước trong toàn tài liệu: ô **N** = áp dụng cho Nội bộ (Phase 1+), ô **S** = chỉ cần khi lên SaaS (Phase 3). **N+S** = làm sớm vì rẻ và không hại.

---

## 2. Bảng tổng hợp: Rủi ro → Tác động → Giảm thiểu → Phạm vi

| # | Rủi ro | Tác động | Biện pháp giảm thiểu | Áp dụng |
|---|--------|----------|----------------------|:-------:|
| R1 | Build script thoát ra host qua `docker.sock` | Chiếm **toàn bộ VPS** | Build bằng **Kaniko/BuildKit rootless** hoặc **Nixpacks trong sandbox**, KHÔNG mount docker.sock (§3.1) | **N+S** |
| R2 | Container run thoát kernel (container escape, CVE kernel) | Chiếm host từ 1 app | **gVisor** (runsc) cho run; Firecracker microVM ở SaaS (§4) | S (gVisor có thể bật sớm) |
| R3 | Chạy container bằng root → escape dễ | Leo thang đặc quyền | **Rootless Docker** + `USER` non-root trong image + `no-new-privileges` (§4.2) | **N+S** |
| R4 | App đọc/sửa filesystem host hoặc app khác | Rò rỉ/hỏng dữ liệu chéo | `--read-only` rootfs + tmpfs cho `/tmp`; volume riêng từng app (§4.3) | **N+S** |
| R5 | App gọi vào **metadata endpoint** `169.254.169.254` | Lấy cloud credential → chiếm tài khoản VPS | **Egress filtering**: chặn IP nội bộ + link-local (§5.1) | **N+S** (rất rẻ) |
| R6 | App quét/tấn công **mạng nội bộ** (DB control plane, Redis) | Lấy secret, phá control plane | Network namespace riêng + firewall, **không** chung network với control plane (§6) | **N+S** |
| R7 | Syscall nguy hiểm (mount, ptrace, bpf...) | Khai thác lỗ hổng kernel | **seccomp** profile + **AppArmor** + **drop capabilities** (§4.4) | **N+S** |
| R8 | Đào **crypto** ngốn CPU | Hoá đơn tăng, app khác giật | CPU quota (cgroups) + phát hiện CPU 100% kéo dài (§7.1, §5.3) | **N** quota / **S** detection |
| R9 | Gửi **spam mail** / abuse SMTP | IP blacklist, bị nhà cung cấp khoá | Chặn egress **port 25** mặc định; mở có kiểm soát (§5.2) | **N+S** |
| R10 | **DDoS outbound** / flood từ app | IP bị null-route, liên đới pháp lý | Rate-limit băng thông + giới hạn kết nối/giây + abuse detection (§5.3) | S (N: chỉ giám sát) |
| R11 | Lưu **nội dung lậu** (pirated/CSAM) trên storage | Pháp lý nghiêm trọng, mất nhà cung cấp | ToS + quota disk + phản hồi DMCA + (S) quét hash (§8) | S |
| R12 | **Secret bị log** hoặc lộ qua env dump | Lộ credential | Không log env; mã hoá at-rest; inject lúc runtime (§9) | **N+S** |
| R13 | Build cache / image **độc** dùng lại giữa tenant | Nhiễm chéo | Cache theo tenant; không share layer chứa secret (§3.3, §9.4) | S |
| R14 | **DoS control plane** (spam deploy, build vô hạn) | Sập dashboard/queue | Quota số app/build + timeout build + concurrency limit BullMQ (§7.3) | **N** (giới hạn lỏng) / **S** (chặt) |
| R15 | Bom tài nguyên: **fork bomb, đầy disk, OOM** | Treo host | `pids-limit`, disk quota, memory limit + OOM kill (§7.1) | **N+S** |

> Cách đọc: làm hết các dòng **N+S** ngay từ Phase 1 (rẻ, đa số là cờ Docker). Các dòng **S** là việc của [08-phase-3-saas.md](08-phase-3-saas.md).

---

## 3. Cô lập lúc BUILD (build-time isolation)

Đây là phần dễ bị bỏ sót nhất. Build worker dùng **Redis + BullMQ** lấy job (xem [06-phase-1-mvp.md](06-phase-1-mvp.md)), mỗi job là build code lạ.

### 3.1 BUILD TIME: KHÔNG BAO GIỜ mount docker.sock

```
       ┌──────────────────────────────────────────────┐
       │  CÁCH SAI (đừng làm, kể cả nội bộ về lâu dài) │
       │                                              │
       │  worker ──(mount /var/run/docker.sock)──▶ Docker daemon (ROOT)
       │  build script ──┐                            │
       │                 └──▶ `docker run -v /:/host` ▶ ĐỌC/GHI TOÀN HOST
       └──────────────────────────────────────────────┘
```

Vì sao: ai chạm được `docker.sock` thì **tương đương root trên host** — họ chạy được `docker run --privileged -v /:/host` để mount ổ đĩa host.

**Cách đúng — dùng builder không cần daemon đặc quyền:**

- **Nixpacks → BuildKit/Kaniko rootless.** Nixpacks tạo plan rồi sinh image; cho nó build qua **BuildKit rootless** hoặc **Kaniko** (build image trong userspace, không cần docker daemon).
- Nếu vẫn dùng `docker build`, chạy qua **`buildkitd` rootless** (daemon chạy bằng user thường), KHÔNG phải daemon root mặc định.

Ví dụ build bằng BuildKit rootless (không đụng docker.sock):

```bash
# buildkitd chạy rootless, lắng nghe socket của user
buildctl --addr unix:///run/user/1000/buildkit/buildkitd.sock \
  build \
  --frontend dockerfile.v0 \
  --local context=/workspace/src \
  --local dockerfile=/workspace/src \
  --output type=image,name=registry.internal/app-$APP_ID:$SHA,push=true
```

Hoặc Kaniko (chạy chính nó trong 1 container không đặc quyền):

```bash
docker run --rm \
  --read-only --tmpfs /tmp \
  --security-opt no-new-privileges \
  -v /workspace/src:/workspace:ro \
  gcr.io/kaniko-project/executor:latest \
  --dockerfile=/workspace/Dockerfile \
  --context=/workspace \
  --destination=registry.internal/app-$APP_ID:$SHA \
  --no-push=false
```

### 3.2 Bọc bản thân tiến trình build trong sandbox

Ngay cả khi không build image (vd web tĩnh: chỉ `npm ci && npm run build`), bước này **vẫn chạy code lạ** (`postinstall`). Cô lập nó:

| Lớp | Nội bộ (N) | SaaS (S) |
|-----|-----------|----------|
| Nơi chạy build | Container thường + non-root user + giới hạn CPU/RAM | Container trên **gVisor**, hoặc job trong **Firecracker microVM** dùng-một-lần |
| Mạng khi build | Cho ra internet (tải dependency) nhưng **chặn IP nội bộ + metadata** (§5.1) | Như N + chỉ cho tới **proxy mirror** dependency, log mọi egress |
| Filesystem | workspace ghi được, phần còn lại read-only, xoá sau build | Như N + microVM/VM huỷ hẳn sau mỗi build |
| Thời lượng | Timeout build (vd 15 phút) → kill | Timeout chặt hơn + quota build/ngày |
| Đặc quyền | `--security-opt no-new-privileges`, drop caps | Như N |

### 3.3 Vệ sinh sau build

- **Build dùng-một-lần (ephemeral):** mỗi build = workspace mới, xoá sạch sau khi xong (kể cả khi fail). Không tái dùng thư mục giữa hai tenant.
- **Cache cô lập theo tenant** (R13): cache npm/pip/layer gắn khoá theo `tenant_id`, không share giữa các tenant ở SaaS.
- Artifact/log đẩy lên **S3-compatible (MinIO/R2)** theo prefix `tenant_id/app_id/build_id/` (xem [10-chi-phi-va-van-hanh.md](10-chi-phi-va-van-hanh.md)).

---

## 4. Cô lập lúc RUN (runtime isolation)

Mỗi **web có backend** là 1 container chạy 24/7 nhận request internet (xem [03-luong-deploy-theo-loai-app.md](03-luong-deploy-theo-loai-app.md)). Đây là bề mặt tấn công lớn nhất sau khi deploy.

### 4.1 Thang phòng thủ theo mức tin cậy

```
NHẸ ──────────────────────────────────────────────▶ NẶNG
Container thường   Rootless + seccomp   gVisor (runsc)   Firecracker microVM
+ resource limit   + drop caps + RO fs  (kernel ảo)      (VM riêng/tenant)
   (đủ cho NỘI BỘ)        (nên có)         (SaaS)          (SaaS cao cấp)
```

- **Nội bộ (N):** container thường (runc) + non-root + resource limit + egress filter cơ bản là **đủ**, vì ta tin code.
- **SaaS (S):** chạy app trên **gVisor** (runtime `runsc`) để thêm 1 lớp kernel người-dùng (chặn phần lớn container escape). App rủi ro cao hoặc tenant cần cô lập mạnh → **Firecracker microVM**.

Cấu hình gVisor làm runtime mặc định cho app SaaS:

```jsonc
// /etc/docker/daemon.json
{
  "runtimes": {
    "runsc": { "path": "/usr/local/bin/runsc" }
  },
  "default-runtime": "runc"   // control plane vẫn runc; app dùng --runtime=runsc
}
```

```bash
# chạy app SaaS dưới gVisor
docker run --runtime=runsc ...   # (kèm các cờ §4.2–4.4)
```

### 4.2 Rootless + non-root + no-new-privileges (R3) — làm ngay từ Phase 1

```bash
docker run -d \
  --user 10001:10001 \              # non-root TRONG container
  --security-opt no-new-privileges \ # cấm leo thang qua setuid
  --read-only \                      # rootfs chỉ đọc (R4)
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop ALL \                   # bỏ HẾT capability (R7)
  --cap-add NET_BIND_SERVICE \       # chỉ thêm lại cái thật sự cần (nếu cần bind <1024; thường KHÔNG cần vì proxy lo)
  --pids-limit 256 \                 # chống fork bomb (R15)
  --memory 512m --memory-swap 512m \ # trần RAM (R15)
  --cpus 0.5 \                       # trần CPU (R8)
  registry.internal/app-$APP_ID:$SHA
```

Bắt buộc image phải có `USER` non-root (kiểm tra ở khâu build):

```dockerfile
# trong Dockerfile do hệ thống chuẩn hoá / kiểm tra
RUN adduser --disabled-password --uid 10001 appuser
USER 10001
```

> Toàn bộ Docker daemon nên chạy **rootless** trên host (user `deploybox`, không phải root). Khi đó dù app escape khỏi container, nó cũng chỉ là user thường trên host, không phải root.

### 4.3 Filesystem read-only + volume riêng (R4)

- Rootfs `--read-only`; chỗ cần ghi cấp qua **tmpfs** (mất khi restart) hoặc **named volume riêng từng app**.
- Volume đặt tên theo `app_id`/`tenant_id`, **không** bao giờ mount thư mục host chung hay volume của app khác.
- Mount thêm `noexec,nosuid,nodev` cho mọi volume dữ liệu để app không chạy binary lạ từ vùng ghi được.

### 4.4 seccomp / AppArmor (R7)

- **seccomp:** giữ profile mặc định của Docker (đã chặn ~44 syscall nguy hiểm). Ở SaaS có thể siết thêm bằng profile tuỳ biến chặn `mount`, `ptrace`, `bpf`, `kexec_load`, `keyctl`...
- **AppArmor:** bật profile `docker-default`; SaaS viết profile riêng giới hạn đường dẫn ghi.

```bash
docker run \
  --security-opt seccomp=/etc/deploybox/seccomp-strict.json \
  --security-opt apparmor=deploybox-app \
  ...
```

### 4.5 Checklist runtime hardening

- [ ] Container chạy **non-root** (`--user`, `USER` trong image) — **N+S**
- [ ] `--security-opt no-new-privileges` — **N+S**
- [ ] `--cap-drop ALL` (chỉ add lại cái cần) — **N+S**
- [ ] `--read-only` + tmpfs/volume riêng — **N+S**
- [ ] `--pids-limit`, `--memory`, `--cpus` đặt cho mọi app — **N+S**
- [ ] seccomp + AppArmor mặc định bật — **N+S**
- [ ] Docker daemon **rootless** trên host — **N+S** (nên)
- [ ] Runtime **gVisor** cho app — **S**
- [ ] **Firecracker microVM** cho tenant rủi ro cao — **S**

---

## 5. Egress filtering & chống lạm dụng mạng

Quan trọng và **rẻ**: chỉ là rule firewall, nên làm **ngay từ Phase 1**. Bảo vệ chống R5/R9/R10 và phần lớn lạm dụng outbound.

### 5.1 Chặn mạng nội bộ + metadata endpoint (R5, R6) — N+S

App **không có lý do gì** gọi vào IP nội bộ hay metadata cloud. Đây là đường lấy credential VPS phổ biến nhất.

Phải chặn outbound tới:

```
169.254.169.254/32     # cloud metadata (DigitalOcean/AWS/GCP) — NGUY HIỂM NHẤT
169.254.0.0/16         # link-local
10.0.0.0/8             # mạng nội bộ
172.16.0.0/12          # mạng nội bộ (gồm dải docker)
192.168.0.0/16         # mạng nội bộ
127.0.0.0/8            # loopback host (qua host gateway)
```

Mẫu rule iptables áp cho dải container app (giả sử app ở `172.20.0.0/16`):

```bash
# Cho phép DNS + ra internet công cộng, CHẶN nội bộ & metadata
iptables -I DOCKER-USER -s 172.20.0.0/16 -d 169.254.169.254/32 -j DROP
iptables -I DOCKER-USER -s 172.20.0.0/16 -d 169.254.0.0/16    -j DROP
iptables -I DOCKER-USER -s 172.20.0.0/16 -d 10.0.0.0/8        -j DROP
iptables -I DOCKER-USER -s 172.20.0.0/16 -d 172.16.0.0/12     -j DROP
iptables -I DOCKER-USER -s 172.20.0.0/16 -d 192.168.0.0/16    -j DROP
```

> Mẹo: đặt app vào **network Docker riêng** (`--network app_net`, `internal` nếu không cần internet), tách hẳn khỏi network của Postgres/Redis/control plane (xem [§6](#6-cô-lập-tenant--control-plane)). Container app **không bao giờ** chung network với DB control plane.

### 5.2 Chặn cổng nguy hiểm (R9 — spam) — N+S

```bash
# Chặn SMTP outbound (đào spam/relay) — mặc định cấm cả nội bộ
iptables -I DOCKER-USER -s 172.20.0.0/16 -p tcp --dport 25  -j DROP
iptables -I DOCKER-USER -s 172.20.0.0/16 -p tcp --dport 465 -j DROP
iptables -I DOCKER-USER -s 172.20.0.0/16 -p tcp --dport 587 -j DROP
```

App nào cần gửi mail → bắt buộc dùng API nhà cung cấp (SendGrid/SES/Postmark) qua HTTPS, không mở SMTP thô. Ở SaaS, mở port 25 chỉ qua **allowlist theo tenant** sau khi xác minh.

### 5.3 Phát hiện bất thường & rate-limit băng thông (R8, R10)

| Tín hiệu | Ngưỡng ví dụ | Hành động |
|----------|--------------|-----------|
| CPU ~100% liên tục (R8 – đào coin) | > 90% trong 30 phút | Cảnh báo → (S) tự bóp CPU/đình chỉ app |
| Băng thông outbound (R10 – DDoS) | > X GB/giờ hoặc PPS cao bất thường | Throttle + cảnh báo → (S) chặn egress |
| Số kết nối mới/giây | > N conn/s | Rate-limit qua `iptables -m connlimit` / tc |
| Gọi tới nhiều IP lạ liên tục | scan pattern | Cảnh báo abuse |

- Giám sát bằng **Prometheus + Grafana** (cAdvisor/node_exporter); **Uptime Kuma** cho healthcheck (xem [10-chi-phi-va-van-hanh.md](10-chi-phi-va-van-hanh.md)).
- Rate-limit băng thông egress bằng `tc` (traffic control) trên interface của container ở SaaS.
- **Nội bộ:** chỉ cần **giám sát + cảnh báo** (tin user, chỉ lo sự cố vô tình). **SaaS:** phải có **hành động tự động** (throttle/suspend) vì kẻ tấn công chủ động.

---

## 6. Cô lập tenant & control plane

```
            ┌──────────────────────── HOST VPS ────────────────────────┐
            │                                                          │
            │   ┌─────────────── control plane (TIN CẬY) ───────────┐  │
            │   │ NestJS API │ Postgres │ Redis/BullMQ │ Caddy │... │  │
            │   └──────────────────────┬──────────────────────────┘  │
            │            network: cp_net (KHÔNG cho app vào)          │
            │                          │ chỉ Caddy proxy tới app      │
            │   ════════════════════════╪═══════════════════════════  │
            │   ┌─────────┐   ┌─────────┐   ┌─────────┐               │
            │   │tenant A │   │tenant A │   │tenant B │  ◀ app code lạ │
            │   │ app1    │   │ app2    │   │ app1    │               │
            │   └─────────┘   └─────────┘   └─────────┘               │
            │   net: t_A_net      (riêng)   net: t_B_net              │
            └──────────────────────────────────────────────────────────┘
```

**Cô lập mạng:**
- Control plane (NestJS, Postgres, Redis, Caddy) ở **network riêng `cp_net`**; container app **không** được nối vào đó. Caddy là cầu nối **một chiều** (proxy request HTTP từ ngoài vào app), app không gọi ngược control plane.
- Mỗi tenant một **network riêng** (`t_<tenant>_net`); app của tenant này không thấy app của tenant khác. Nội bộ có thể nới lỏng (cùng team), nhưng tách network theo app vẫn nên làm.

**Cô lập dữ liệu (Postgres + Prisma):**
- **Nội bộ (N):** dùng cột `tenant_id`/`owner_id` trên các bảng, lọc ở tầng ứng dụng (Prisma) là đủ.
- **SaaS (S):** siết bằng **Row-Level Security (RLS)** của Postgres để DB tự chặn truy cập chéo, phòng khi lỗi tầng app; cân nhắc **schema/DB riêng theo tenant** cho khách lớn. **DB của app do user deploy** (nếu cấp) phải là instance/credential riêng, không bao giờ dùng chung DB control plane.

**Cô lập storage:** prefix S3 theo `tenant_id/` + chính sách bucket; key truy cập theo tenant, không cấp key chung (xem [§9](#9-quản-lý-secrets)).

---

## 7. Resource limits & chống bom tài nguyên (cgroups)

### 7.1 Trần tài nguyên mỗi app (R8, R15) — N+S

Mọi container, kể cả nội bộ, phải có trần để một app lỗi không kéo sập cả VPS (nhắc lại rủi ro chi phí trong SPINE: mỗi backend ăn RAM 24/7).

| Tài nguyên | Cờ Docker | Mục đích |
|-----------|-----------|----------|
| RAM | `--memory 512m --memory-swap 512m` | OOM-kill app vượt mức, chặn nuốt swap |
| CPU | `--cpus 0.5` (hoặc `--cpu-quota`) | Chống đào coin/ngốn CPU |
| PIDs | `--pids-limit 256` | Chống fork bomb |
| Disk app | quota volume / `--storage-opt size=` (driver hỗ trợ) | Chống đầy disk host |
| I/O | `--device-read-bps`, `--blkio-weight` | Chống làm nghẽn ổ đĩa |

### 7.2 "Ngủ" app nhàn rỗi (sleep idle) — N+S (tối ưu chi phí)

Trực tiếp giảm rủi ro chi phí: app backend nhàn rỗi quá lâu (vd 30 phút không request) → **dừng container**, đánh thức khi có request đến qua Caddy/lớp proxy (cold start). Chi tiết cơ chế ở [10-chi-phi-va-van-hanh.md](10-chi-phi-va-van-hanh.md). Vừa tiết kiệm RAM vừa thu hẹp bề mặt tấn công (app không chạy thì không bị tấn công).

### 7.3 Quota & giới hạn control plane (R14)

| Hạn mức | Nội bộ (N) | SaaS (S) |
|---------|-----------|----------|
| Số app / user | Lỏng (cảnh báo) | Cứng theo gói (Prisma + middleware) |
| Build đồng thời | Concurrency BullMQ vừa phải | Theo gói + xếp hàng |
| Timeout build | Có (vd 15') | Chặt hơn + quota build/ngày |
| Băng thông/tháng | Giám sát | Tính cước / chặn khi vượt |
| Tần suất deploy | — | Rate-limit API (chống spam deploy) |

---

## 8. Chống lưu nội dung lậu & lạm dụng storage (R11)

Chủ yếu là rủi ro **SaaS** (nội bộ tin user). Khi cho người lạ host file:

- **Quota disk/băng thông** theo gói (đã ở §7) hạn chế quy mô lạm dụng.
- **ToS rõ ràng** cấm nội dung vi phạm + **kênh tiếp nhận DMCA/abuse** và quy trình gỡ.
- **Phát hiện & phản ứng:** log truy cập bất thường (1 file tải hàng nghìn lượt từ nhiều IP = phát tán lậu); cân nhắc quét hash với cơ sở dữ liệu nội dung cấm cho ảnh/video công khai.
- **Khoá nhanh:** công cụ vận hành để đình chỉ app/tenant tức thì khi có khiếu nại hợp lệ.
- Giữ **log đủ để hợp tác pháp lý** nhưng tuân thủ quyền riêng tư (chỉ log cần thiết).

---

## 9. Quản lý secrets

Secrets gồm: secret hệ thống (Cloudflare API token cho DNS — xem [04-domain-ssl.md](04-domain-ssl.md), DB control plane, JWT, S3 key) và **secret của app do user khai báo** (biến môi trường runtime).

### 9.1 Mã hoá at-rest (R12) — N+S

- **Không** lưu secret dạng plaintext trong Postgres. Mã hoá ứng dụng-tầng bằng **AES-256-GCM** với khoá từ KMS/`SOPS`/biến môi trường kín; hoặc dùng **Vault**/cloud secret manager ở SaaS.
- Khoá mã hoá (master key) **không** nằm cùng DB; nạp qua biến môi trường của control plane lúc khởi động (hoặc từ secret manager).

```ts
// NestJS: ví dụ mã hoá secret app trước khi ghi Postgres (Prisma)
import { createCipheriv, randomBytes } from 'crypto';

function encryptSecret(plain: string, masterKey: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // lưu iv + tag + ciphertext (base64) vào cột, KHÔNG lưu plaintext
  return Buffer.concat([iv, tag, enc]).toString('base64');
}
```

### 9.2 Không bao giờ log secret (R12) — N+S

- Lọc/redact trước khi ghi log: chặn in `process.env` thô, gắn allowlist key được log.
- Cấm trả secret qua API ở dạng đọc lại (chỉ ghi/đặt, không GET ra plaintext); UI hiển thị `••••••`.
- Build log đẩy lên S3 (§3.3) phải **scrub** chuỗi giống secret (token, key) trước khi lưu.

### 9.3 Injection an toàn lúc runtime — N+S

- Inject secret của app vào container qua **biến môi trường lúc tạo container** (giải mã ngay trước `docker run`), không ghi ra file image, không nhúng vào layer image.
- Tốt hơn (SaaS): mount qua **tmpfs**/secret file thay vì env (env dễ rò qua `/proc/<pid>/environ` và crash dump). Đặt quyền file 0400, chủ là user app.
- Secret hệ thống (Cloudflare token, S3 key) chỉ control plane/worker giữ; **không bao giờ** truyền xuống container app của user.

### 9.4 Không rò secret qua build cache (R13) — S

- Dùng **BuildKit secret mounts** (`RUN --mount=type=secret,...`) thay vì `ARG`/`ENV` để secret build-time **không** dính vào layer image.
- Image của tenant này không tái dùng layer chứa secret cho tenant khác.

### 9.5 Checklist secrets

- [ ] Secret mã hoá AES-256-GCM at-rest, master key tách khỏi DB — **N+S**
- [ ] Không endpoint nào trả secret ra plaintext — **N+S**
- [ ] Logger redact `env`/token/key; build log được scrub — **N+S**
- [ ] Secret app inject lúc runtime, không nhúng vào image — **N+S**
- [ ] Secret hệ thống (Cloudflare/S3) không xuống container user — **N+S**
- [ ] BuildKit secret mounts; cache không share secret giữa tenant — **S**
- [ ] Xoay (rotate) được token Cloudflare/JWT khi lộ — **N+S**

---

## 10. Tóm tắt: Nội bộ (nhẹ) vs SaaS (nặng)

| Hạng mục | Phase 1 — Nội bộ (TIN user) | Phase 3 — SaaS (KHÔNG tin) |
|----------|------------------------------|-----------------------------|
| Build | Builder rootless (Kaniko/BuildKit), **không** docker.sock; container non-root + limit | + gVisor/Firecracker, ephemeral microVM, mirror dependency, cache theo tenant |
| Runtime | runc + non-root + `no-new-privileges` + drop caps + read-only + resource limit | + **gVisor** mặc định, **Firecracker** cho tenant rủi ro cao |
| Mạng | Egress chặn metadata + IP nội bộ + port 25; network app tách control plane | + rate-limit/tc, egress mirror, abuse detection tự động |
| Tenant | Cột `tenant_id` lọc ở Prisma; network riêng theo app | + Postgres RLS, schema/DB riêng cho khách lớn |
| Abuse | **Giám sát + cảnh báo** (Prometheus/Grafana/Uptime Kuma) | + **hành động tự động**: throttle/suspend; ToS + DMCA + quét hash |
| Secrets | Mã hoá at-rest, không log, inject runtime | + secret manager/Vault, BuildKit secret mounts, rotation định kỳ |
| Quota | Resource limit + sleep idle; quota lỏng | Quota cứng theo gói + billing (xem [08-phase-3-saas.md](08-phase-3-saas.md)) |

**Việc cần làm NGAY ở Phase 1 (rẻ, không hại, là nền của SaaS):**

- [ ] Build **không** mount `docker.sock` (Kaniko/BuildKit rootless) — R1
- [ ] Container app: non-root, `no-new-privileges`, `cap-drop ALL`, read-only, `pids/memory/cpu` limit — R3/R4/R7/R15
- [ ] Egress firewall: chặn `169.254.169.254`, dải nội bộ, port 25 — R5/R6/R9
- [ ] Tách network control plane khỏi app; lọc `tenant_id` ở Prisma — R6
- [ ] Secrets mã hoá at-rest + logger redact + inject runtime — R12
- [ ] Resource limit + sleep idle để kiểm soát chi phí — R8/R15
- [ ] Giám sát Prometheus/Grafana + Uptime Kuma, đặt cảnh báo CPU/băng thông — R8/R10

**Để dành cho Phase 3 — SaaS** (chi tiết ở [08-phase-3-saas.md](08-phase-3-saas.md)): gVisor/Firecracker, abuse detection tự động + suspend, Postgres RLS, secret manager, quy trình DMCA/abuse, quota cứng + billing.