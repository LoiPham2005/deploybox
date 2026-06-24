# Phase 2 — Mobile build & distribution

Phase 2 mở rộng DeployBox từ "hosting web" sang bài toán hoàn toàn khác: **mobile không phải hosting, mà là CI/CD + DISTRIBUTION**. Không có container chạy 24/7, không có reverse proxy, không có domain/SSL (xem [04-domain-ssl.md](04-domain-ssl.md) cho phần web). Thay vào đó luồng là: **kéo source → build artifact (APK/AAB/IPA) → ký số (code signing) → đẩy lên kênh phân phối → người dùng cài**.

Nguyên tắc lộ trình (cố định): **Android trước (Linux runner), iOS sau (macOS runner)**. Lý do: Android build được ngay trên hạ tầng Linux đã có từ [06-phase-1-mvp.md](06-phase-1-mvp.md); iOS bắt buộc macOS + tốn tiền cert → để sau khi luồng đã chạy ổn.

---

## 1. Mobile khác web ở đâu (đọc trước khi code)

| Khía cạnh | Web (Phase 1) | Mobile (Phase 2) |
|---|---|---|
| Kết quả build | Docker image / static dir | File nhị phân: `.apk`/`.aab` (Android), `.ipa` (iOS) |
| Sau khi build | Chạy container 24/7 | Build xong là KẾT THÚC compute; chỉ lưu artifact |
| Reverse proxy / SSL | Caddy lo | Không liên quan |
| "Deploy" nghĩa là gì | Đổi container đang chạy | Đẩy file lên store / Firebase / trang tải |
| Ký số | Không cần | BẮT BUỘC (keystore / cert + profile) |
| Hạ tầng build | Linux runner | Android: Linux; **iOS: BẮT BUỘC macOS** |
| Cập nhật cho user | Đổi container là xong | Qua store review (chậm) hoặc OTA (Shorebird) |
| Chi phí ẩn | RAM container | Apple Developer $99/năm, máy macOS, store review |

Hệ quả kiến trúc cho DeployBox: BullMQ job queue (Redis) đã có từ Phase 1 (xem [02-tech-stack.md](02-tech-stack.md)) tái dùng được. Ta chỉ thêm **loại job mới** (`mobile-build-android`, `mobile-build-ios`) và **một class runner mới**, artifact đẩy vào **S3-compatible (MinIO/R2)** đã dựng sẵn.

```
┌──────────────┐   enqueue    ┌─────────────┐
│  Dashboard   │─────────────▶│   Redis     │
│  (Next.js)   │              │  BullMQ     │
└──────────────┘              └──────┬──────┘
                                     │ dispatch theo platform
                     ┌───────────────┴───────────────┐
                     ▼                                ▼
            ┌─────────────────┐            ┌─────────────────────┐
            │ Android runner  │            │   iOS runner        │
            │ (Linux/Docker)  │            │   (macOS BẮT BUỘC)  │
            │ Flutter+Fastlane│            │  Xcode+Fastlane     │
            └────────┬────────┘            └──────────┬──────────┘
                     │ .apk/.aab                      │ .ipa
                     └───────────────┬────────────────┘
                                     ▼
                        ┌────────────────────────┐
                        │  Artifact store (S3)    │
                        │  + DeployBox API ghi DB │
                        └───────────┬─────────────┘
                                    ▼ trigger
              Firebase App Dist / TestFlight / Play / Trang tải nội bộ
```

---

## 2. Android trước — Linux runner

Android build hoàn toàn trên Linux, nên dùng lại runner Docker đã có. Tạo một image base riêng cho mobile.

### 2.1 Image runner Android (Flutter + Android SDK)

```dockerfile
# docker/android-runner.Dockerfile
FROM ghcr.io/cirruslabs/flutter:3.24.0   # đã có Flutter + Android SDK + Java

RUN apt-get update && apt-get install -y ruby-full build-essential && \
    gem install fastlane -NV && \
    rm -rf /var/lib/apt/lists/*

# Cài thêm cmdline-tools / chấp nhận license nếu image base chưa đủ
RUN yes | flutter doctor --android-licenses || true

WORKDIR /workspace
```

> Với React Native: thay base bằng image có Node + Android SDK (vd `reactnativecommunity/react-native-android`) — luồng Fastlane/ký số bên dưới giống hệt.

### 2.2 Luồng job Android trong BullMQ

