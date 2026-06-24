# Luồng deploy chi tiết theo loại app

Tài liệu này mô tả **4 luồng deploy riêng biệt** mà DeployBox phải hỗ trợ, mỗi loại có bản chất kỹ thuật khác nhau. Hai loại web là **hosting** (chạy/serve trên VPS của ta), hai loại mobile **KHÔNG phải hosting** mà là **CI/CD + phân phối artifact** (APK/AAB/IPA tới store hoặc trang tải).

Liên quan:
- Hạ tầng từng thành phần: [02-tech-stack.md](02-tech-stack.md)
- Gắn domain + cấp SSL: [04-domain-ssl.md](04-domain-ssl.md)
- Chi tiết phần mobile (runner, Fastlane, ký số, Shorebird): [07-phase-2-mobile.md](07-phase-2-mobile.md)
- Cô lập code lạ khi build/run trên SaaS: [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md)

---

## 0. Khái niệm chung cho mọi luồng

Mọi deploy đều đi qua **một pipeline job** chung do **Redis + BullMQ** điều phối. Khác biệt nằm ở các bước `build` và `deliver`.

```
[Dashboard / Webhook Git]
        │  tạo Deployment record (Postgres/Prisma)
        ▼
[API NestJS] ──enqueue──► [Redis + BullMQ]
        │                      │
        │                      ▼
        │              [Build Worker]  ── đọc job
        │                      │
        │   ┌──────────────────┼─────────────────────┐
        │   │ web-static       │ web-backend         │ mobile (android/ios)
        │   ▼                  ▼                     ▼
        │ build static      build Docker image     build trên runner
        │   │                  │                     │
        │   ▼                  ▼                     ▼
        │ Caddy serve dir   run container         sign + upload artifact
        │                   + healthcheck         (store / firebase / trang tải)
        ▼
[Log + artifact → S3-compatible (MinIO / R2)]
[Trạng thái realtime → Dashboard]
```

**Quy ước thuật ngữ dùng xuyên tài liệu:**

| Thuật ngữ | Nghĩa trong DeployBox |
|---|---|
| `App` | Một dự án người dùng đăng ký (gắn 1 repo Git) |
| `Deployment` | Một lần build+deploy cụ thể (1 commit) |
| `Build Worker` | Process tiêu thụ job từ BullMQ, chạy build |
| `Runner` | Máy thực thi build mobile (Linux cho Android, macOS cho iOS) |
| `Artifact` | Kết quả build cần lưu (image digest, AAB, IPA, log) |

> **Lưu ý bảo mật xuyên suốt:** ở bản nội bộ ta **tin user** nên build/run chạy thẳng. Khi lên SaaS, bước `build` và `run` chạy **code không tin cậy** → bắt buộc cô lập (rootless Docker / gVisor / Firecracker / seccomp / network isolation / resource limits). Chi tiết: [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md).

---

## 1. Luồng Web tĩnh (React / Vue / Flutter Web / HTML)

**Bản chất:** build ra một thư mục file tĩnh (HTML/CSS/JS/assets) → để Caddy serve trực tiếp. Không có process chạy 24/7 → **rẻ nhất, dễ nhất, an toàn nhất**.

> Flutter Web **cũng là static**: `flutter build web` ra thư mục `build/web/` → xử lý y hệt React/Vue.

### Input
- Repo Git + branch + commit.
- (Tuỳ chọn) lệnh build & thư mục output do user khai báo; nếu không, **Nixpacks tự nhận diện**.
- Biến môi trường build-time (vd `VITE_API_URL`) — **inject lúc build**, không phải runtime.
- Domain muốn gắn.

### Sơ đồ bước

```
repo ─► detect (Nixpacks) ─► install deps ─► build ─► output dir ─► copy vào volume ─► Caddy serve ─► HTTPS
                                                                                          │
                                                                              gắn domain + SSL ([04])
```

### Các bước build

