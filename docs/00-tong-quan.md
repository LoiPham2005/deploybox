# Tổng quan & định hướng

## 1. Một câu định nghĩa

> **DeployBox là một PaaS (Platform-as-a-Service) tự host, chạy trên VPS của chính team, cho phép từ một dashboard web: kết nối Git → build → chạy app → tự gắn domain + SSL.** Dùng nội bộ trước, tiến hóa thành SaaS sau.

Hãy hình dung **Coolify / CapRover / Dokku / Dokploy / Railway / Vercel thu nhỏ** — nhưng do mình tự code, tự kiểm soát hạ tầng, và mở rộng được sang **build/distribution cho app mobile** (thứ mà phần lớn PaaS không làm).

---

## 2. Khả thi không? — Có, và đây là vì sao

Đây **không phải** ý tưởng viễn tưởng. Toàn bộ bài toán đã được giải nhiều lần bởi các sản phẩm mã nguồn mở đang chạy production (Coolify, Dokku, CapRover...). Cái mới của ta không nằm ở việc "phát minh", mà ở việc **ghép các mảnh đã có** thành sản phẩm phù hợp với team và lộ trình SaaS riêng.

Bản chất kỹ thuật của một PaaS web rút gọn lại chỉ còn 5 khối, tất cả đều có lời giải mã nguồn mở chín muồi:

```
┌─────────────┐   git push /   ┌──────────────┐   build image   ┌──────────────┐
│  Dashboard  │──connect repo─▶│  Build Queue │────────────────▶│  Docker run  │
│  (Next.js)  │                │ (Redis+Bull) │   (Nixpacks)    │  container   │
└─────────────┘                └──────────────┘                 └──────┬───────┘
       │                                                               │
       │                          ┌──────────────┐  proxy + auto-SSL   │
       └─────────────────────────▶│    Caddy     │◀───────────────────┘
              quản trị/domain     │ (Let's Encr.)│
                                  └──────────────┘
                                         │
                                  app.example.com  ◀── DNS qua Cloudflare API
```

Mỗi khối đều là công nghệ phổ thông, có tài liệu, có cộng đồng. Không có "magic". Chi tiết kiến trúc xem [01-kien-truc-tong-the.md](01-kien-truc-tong-the.md), chi tiết stack xem [02-tech-stack.md](02-tech-stack.md).

**Để giảm rủi ro "tự code từ đầu", Phase 0 bắt buộc cài Coolify thật trước** để hiểu luồng end-to-end (xem [05-phase-0-coolify.md](05-phase-0-coolify.md)).

---

## 3. "Sản phẩm" LÀ gì và KHÔNG LÀ gì

| Tiêu chí | ✅ DeployBox **LÀ** | ❌ DeployBox **KHÔNG LÀ** |
|---|---|---|
| Bản chất | PaaS tự host, tự gắn domain | Hosting/VPS cho thuê (như DigitalOcean) |
| Cách deploy | Connect Git → build → run container | Cho user SSH vào server làm tay |
| Web tĩnh | Build → serve static qua Caddy | CMS/website builder kéo-thả |
| Web backend | Docker container 24/7 + healthcheck + logs | Serverless functions (FaaS) — chưa làm sớm |
| Mobile | **CI/CD + distribution** (APK/AAB/IPA) | "Hosting app mobile" (không tồn tại khái niệm này) |
| Hạ tầng | Tự host trên 1 VPS, mở rộng dần | Multi-cloud, K8s cluster (over-engineering ở v1) |
| Đối tượng v1 | Team nội bộ (tin tưởng user) | Public SaaS chạy code lạ (Phase 3 mới tính) |
| Database của user | **Chưa cung cấp managed DB** ở v1 | Một managed database service |

Tóm gọn: **v1 là "đưa code của team lên mạng với domain riêng, nhanh và lặp lại được"** — không hơn, không kém.

---

## 4. Insight then chốt: Mobile KHÔNG phải "hosting"

Đây là điểm dễ hiểu sai nhất và phải khắc cốt:

- **Web** = có một tiến trình/thư mục **chạy trên server của ta 24/7**, người dùng cuối truy cập qua URL. → Đây là **hosting**.
- **Mobile** = sản phẩm cuối là **một file cài đặt** (`.apk` / `.aab` / `.ipa`) **chạy trên điện thoại người dùng**, KHÔNG chạy trên server ta. → Đây là **build + ký số + phân phối (distribution)**.

```
   WEB (hosting)                          MOBILE (build + distribution)
   ─────────────                          ─────────────────────────────
   code ──▶ container chạy 24/7           code ──▶ build ra artifact ──▶ ký số
            trên VPS của ta                        (.apk/.aab/.ipa)        │
              │                                                            ▼
              ▼                                              Store / TestFlight /
        user mở URL                                          Firebase App Dist / OTA
                                                                     │
                                                                     ▼
                                                         user cài lên điện thoại
```

Hệ quả thực tế phải nhớ ngay từ đầu:

- **iOS bắt buộc build trên macOS** (luật Apple) — VPS Linux **không** build được IPA. Cần Mac mini hoặc CI macOS (Codemagic). → đây là chi phí và độ phức tạp lớn (xem [07-phase-2-mobile.md](07-phase-2-mobile.md) và [10-chi-phi-va-van-hanh.md](10-chi-phi-va-van-hanh.md)).
- **Android** build được trên runner Linux + Fastlane → làm trước.
- **Ký số (code signing)** là phần khó và dễ sai nhất, không phải bước build.
- **Flutter có Shorebird** cho cập nhật OTA (vá code Dart không cần qua store).

Vì khác biệt bản chất này, **Mobile được tách hẳn sang Phase 2**, không trộn vào luồng web của Phase 1.

---

## 5. Hai mục tiêu chồng nhau — và vì sao "nội bộ = MVP của SaaS"

Ta theo đuổi **hai mục tiêu nối tiếp**, không phải hai dự án tách rời:

1. **Mục tiêu gần — Dùng nội bộ team:** giải quyết nỗi đau thật (deploy thủ công, SSH, gắn domain bằng tay). Vì **tin tưởng user** nên bỏ qua được phần cô lập bảo mật nặng nề.
2. **Mục tiêu xa — SaaS/khởi nghiệp:** bán chính năng lực đó cho người ngoài.

**Luận điểm trung tâm:** bản nội bộ làm tốt **chính là MVP của bản SaaS**. Không làm lại từ đầu — chỉ **bồi thêm 3 lớp** lên cùng một lõi:

```
                 ┌─────────────────────────────────────────────┐
   SaaS  (P3) =  │  + Multi-tenant   + Cô lập bảo mật   + Billing/Quota │
                 ├─────────────────────────────────────────────┤
   Lõi   (P1/P2) │  Dashboard · Build · Container · Proxy · DNS · Mobile │  ◀── KHÔNG đổi
                 └─────────────────────────────────────────────┘
```

| Khối | Nội bộ (P1–P2) | SaaS (P3) thêm gì | Có viết lại không? |
|---|---|---|---|
| Dashboard, Build, Container, Proxy, DNS | Làm đầy đủ | Giữ nguyên | Không |
| Phân tách user | 1 team, dùng chung | **Multi-tenant** (org/project/quyền) | Bồi thêm |
| Bảo mật chạy code lạ | Bỏ qua (tin user) | **Cô lập**: gVisor/Firecracker, rootless Docker, seccomp, network/resource limits | Bồi thêm |
| Tiền & giới hạn | Không cần | **Billing + Quota + "ngủ" app nhàn rỗi** | Bồi thêm |

Điều kiện để luận điểm này đúng: **ngay từ P1 phải thiết kế model dữ liệu có sẵn khái niệm `user/team/project`** (dù nội bộ chỉ dùng 1 team) để P3 không phải đập đi. Chi tiết SaaS xem [08-phase-3-saas.md](08-phase-3-saas.md), bảo mật xem [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md).

---

## 6. Sản phẩm tham chiếu — học gì từ ai

Ta **không cạnh tranh trực diện**; ta **học pattern** và đối chiếu phạm vi. Sáu cái tên đáng soi:

| Sản phẩm | Self-host? | Mô hình | Web tĩnh | Web backend | Mobile | Học được gì cho ta |
|---|---|---|---|---|---|---|
| **Coolify** | ✅ OSS | PaaS tự host, có UI đẹp | ✅ | ✅ | ❌ | **Hình mẫu gần nhất.** Luồng connect-Git→build→deploy→domain. Dùng cho Phase 0. |
| **Dokploy** | ✅ OSS | Coolify-like, mới hơn | ✅ | ✅ | ❌ | Cách tổ chức project/service, UI/UX hiện đại |
| **CapRover** | ✅ OSS | PaaS trên Docker Swarm | ✅ | ✅ | ❌ | One-click app, captain-definition, mô hình app/instance |
| **Dokku** | ✅ OSS | "Mini-Heroku", CLI-first | ✅ | ✅ | ❌ | Buildpacks, git-push-to-deploy thuần túy, plugin model |
| **Railway** | ❌ Cloud | PaaS thương mại | ✅ | ✅ | ❌ | **Nixpacks** (auto-detect ngôn ngữ), DX mượt, pricing theo usage |
| **Vercel** | ❌ Cloud | PaaS frontend + serverless | ✅✅ | ⚠️ (serverless) | ❌ | DX deploy web tĩnh/Next.js đỉnh cao, preview deployments |

Hai điểm rút ra:

- **Không sản phẩm tham chiếu nào làm mobile build/distribution.** Đây là khoảng trống ta có thể chiếm (Phase 2) — và cũng là lý do không thể copy nguyên một cái nào.
- **Nixpacks (Railway dùng) là thứ ta lấy lại trực tiếp** để auto-detect ngôn ngữ thay vì bắt user viết Dockerfile (xem [03-luong-deploy-theo-loai-app.md](03-luong-deploy-theo-loai-app.md)).

---

## 7. Phạm vi v1 — Làm gì & Cố tình KHÔNG làm sớm

### ✅ Có trong v1 (Phase 1, nội bộ)