```
1. Clone repo @ commit  ──▶ /workspace
2. Inject secret ký số  ──▶ keystore + key.properties (từ Vault, RAM/tmpfs)
3. flutter pub get
4. fastlane android <lane>   (build + sign + upload)
5. Thu artifact .aab/.apk    ──▶ upload S3
6. Ghi DB: build_id, version, sha, đường dẫn artifact, kênh phân phối
7. Xoá toàn bộ secret khỏi runner (kể cả tmpfs)
```

### 2.3 Code signing Android — keystore

Android ký bằng một **keystore** (file `.jks`/`.keystore`) chứa private key. **Mất keystore = không update được app trên Play nữa** (phải đổi package name) → đây là secret tối quan trọng.

Tạo keystore (làm 1 lần, lưu an toàn):

```bash
keytool -genkey -v -keystore deploybox-upload.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

Trong project Flutter, `android/app/build.gradle` đọc từ `key.properties` (KHÔNG commit file này):

```properties
# android/key.properties  — sinh động lúc build từ secret
storeFile=/workspace/android/app/upload.jks
storePassword=${KEYSTORE_PASSWORD}
keyAlias=upload
keyPassword=${KEY_PASSWORD}
```

**Khuyến nghị: bật Google Play App Signing.** Khi đó keystore của ta chỉ là **upload key** (Google giữ app signing key thật). Lỡ lộ/mất upload key vẫn xin reset được với Google → giảm rủi ro "mất là chết".

### 2.4 Fastfile Android

```ruby
# android/fastlane/Fastfile
default_platform(:android)

platform :android do
  desc "Build AAB và upload Firebase App Distribution"
  lane :firebase do
    sh("flutter build appbundle --release")
    firebase_app_distribution(
      app: ENV["FIREBASE_ANDROID_APP_ID"],
      android_artifact_type: "AAB",
      android_artifact_path: "../build/app/outputs/bundle/release/app-release.aab",
      groups: "internal-testers",
      service_credentials_file: ENV["FIREBASE_SA_JSON"]  # path tới file SA tạm
    )
  end

  desc "Upload Play Internal testing track"
  lane :play_internal do
    sh("flutter build appbundle --release")
    upload_to_play_store(
      track: "internal",
      aab: "../build/app/outputs/bundle/release/app-release.aab",
      json_key: ENV["PLAY_SA_JSON"]   # service account JSON của Play Console
    )
  end