| Bước | Hành động | Lệnh minh hoạ |
|---|---|---|
| 1. Checkout | Clone repo, checkout commit | `git clone --depth 1 -b <branch>` |
| 2. Detect | Nhận diện framework + output dir | Nixpacks plan, hoặc config user |
| 3. Install | Cài dependencies | `npm ci` / `pnpm i` / `flutter pub get` |
| 4. Build | Build static | `npm run build` / `flutter build web --release` |
| 5. Collect | Lấy thư mục output | `dist/` (Vite), `build/` (CRA), `build/web/` (Flutter) |

**Output dir mặc định theo framework** (nếu user không khai báo):

| Framework | Build command | Output dir |
|---|---|---|
| Vite (React/Vue) | `npm run build` | `dist/` |
| CRA | `npm run build` | `build/` |
| Next.js (static export) | `next build` (`output: 'export'`) | `out/` |
| Vue CLI | `npm run build` | `dist/` |
| Flutter Web | `flutter build web --release` | `build/web/` |
| HTML thuần | (none) | thư mục gốc |

### Chạy / serve

Không có container app. Thư mục output được copy vào volume mà Caddy mount, mỗi App một block trong Caddyfile (sinh tự động):

```caddy
app-abc123.deploybox.internal {
    root * /srv/apps/abc123/current
    file_server
    encode gzip zstd
    try_files {path} /index.html   # SPA fallback (React/Vue/Flutter router)
}
```