- [ ] Dashboard Next.js: đăng nhập, danh sách app, tạo app từ Git repo
- [ ] Build: Nixpacks tự nhận diện ngôn ngữ **hoặc** Dockerfile do user cung cấp
- [ ] Hàng đợi build Redis + BullMQ, xem **log build** realtime
- [ ] **Web tĩnh**: build → serve static qua Caddy
- [ ] **Web backend**: chạy Docker container 24/7 + healthcheck + auto-restart + **log run**
- [ ] Tự gắn **domain + SSL** qua Caddy (Let's Encrypt) và **DNS qua Cloudflare API** (xem [04-domain-ssl.md](04-domain-ssl.md))
- [ ] Lưu artifact/log lên **S3-compatible** (MinIO/R2)

### ⏸️ Cố tình KHÔNG làm sớm (và lý do)

| Hạng mục | Để phase nào | Vì sao hoãn |
|---|---|---|
| Mobile build (Android→iOS) | **Phase 2** | Bài toán khác hẳn (build+distribution), iOS cần macOS đắt đỏ |
| Multi-tenant thật sự | **Phase 3** | Nội bộ chỉ 1 team; làm sớm là phí công |
| Cô lập chạy code lạ (gVisor/Firecracker...) | **Phase 3** | Tin user nội bộ → chưa cần; đây là **rủi ro #1** khi mở SaaS |
| Billing + Quota + "ngủ" app nhàn rỗi | **Phase 3** | Nội bộ không tính tiền |
| Nhiều VPS / cluster / K8s | Sau P3 | Bắt đầu **1 VPS**; scale ngang là bài toán về sau |
| Managed database cho user | Chưa lên kế hoạch | Tăng độ phức tạp lớn; chưa phải đau chính |
| Serverless / FaaS | Chưa | Khác mô hình container; không nằm trong luồng cốt lõi |

> **Nguyên tắc chống over-engineering:** mọi thứ ở cột "hoãn" chỉ được làm khi có nhu cầu thật, và phải **bồi thêm** chứ không **viết lại**. Nếu một quyết định ở v1 khiến P3 phải đập đi — đó là thiết kế sai.

---

## 8. Ba rủi ro phải nhắc xuyên suốt

1. **Chạy code KHÔNG tin cậy của user** (cả lúc build lẫn lúc run) — **rủi ro số 1** khi lên SaaS. Nội bộ nhẹ vì tin user; SaaS phải có cô lập (xem [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md)).
2. **Chi phí RAM thật:** mỗi app backend là 1 container chạy 24/7 ăn RAM → cần **quota + "ngủ" app nhàn rỗi** (xem [10-chi-phi-va-van-hanh.md](10-chi-phi-va-van-hanh.md)).
3. **iOS build tốn kém:** cần máy macOS + Apple Developer cert (xem [07-phase-2-mobile.md](07-phase-2-mobile.md)).

---

## 9. Bảng "định hướng quyết định" — tóm tắt

| Câu hỏi | Quyết định (cố định) | Ghi chú / thay thế |
|---|---|---|
| Bản chất sản phẩm | **PaaS tự host** | Không phải hosting cho thuê |
| Triết lý lộ trình | **Nội bộ trước → SaaS sau**, nội bộ = MVP của SaaS | Bồi thêm, không viết lại |
| Hạ tầng khởi điểm | **1 VPS** (DigitalOcean / Hetzner / Vultr) | Scale ngang để sau |
| Frontend dashboard | **Next.js** (React + TS) | — |
| Backend/API | **NestJS** (Node + TS) | Thay thế: Go |
| Database + ORM | **PostgreSQL + Prisma** | — |
| Hàng đợi build | **Redis + BullMQ** | — |
| Đóng gói & chạy | **Docker** (container) | — |
| Build auto-detect | **Nixpacks** hoặc Dockerfile của user | Cùng cái Railway/Coolify dùng |
| Reverse proxy + SSL | **Caddy** (auto HTTPS Let's Encrypt) | Thay thế: Traefik |
| Tự động DNS | **Cloudflare API** | — |
| SSL wildcard | **DNS-01 challenge** (Caddy lo) | — |
| Mobile Android | Runner **Linux + Fastlane** | Làm trước |
| Mobile iOS | Runner **macOS (Mac mini/Codemagic) + Fastlane** | Bắt buộc macOS; làm sau |
| Mobile OTA (Flutter) | **Shorebird** | — |
| Object storage | **S3-compatible** (MinIO self-host / Cloudflare R2) | Artifact + log |
| Monitoring | **Prometheus + Grafana** + **Uptime Kuma** | Healthcheck |
| Cô lập code lạ (SaaS) | **gVisor / Firecracker**, rootless Docker, seccomp, network/resource limits | Chỉ Phase 3 |
| Phase 0 | Cài **Coolify** lên 1 VPS, deploy thử | Học luồng trước khi tự code |

---

## 10. Bản đồ tài liệu (đọc tiếp theo)

| File | Nội dung |
|---|---|
| [01-kien-truc-tong-the.md](01-kien-truc-tong-the.md) | Kiến trúc tổng thể các thành phần |
| [02-tech-stack.md](02-tech-stack.md) | Chi tiết tech stack và lý do chọn |
| [03-luong-deploy-theo-loai-app.md](03-luong-deploy-theo-loai-app.md) | Luồng deploy theo từng loại app |
| [04-domain-ssl.md](04-domain-ssl.md) | Domain, DNS Cloudflare, SSL/ACME |
| [05-phase-0-coolify.md](05-phase-0-coolify.md) | Phase 0 — học bằng Coolify |
| [06-phase-1-mvp.md](06-phase-1-mvp.md) | Phase 1 — MVP nội bộ (web) |
| [07-phase-2-mobile.md](07-phase-2-mobile.md) | Phase 2 — mobile build & distribution |
| [08-phase-3-saas.md](08-phase-3-saas.md) | Phase 3 — multi-tenant + billing |
| [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md) | Bảo mật & rủi ro (cô lập code lạ) |
| [10-chi-phi-va-van-hanh.md](10-chi-phi-va-van-hanh.md) | Chi phí & vận hành (RAM, quota, "ngủ" app) |