end
```

---

## 3. Lưu trữ AN TOÀN secret ký số (cốt lõi — đừng làm tắt)

Đây là phần dễ làm ẩu nhất và nguy hiểm nhất. Quy tắc:

**KHÔNG BAO GIỜ commit secret vào Git. KHÔNG để secret nằm lại trên disk runner sau khi build.**

| Secret | Nền tảng | Cách lưu trong DeployBox |
|---|---|---|
| Keystore `.jks` + 2 password | Android | Lưu base64 trong secret store, decode vào tmpfs lúc build |
| Service Account JSON (Firebase/Play) | Android | Secret store, mount file tạm |
| Distribution cert `.p12` + password | iOS | Secret store; tốt hơn: dùng **match** (xem 4.3) |
| Provisioning profile `.mobileprovision` | iOS | match repo / secret store |
| App Store Connect API key (`.p8`) + key_id + issuer_id | iOS | Secret store |

**Triển khai cụ thể cho DeployBox:**

1. **Secret store**: bắt đầu đơn giản với cột mã hoá trong PostgreSQL (envelope encryption, key gốc trong biến môi trường của NestJS API), hoặc dựng **HashiCorp Vault** nếu muốn chuẩn ngay. Mọi secret ký số là **per-project**, ai có quyền vào project mới đọc được.
2. **Inject lúc build**: runner gọi API DeployBox lấy secret → ghi vào **`tmpfs` (RAM, không chạm disk)**:
   ```bash
   mount -t tmpfs -o size=64m tmpfs /secrets
   echo "$KEYSTORE_B64" | base64 -d > /secrets/upload.jks
   ```
3. **Dọn sạch sau build (luôn chạy, kể cả khi fail)**: `umount /secrets` + huỷ container runner. Container ephemeral → mỗi build một container mới, không tái dùng FS.
4. **Không log secret**: Fastlane đặt `FASTLANE_HIDE_*`; pipeline lọc password khỏi log trước khi đẩy S3.
5. **Phân quyền**: Service Account / API key cấp quyền **tối thiểu** (chỉ upload track tương ứng, không cấp owner).

> Liên hệ Phase 3: khi lên SaaS (xem [08-phase-3-saas.md](08-phase-3-saas.md)) cô lập secret giữa các tenant là bắt buộc; rủi ro code lạ chạm secret được phân tích ở [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md).

---

## 4. iOS sau — macOS runner (phần đắt & khó nhất)

### 4.1 Vì sao iOS đắt và khó nhất

| Lý do | Chi tiết |
|---|---|
| **Bắt buộc phần cứng Apple** | Luật Apple: build/ký/archive iOS chỉ chạy trên **macOS + Xcode**. VPS Linux Hetzner/DO/Vultr **không build iOS được** → phải mua Mac mini hoặc thuê CI macOS. |
| **Phí Apple Developer** | **$99/năm** mới có cert phân phối + tạo profile + đẩy TestFlight/App Store. Không trả = không phân phối được ngoài máy mình. |
| **Code signing rắc rối** | Cần đồng bộ 3 thứ: **Certificate** (distribution), **App ID**, **Provisioning Profile** khớp nhau. Sai một cái là fail khó hiểu. |
| **App Store review** | App muốn lên store công khai phải qua review (vài giờ → vài ngày), có thể bị từ chối. TestFlight nhẹ hơn nhưng vẫn cần "beta review" cho external testers. |
| **Giới hạn thiết bị (ad-hoc)** | Phân phối ngoài store kiểu ad-hoc giới hạn **100 thiết bị/năm/loại**, phải đăng ký UDID từng máy. |
| **Bảo trì máy macOS** | Xcode nặng, update macOS/Xcode định kỳ, cập nhật cert hết hạn hằng năm. |

→ Đây là lý do **để Android trước**: chứng minh luồng chạy được với chi phí ~0 phần cứng, rồi mới đầu tư cho iOS.

### 4.2 Image/runner iOS

Không dùng Docker cho build iOS (Xcode không chạy trong container Linux). Runner iOS là **một process trên máy macOS** (Mac mini hoặc agent CI macOS) đăng ký vào BullMQ qua một worker Node nhỏ, hoặc gọi qua CI bên ngoài (xem 4.4).

Checklist setup Mac mini làm runner:

```
[ ] Cài Xcode (App Store) + xcode-select --install
[ ] Cài Homebrew → brew install fastlane
[ ] Cài Flutter SDK (nếu Flutter) / Node + CocoaPods (nếu RN)
[ ] Tạo user CI riêng, hạn chế quyền
[ ] Worker Node kết nối Redis của DeployBox (qua VPN/Tailscale tới VPS)
[ ] Bật auto-login + script khởi động worker khi reboot
[ ] (Bảo mật) FileVault, firewall, không expose ra internet
```

### 4.3 Code signing iOS — dùng Fastlane **match** (khuyến nghị mạnh)

Quản lý cert + profile thủ công là cơn ác mộng. **Fastlane `match`** lưu certificate + provisioning profile (đã mã hoá) trong một **Git repo riêng tư** và đồng bộ về mọi runner → mọi máy ký giống nhau.

```ruby
# ios/fastlane/Matchfile
git_url("git@github.com:org/deploybox-certs.git")  # repo private RIÊNG
storage_mode("git")
type("appstore")                                    # appstore | adhoc | development
app_identifier("com.deploybox.demo")
```

```ruby
# ios/fastlane/Fastfile
default_platform(:ios)

platform :ios do
  desc "Build + upload TestFlight"
  lane :beta do
    setup_ci                                  # tạo temporary keychain trên runner
    match(type: "appstore", readonly: true)   # kéo cert + profile
    build_app(scheme: "Runner", export_method: "app-store")
    upload_to_testflight(
      api_key_path: ENV["ASC_API_KEY_JSON"],  # App Store Connect API key
      skip_waiting_for_build_processing: true
    )
  end