- **SPA fallback** (`try_files ... /index.html`) bắt buộc cho app có client-side routing, nếu không refresh deep-link sẽ 404.
- **Atomic switch:** build ra thư mục mới (`releases/<deployId>`) rồi đổi symlink `current` → zero-downtime, rollback chỉ là đổi symlink.
- SSL/domain do Caddy tự lo (Let's Encrypt) — xem [04-domain-ssl.md](04-domain-ssl.md).

### Kết quả
- URL HTTPS chạy ngay.
- Rollback = đổi symlink (tức thì).
- Chi phí runtime ~ 0 (chỉ tốn disk + băng thông).

---

## 2. Luồng Web có backend (Node / Python / Go ...)

**Bản chất:** build thành **Docker image** → chạy **container 24/7** → Caddy proxy vào port nội bộ + **healthcheck + restart policy + inject env/secret**. Đây là loại tốn RAM thật → cần quota + "ngủ" app nhàn rỗi.

### Input
- Repo Git + branch + commit.
- **Cách đóng gói:** Nixpacks (tự nhận diện) **HOẶC** `Dockerfile` do user cung cấp (ưu tiên Dockerfile nếu có).
- Cổng app lắng nghe (`PORT`, mặc định ta inject).
- **Env/Secret** (runtime): connection string, API key... — lưu mã hoá ở DB, inject lúc chạy.
- (Tuỳ chọn) healthcheck path (vd `/healthz`), resource limits (CPU/RAM).
- Domain muốn gắn.

### Sơ đồ bước

```
repo ─► chọn builder ─┬─ có Dockerfile? ─► docker build
                      └─ không?         ─► nixpacks build
                                 │
                                 ▼
                          image (tag = appId:deployId)
                                 │  push → registry nội bộ (tuỳ chọn) / dùng local
                                 ▼
        docker run (env inject, --memory, --cpus, --restart) ─► container
                                 │
                                 ▼
                          chờ HEALTHCHECK pass
                                 │  pass ─► Caddy reverse_proxy sang container mới
                                 │           (đổi upstream) ─► tắt container cũ
                                 ▼
                          HTTPS live ([04])
```

### Các bước build

```bash
# 1. Checkout
git clone --depth 1 -b "$BRANCH" "$REPO" src && cd src && git checkout "$SHA"

# 2a. Nếu user có Dockerfile
docker build -t "deploybox/$APP_ID:$DEPLOY_ID" -f Dockerfile .

# 2b. Nếu KHÔNG có Dockerfile → Nixpacks tự sinh build
nixpacks build . --name "deploybox/$APP_ID:$DEPLOY_ID"
```

Nixpacks tự nhận diện runtime (Node qua `package.json`, Python qua `requirements.txt`/`pyproject.toml`, Go qua `go.mod`...) và sinh image chuẩn — **cùng cơ chế Railway/Coolify dùng**.

### Chạy container

```bash
docker run -d \
  --name "app_${APP_ID}_${DEPLOY_ID}" \
  --restart unless-stopped \              # restart policy
  --memory "512m" --cpus "0.5" \          # resource limit (quota)
  --env-file "/run/secrets/${APP_ID}.env" \   # env/secret injection
  --network deploybox_net \
  --health-cmd "curl -fsS http://localhost:${PORT}/healthz || exit 1" \
  --health-interval 10s --health-retries 3 --health-timeout 3s \
  "deploybox/$APP_ID:$DEPLOY_ID"
```

#### Env / Secret injection
- Lưu **mã hoá at-rest** trong Postgres (hoặc dùng file `/run/secrets` quyền `0600`).
- **KHÔNG** bake secret vào image (sẽ lộ qua `docker history`).
- Inject qua `--env-file` hoặc Docker secrets lúc `run`.
- Build-time arg (vd token private registry) tách riêng, dùng `--secret` của BuildKit để không lưu vào layer.

#### Healthcheck + restart policy
- `--health-cmd`: gọi endpoint app; Worker **chỉ chuyển traffic khi state = `healthy`**.
- `--restart unless-stopped`: container crash → Docker tự dựng lại.
- Healthcheck thất bại quá ngưỡng → đánh dấu deploy `failed`, **giữ nguyên container cũ** (không cắt traffic) → rollback an toàn.
- Healthcheck dài hạn cũng feed vào **Uptime Kuma** (xem [02-tech-stack.md](02-tech-stack.md)).

#### Zero-downtime (blue-green tối giản)
1. Dựng container mới (deployId mới), chờ `healthy`.
2. Đổi `reverse_proxy` upstream trong Caddyfile sang container mới → reload Caddy.
3. Dừng + xoá container cũ.

```caddy
api-abc123.deploybox.internal {
    reverse_proxy app_abc123_<deployId>:3000
    encode gzip zstd
}
```

#### "Ngủ" app nhàn rỗi (chống đốt RAM)
- Theo dõi request gần nhất; quá `N` phút không traffic → `docker stop` container (giải phóng RAM, **không xoá**).
- Request kế tiếp → Caddy/middleware trigger `docker start` (cold start vài giây).
- Cơ chế này tối quan trọng cho chi phí SaaS — chi tiết ở [10-chi-phi-va-van-hanh.md](10-chi-phi-va-van-hanh.md).

### Kết quả
- API/web động chạy 24/7 sau HTTPS, có logs + healthcheck + auto-restart.
- Rollback = trỏ Caddy về image/container cũ.
- Mỗi app = 1+ container → **ăn RAM liên tục** → cần quota.

---

## 3. Luồng Mobile Android (Flutter / React Native)

**Bản chất:** KHÔNG hosting. Đây là **CI/CD + DISTRIBUTION**: build trên **runner Linux** → ra **AAB/APK** → **ký keystore** → phân phối qua Play Internal / Firebase App Distribution / trang tải OTA. Build Android **chạy được trên VPS Linux** (rẻ). Chi tiết runner + Fastlane: [07-phase-2-mobile.md](07-phase-2-mobile.md).

### Input
- Repo Git + branch + commit.
- **Keystore** (`.jks`/`.keystore`) + `storePassword` / `keyPassword` / `keyAlias` — secret nhạy cảm, mã hoá at-rest.
- Service account JSON (nếu đẩy Play Console) / Firebase token (nếu Firebase App Distribution).
- Loại build: `AAB` (Play Store) hay `APK` (trang tải / cài trực tiếp).
- Bản chất app: **Flutter** (`flutter build`) hay **React Native** (`gradlew`).

### Sơ đồ bước

```
repo ─► Linux runner ─► setup SDK (Android SDK + JDK; +Flutter nếu Flutter)
                              │
                              ▼
                       fastlane: build (Gradle / flutter build)
                              │
                              ▼
                       AAB / APK chưa ký (hoặc ký debug)
                              │
                              ▼
                       ký bằng keystore release (Fastlane / apksigner)
                              │
        ┌─────────────────────┼─────────────────────────┐
        ▼                     ▼                          ▼
  Play Internal        Firebase App Dist.          Trang tải OTA
  (supply)             (firebase_app_distribution) (upload APK → S3 + link)
```

### Các bước build (Fastlane)

`fastlane` chuẩn hoá pipeline. Ví dụ lane build + ký + phân phối:

```ruby
# android/fastlane/Fastfile
platform :android do
  desc "Build AAB ký release + đẩy Play Internal"
  lane :internal do
    # Flutter: gradle gọi qua flutter; RN: gọi gradlew trực tiếp
    sh "flutter build appbundle --release"     # ra build/app/outputs/bundle/release/app-release.aab
    upload_to_play_store(                       # = fastlane supply
      track: "internal",
      aab: "../build/app/outputs/bundle/release/app-release.aab",
      json_key: ENV["PLAY_JSON_KEY_PATH"]
    )
  end

  desc "Build APK + đẩy Firebase App Distribution"
  lane :firebase do
    sh "flutter build apk --release"
    firebase_app_distribution(
      app: ENV["FIREBASE_APP_ID"],
      apk_path: "../build/app/outputs/flutter-apk/app-release.apk",
      groups: "testers"
    )
  end
end
```

### Code signing (Android)
- Ký bằng **keystore release** (khác debug keystore). Cấu hình trong `android/app/build.gradle` qua `signingConfigs`, đọc mật khẩu từ **env do DeployBox inject** (không hardcode):

```gradle
signingConfigs {
    release {
        storeFile file(System.getenv("KEYSTORE_PATH"))
        storePassword System.getenv("KEYSTORE_PASSWORD")
        keyAlias System.getenv("KEY_ALIAS")
        keyPassword System.getenv("KEY_PASSWORD")
    }
}
```
- Keystore được DeployBox giải mã, ghi ra file tạm `0600` trong runner, **xoá ngay sau build**.
- Play Store khuyến nghị **Play App Signing**: ta ký bằng *upload key*, Google giữ *app signing key*.

### Phân phối (3 kênh)

| Kênh | Định dạng | Dùng khi | Công cụ |
|---|---|---|---|
| Play Internal Testing | AAB | Tester nội bộ qua Play, tiến tới production | `fastlane supply` |
| Firebase App Distribution | APK/AAB | QA/team nhanh, không cần Play | `firebase_app_distribution` |
| Trang tải OTA | APK | Cài trực tiếp, không qua store | Upload APK → S3 (MinIO/R2) → link + QR |

### Shorebird (Flutter OTA — chỉ Flutter)
- **Shorebird Code Push** cho phép đẩy **patch Dart code** xuống app đã cài **không cần build/submit lại store** (chỉ patch code, không đổi native/asset lớn).
- Luồng: `shorebird release android` (bản gốc) → sau đó `shorebird patch android` để vá.
- DeployBox tích hợp Shorebird như một kênh "deploy mobile nhanh" cho Flutter — chi tiết: [07-phase-2-mobile.md](07-phase-2-mobile.md).

### Kết quả
- File `.aab`/`.apk` ký release lưu ở S3 (artifact) + đẩy kênh phân phối đã chọn.
- (Flutter) có thể OTA patch qua Shorebird.

---

## 4. Luồng Mobile iOS (Flutter / React Native)

**Bản chất:** KHÔNG hosting, và **BẮT BUỘC chạy trên runner macOS** — luật Apple, **VPS Linux không build iOS được**. Build → ký bằng **cert + provisioning profile** → **IPA** → TestFlight. Đây là loại **tốn kém nhất** (cần Mac mini hoặc CI macOS như Codemagic + Apple Developer Program $99/năm). Chi tiết: [07-phase-2-mobile.md](07-phase-2-mobile.md).

### Input
- Repo Git + branch + commit.
- **Apple Developer account** + App Store Connect API key (`.p8` + key id + issuer id).
- **Signing certificate** (`.p12`) + **provisioning profile** (`.mobileprovision`) — hoặc dùng **Fastlane match** (lưu cert mã hoá trong Git repo riêng).
- Bundle ID đã đăng ký + app record trên App Store Connect.

### Sơ đồ bước

```
repo ─► macOS runner (BẮT BUỘC) ─► setup Xcode + CocoaPods (+Flutter)
                                          │
                                          ▼
                                fastlane match: nạp cert + profile
                                          │
                                          ▼
                                build + archive (xcodebuild / flutter build ipa)
                                          │
                                          ▼
                                ký (cert + provisioning) ─► IPA
                                          │
                                          ▼
                                upload TestFlight (App Store Connect API)
                                          │
                                          ▼
                                (sau review) → TestFlight / App Store
```

### Các bước build (Fastlane)

```ruby
# ios/fastlane/Fastfile
platform :ios do
  desc "Build IPA + đẩy TestFlight"
  lane :beta do
    setup_ci                              # tạo keychain tạm trên runner CI
    match(type: "appstore", readonly: true)   # nạp cert + provisioning profile
    # Flutter:
    sh "flutter build ipa --release --export-options-plist=ExportOptions.plist"
    # (hoặc RN/native: build_app(scheme: "App", export_method: "app-store"))
    upload_to_testflight(                 # = pilot, dùng App Store Connect API key
      api_key_path: ENV["ASC_API_KEY_PATH"],
      ipa: "build/ios/ipa/App.ipa",
      skip_waiting_for_build_processing: true
    )
  end
end
```

### Code signing (iOS) — phức tạp hơn Android
- Cần **cặp**: certificate (`.p12`, định danh team) **+** provisioning profile (`.mobileprovision`, gắn app id + devices + cert).
- **Khuyến nghị: `fastlane match`** — lưu cert/profile **mã hoá** trong một Git repo riêng, mọi runner macOS `match` về để có cùng cert → tránh "ký lệch máy".
- Trên runner CI: `setup_ci` tạo **keychain tạm**, import cert, xoá sau build (không để cert tồn trên máy chung).
- Yêu cầu **Apple Developer Program** ($99/năm); thiếu là không ký được.

### Phân phối
- **TestFlight** (qua `upload_to_testflight` / `pilot`): tester nội bộ (tối đa 100, không cần review) hoặc external (cần review nhẹ). Đây là kênh chính cho bản nội bộ/beta.
- **App Store** production: `upload_to_app_store` (`deliver`) — cần review đầy đủ.
- Không có kiểu "trang tải APK" như Android: cài ngoài store chỉ qua TestFlight hoặc Ad Hoc/Enterprise (giới hạn UDID/giấy phép riêng).

### Shorebird (Flutter OTA trên iOS)
- Shorebird **có hỗ trợ iOS** cho Flutter (`shorebird release ios` → `shorebird patch ios`), nhưng patch vẫn nằm trong **chính sách Apple** (chỉ patch Dart, không thay đổi tính năng vi phạm guideline 2.5.2). Hữu ích vá lỗi gấp mà không chờ review.

### Kết quả
- File `.ipa` ký release → TestFlight (build chờ xử lý) → tester cài qua TestFlight.
- (Flutter) có thể OTA patch qua Shorebird trong giới hạn Apple cho phép.

---

## 5. Bảng so sánh 4 loại app

### Độ khó + hạ tầng cần

| Tiêu chí | Web tĩnh | Web backend | Mobile Android | Mobile iOS |
|---|---|---|---|---|
| **Bản chất** | Hosting (serve file) | Hosting (container 24/7) | CI/CD + phân phối | CI/CD + phân phối |
| **Độ khó** | ★ Dễ nhất | ★★★ Trung bình | ★★★★ Khó | ★★★★★ Khó nhất |
| **Build ở đâu** | Build Worker (Linux) | Build Worker (Linux) | Runner **Linux** | Runner **macOS BẮT BUỘC** |
| **Builder** | Nixpacks | Nixpacks / Dockerfile | Gradle / `flutter build` | xcodebuild / `flutter build ipa` |
| **Output** | Thư mục static | Docker image | `.aab` / `.apk` | `.ipa` |
| **Chạy/đích** | Caddy file_server | Container + Caddy proxy | Play / Firebase / trang tải | TestFlight / App Store |
| **Ký số** | Không | Không | Keystore | Cert + provisioning profile |
| **SSL/Domain** | Có ([04]) | Có ([04]) | N/A | N/A |
| **Healthcheck** | N/A (static) | Có (bắt buộc) | N/A | N/A |
| **Chi phí runtime** | ~0 (chỉ disk/băng thông) | **Cao** (RAM 24/7) | 0 (chỉ lúc build) | 0 (chỉ lúc build) |
| **Chi phí ngoài** | — | — | Play Console $25 (1 lần) | **Apple $99/năm + Mac** |
| **OTA (Flutter)** | — (deploy lại = tức thì) | — | Shorebird | Shorebird (giới hạn Apple) |
| **Phase** | Phase 1 | Phase 1 | Phase 2 | Phase 2 |
| **Rủi ro chính** | Thấp | RAM + chạy code lạ (SaaS) | Quản lý keystore | Ký số + chi phí + macOS |

### Hạ tầng bắt buộc theo loại

| Hạ tầng | Web tĩnh | Web backend | Android | iOS |
|---|---|---|---|---|
| Build Worker Linux (Docker) | ✅ | ✅ | — | — |
| Runner Linux (Android SDK + JDK) | — | — | ✅ | — |
| Runner **macOS** (Xcode) | — | — | — | ✅ |
| Caddy (proxy + SSL) | ✅ | ✅ | — | — |
| Volume/disk cho output | ✅ | (image cache) | — | — |
| Docker daemon | — | ✅ | (tuỳ) | — |
| Cloudflare API (DNS) | ✅ ([04]) | ✅ ([04]) | — | — |
| S3-compatible (artifact/log) | log | log + image | ✅ AAB/APK | ✅ IPA |
| Secret store (mã hoá) | env build | env/secret runtime | keystore | cert + ASC key |
| Fastlane | — | — | ✅ | ✅ |

---

## 6. Checklist triển khai theo Phase

**Phase 1 — web (xem [06-phase-1-mvp.md](06-phase-1-mvp.md)):**
- [ ] Web tĩnh: detect Nixpacks → build → atomic symlink → Caddy file_server + SPA fallback.
- [ ] Web backend: Nixpacks/Dockerfile → image → `docker run` với restart + memory + env-file → healthcheck → blue-green qua Caddy.
- [ ] Env/secret mã hoá at-rest, inject lúc run, không bake vào image.
- [ ] Domain + SSL tự động ([04-domain-ssl.md](04-domain-ssl.md)).

**Phase 2 — mobile (xem [07-phase-2-mobile.md](07-phase-2-mobile.md)):**
- [ ] Android: runner Linux + Fastlane + ký keystore (env-injected) + 3 kênh phân phối.
- [ ] iOS: runner macOS + Fastlane match + TestFlight + Apple Developer Program.
- [ ] (Flutter) tích hợp Shorebird cho OTA patch.
- [ ] Keystore/cert mã hoá, ghi file tạm `0600`, xoá ngay sau build.

**Khi lên Phase 3 — SaaS (xem [08-phase-3-saas.md](08-phase-3-saas.md), [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md)):**
- [ ] Cô lập build/run code lạ (rootless Docker / gVisor / Firecracker / seccomp / network isolation).
- [ ] Quota CPU/RAM + "ngủ" app backend nhàn rỗi (chi phí: [10-chi-phi-va-van-hanh.md](10-chi-phi-va-van-hanh.md)).