end
```

Lưu trữ an toàn match: passphrase mã hoá repo match + SSH deploy key của repo certs đều nằm trong **secret store** của DeployBox (mục 3), inject vào tmpfs lúc build. App Store Connect **API key (`.p8`)** dùng thay cho login Apple ID + 2FA → hợp cho CI tự động.

### 4.4 Mac mini riêng vs CI macOS thuê — so sánh chi phí

| Tiêu chí | **Mac mini tự host** | **CI macOS thuê** (Codemagic / GitHub Actions macOS runner) |
|---|---|---|
| Chi phí đầu vào | Mua máy 1 lần: **Mac mini M-series ~ $600–800** | $0 đầu tư phần cứng |
| Chi phí vận hành | Điện + internet + chỗ đặt (~vài $/tháng) | **Trả theo build-minute** |
| Giá phút build (tham khảo) | Coi như "miễn phí" sau khi mua | Codemagic: có free tier ~500 phút/tháng, sau đó **~$0.038–0.095/phút**. GitHub Actions macOS: **~$0.08/phút** (đắt gấp ~10 lần Linux) |
| Điểm hoà vốn | Nếu build > ~vài nghìn phút/tháng đều đặn → Mac mini rẻ hơn nhanh | Build thưa thớt → thuê rẻ hơn |
| Bảo trì | **Tự lo**: update Xcode/macOS, cert, máy chết | Nhà cung cấp lo, luôn có Xcode mới |
| Tốc độ khởi động | Máy luôn sẵn → nhanh | Cold start tải image macOS, có thể chậm hơn |
| Mở rộng (nhiều build song song) | Phải mua thêm máy | Co giãn theo nhu cầu |
| Phù hợp giai đoạn | **Nội bộ team build đều** | **Mới bắt đầu / build ít / chưa muốn ôm phần cứng** |

**Khuyến nghị cho DeployBox:**
- **Phase 2 nội bộ, build iOS thưa** → bắt đầu bằng **Codemagic/GitHub Actions macOS** (trả theo phút, không ôm phần cứng).
- **Khi build iOS đều đặn hằng ngày** → mua **1 Mac mini** đặt cạnh team, kết nối VPS qua Tailscale. Rẻ hơn dài hạn và chủ động hơn.
- DeployBox thiết kế runner iOS là **interface chung** (`IosRunner`): hôm nay backend là Codemagic API, mai đổi sang Mac mini local mà không phải sửa luồng job.

---

## 5. Các kênh phân phối — bảng so sánh

| Kênh | Nền tảng | Đối tượng | Cần | Tốc độ phát hành | Giới hạn | Dùng khi |
|---|---|---|---|---|---|---|
| **Firebase App Distribution** | Android + iOS | Tester nội bộ (mời email/group) | Firebase project + SA JSON | Tức thì (không review) | iOS vẫn cần UDID/ad-hoc cert | QA nội bộ, vòng test nhanh nhất |
| **Google Play Internal testing** | Android | Tester (tới 100 email) | Play Console + app đã tạo | Vài phút | Phải tạo app trên Play | Test sát môi trường Play |
| **Google Play Closed/Open testing** | Android | Nhóm lớn / công khai có giới hạn | Play Console | Có review nhẹ | — | Mở rộng beta trước production |
| **TestFlight** | iOS | Internal (25) / External (10.000) | Apple Dev $99 + ASC | Internal: nhanh; External: cần beta review | External chờ review | Beta iOS chuẩn của Apple |
| **Trang tải nội bộ (side-load APK)** | **Chỉ Android** | Bất kỳ ai có link | Trang tải + file APK trên S3 | Tức thì | iOS **không side-load** dễ (cần ad-hoc/MDM) | Phát APK trực tiếp, không qua store |
| **App Store / Google Play production** | Cả hai | Người dùng thật, công khai | Full review | iOS: giờ→ngày; Android: nhanh hơn | Có thể bị từ chối | Release chính thức |

**Lưu ý bất đối xứng Android vs iOS:**
- **Android** linh hoạt: có thể phát APK trực tiếp qua **trang tải nội bộ** (DeployBox host file APK trên S3/MinIO, sinh link + QR) — không cần store, không cần Google.
- **iOS KHÔNG** có side-load tự do: muốn cài ngoài store phải **ad-hoc (đăng ký UDID, ≤100 máy)** hoặc Firebase App Distribution (cũng dựa trên ad-hoc) hoặc **MDM/Enterprise** (chương trình riêng, đắt). Đây là một lý do nữa iOS khó hơn.

Trang tải nội bộ Android trong DeployBox: một route Next.js public (có token) trả trang HTML đơn giản kèm link tải `.apk` từ S3 + mã QR cho điện thoại quét. Liên kết domain/SSL của trang này dùng chung hạ tầng Caddy ở [04-domain-ssl.md](04-domain-ssl.md).

---

## 6. Flutter Shorebird — OTA update và giới hạn

**Shorebird** = code push / OTA cho Flutter: đẩy bản vá **Dart code** xuống thiết bị đã cài, **không cần qua App Store/Play review**. Cực hợp để fix bug nóng.

```bash
# Cài & đăng nhập
shorebird login

# Khởi tạo trong project (lưu app_id vào shorebird.yaml)
shorebird init

# Release (build gốc, có thể patch về sau)
shorebird release android
shorebird release ios

# Đẩy patch OTA cho release đang chạy
shorebird patch android
shorebird patch ios
```

Tích hợp DeployBox: thêm lane Fastlane gọi `shorebird release/patch`; lưu `shorebird.yaml` + token Shorebird trong secret store.

### Giới hạn QUAN TRỌNG của Shorebird (phải hiểu rõ)

| Giới hạn | Giải thích |
|---|---|
| **Chỉ vá được Dart code** | KHÔNG đổi được phần native: dependency native mới, đổi version, asset trong native, permission, Info.plist/AndroidManifest → vẫn phải build + phát hành bản mới qua store. |
| **Phải tuân chính sách store** | Apple/Google cho phép code push nhưng KHÔNG được dùng để thay đổi tính năng cốt lõi vượt mục đích app đã duyệt. Lạm dụng có thể bị phạt. |
| **Chỉ Flutter** | React Native dùng giải pháp khác (CodePush của App Center — đang EOL — hoặc Expo Updates). Shorebird không áp dụng cho RN. |
| **Gắn theo release** | Patch chỉ áp lên đúng release đã `shorebird release`; phải quản lý cẩn thận release nào nhận patch nào. |
| **Có chi phí** | Shorebird có gói miễn phí giới hạn + gói trả phí theo số patch install/MAU — không hoàn toàn free ở quy mô lớn. |
| **Không thay thế store** | Lần cài đầu tiên vẫn phải đến từ store/Firebase/APK. Shorebird chỉ cập nhật về sau. |

> Quy tắc thực dụng: dùng Shorebird cho **hotfix logic Dart**; mọi thay đổi chạm native vẫn đi qua luồng build + phân phối bình thường ở trên.

---

## 7. Checklist hoàn thành Phase 2

**Android (làm trước):**
- [ ] Image runner Android (Flutter/RN + Fastlane) build được trong BullMQ
- [ ] Tạo + lưu keystore an toàn (base64 trong secret store, decode vào tmpfs)
- [ ] Bật Google Play App Signing (chỉ giữ upload key)
- [ ] Lane Fastlane: build AAB/APK + sign + upload Firebase App Distribution
- [ ] Lane Fastlane: upload Play Internal testing
- [ ] Trang tải nội bộ side-load APK (S3 + link + QR) qua Caddy
- [ ] Pipeline dọn sạch secret sau mỗi build (kể cả khi fail)

**iOS (làm sau):**
- [ ] Quyết định Mac mini vs CI macOS thuê (theo mục 4.4) — bắt đầu bằng CI thuê
- [ ] Đăng ký Apple Developer ($99/năm), tạo App ID
- [ ] Thiết lập Fastlane `match` + repo certs private + App Store Connect API key
- [ ] Worker iOS kết nối BullMQ qua Tailscale (nếu Mac mini)
- [ ] Lane Fastlane: build + upload TestFlight
- [ ] Xử lý beta review cho external testers

**Chung:**
- [ ] (Tuỳ chọn) Shorebird cho hotfix OTA Flutter — hiểu rõ giới hạn ở mục 6
- [ ] Bảng kênh phân phối được phản ánh thành lựa chọn trên Dashboard
- [ ] Artifact + log đẩy S3, ghi DB build history (version, sha, kênh)
- [ ] Secret ký số per-project, phân quyền tối thiểu (chuẩn bị cho [08-phase-3-saas.md](08-phase-3-saas.md))

Sau Phase 2, DeployBox đã phủ web tĩnh, web backend và mobile (Android + iOS). Bước tiếp theo là biến nó thành SaaS đa người dùng với cô lập bảo mật, quota và billing — xem [08-phase-3-saas.md](08-phase-3-saas.md). Phân tích rủi ro chạy code không tin cậy (bao gồm cả build mobile của user lạ) ở [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md); chi phí vận hành (gồm Mac mini, build-minute, Apple Developer) ở [10-chi-phi-va-van-hanh.md](10-chi-phi-va-van-hanh.md).