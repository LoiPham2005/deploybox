# Domain, DNS & SSL hoạt động thế nào

Tài liệu này giải thích đầy đủ cơ chế GẮN DOMAIN + cấp HTTPS tự động cho mỗi app deploy bởi DeployBox. Đây là một trong những phần "ma thuật" mà người dùng cảm nhận rõ nhất: họ push code → vài giây sau có URL `https://...` chạy được ngay. Để hiểu ngữ cảnh tổng thể, xem [01-kien-truc-tong-the.md](01-kien-truc-tong-the.md); để biết SSL nằm ở đâu trong luồng deploy, xem [03-luong-deploy-theo-loai-app.md](03-luong-deploy-theo-loai-app.md).

Toàn bộ phần reverse proxy + cấp SSL do **Caddy** đảm nhiệm (xem lựa chọn stack ở [02-tech-stack.md](02-tech-stack.md)). Tự động tạo DNS do **Cloudflare API** lo.

---

## 1. Hai chế độ gắn domain

DeployBox hỗ trợ song song hai chế độ. Mỗi app có ÍT NHẤT một subdomain tự sinh, và CÓ THỂ thêm nhiều custom domain.

| | (a) Subdomain tự sinh | (b) Custom domain |
|---|---|---|
| Ví dụ | `ten-app.deploybox.app` | `app.khachhang.com` |
| Ai sở hữu zone DNS | DeployBox (ta) | User |
| Cấp ngay khi deploy? | Có, tức thì | Không, chờ user trỏ DNS + verify |
| Cần verify quyền sở hữu? | Không (zone của ta) | CÓ (TXT record) |
| Loại cert | Wildcard `*.deploybox.app` (1 cert dùng chung) | Cert riêng từng domain |
| ACME challenge | DNS-01 (bắt buộc vì wildcard) | HTTP-01 (mặc định) hoặc DNS-01 |
| Tạo bản ghi DNS | Tự động qua Cloudflare API | User tự trỏ (ta chỉ hướng dẫn + verify) |

> Quy ước: zone `deploybox.app` được quản lý hoàn toàn trên Cloudflare bằng tài khoản của ta. Mọi subdomain tự sinh chỉ là việc thêm/sửa bản ghi trong zone này.

---

## 2. Chế độ (a): Subdomain tự sinh + Wildcard

### 2.1. Ý tưởng

Thay vì tạo một bản ghi A cho **từng** app, ta tạo MỘT bản ghi wildcard cho cả zone:

```
*.deploybox.app   A   203.0.113.10   (IP công khai của VPS)
```

Khi đó MỌI subdomain (`a.deploybox.app`, `b.deploybox.app`, `bat-ky.deploybox.app`) đều resolve về IP VPS. Caddy đứng ở cổng 80/443, nhìn header `Host` để biết request thuộc app nào rồi route tới đúng container.

Lợi ích: thêm app mới KHÔNG cần đụng DNS nữa — chỉ cần Caddy biết route. Một app mới deploy là live ngay vì DNS wildcard đã phủ sẵn.

### 2.2. Vì sao subdomain wildcard cần cert WILDCARD và buộc DNS-01

Để `https://bat-ky.deploybox.app` hợp lệ, cert phải khớp tên miền đó. Có 2 cách:

1. Cấp cert riêng cho từng subdomain khi nó được tạo — phiền, chậm, dễ đụng rate limit Let's Encrypt.
2. Cấp MỘT cert wildcard `*.deploybox.app` phủ mọi subdomain — gọn.

Ta chọn cách 2. Nhưng Let's Encrypt **chỉ cấp cert wildcard qua DNS-01 challenge** (xem mục 5 để hiểu vì sao). Do đó Caddy cần quyền ghi DNS vào zone `deploybox.app` → ta cấp token Cloudflare cho Caddy.

### 2.3. Cấu hình Caddy cho wildcard

Caddy mặc định KHÔNG kèm plugin DNS provider; phải build bản Caddy có module `caddy-dns/cloudflare` (qua `xcaddy` hoặc image Docker đã build sẵn).

```caddyfile
# Caddyfile (đoạn cho subdomain tự sinh)
{
    # Token Cloudflare có quyền Edit DNS trên zone deploybox.app
    acme_dns cloudflare {env.CF_API_TOKEN}
}

# Một site block phủ toàn bộ wildcard
*.deploybox.app {
    tls {
        dns cloudflare {env.CF_API_TOKEN}
    }
    # Route động: dựa vào {host} để tìm app tương ứng.
    # Trong thực tế DeployBox sinh các block con / dùng on-demand
    # hoặc cập nhật route qua Caddy Admin API.
    reverse_proxy @app_upstream
}
```

> Thực tế ta KHÔNG sửa Caddyfile thủ công mỗi lần deploy. Backend NestJS gọi **Caddy Admin API** (`http://localhost:2019/config/...`) để thêm/bớt route theo từng app. Caddy tự xin cert wildcard MỘT lần và tái dùng cho mọi subdomain.

---

## 3. Chế độ (b): Custom domain user mang tới

Đây là phần nhiều bước nhất vì zone DNS thuộc về user, ta không có quyền ghi (trừ phi user uỷ quyền Cloudflare token — không bắt buộc).

Luồng tổng quát: **user thêm domain trên dashboard → ta sinh giá trị verify → user trỏ DNS → ta verify → cert tự cấp → live**. Sơ đồ đầy đủ ở mục 8.

### 3.1. Hướng dẫn user trỏ DNS: A record vs CNAME

Đây là điểm hay gây nhầm cho user. Quy tắc:

| Tình huống | Loại bản ghi | Trỏ về | Vì sao |
|---|---|---|---|
| Domain gốc / apex (`khachhang.com`) | **A** | IP VPS (`203.0.113.10`) | Apex KHÔNG thể CNAME theo chuẩn DNS (RFC). Phải dùng A. |
| Subdomain (`app.khachhang.com`) | **CNAME** | `ingress.deploybox.app` | CNAME trỏ tới hostname của ta; nếu sau này ta đổi IP, user không phải sửa gì. |
| Apex nhưng nhà cung cấp DNS hỗ trợ "ALIAS/ANAME/flattening" (vd Cloudflare) | **CNAME phẳng** | `ingress.deploybox.app` | Cloudflare tự "flatten" CNAME ở apex thành A. |

Khuyến nghị mặc định cho user:
- **Dùng subdomain + CNAME** bất cứ khi nào có thể → bền vững khi ta đổi IP.
- Chỉ dùng **A record + IP** khi buộc phải dùng apex và nhà cung cấp DNS không hỗ trợ flattening.

Ta tạo sẵn một hostname ổn định `ingress.deploybox.app` (A record trỏ IP VPS) để làm "đích CNAME" cho user. Khi đổi VPS, ta chỉ sửa 1 record này thay vì báo toàn bộ khách đổi IP.

Mẫu hướng dẫn hiển thị trên dashboard:

```
Để gắn app.khachhang.com vào app của bạn, thêm bản ghi DNS sau:

  Loại:  CNAME
  Name:  app   (hoặc app.khachhang.com)
  Value: ingress.deploybox.app
  TTL:   Auto / 300

Nếu dùng domain gốc khachhang.com (không có subdomain):
  Loại:  A
  Name:  @
  Value: 203.0.113.10
```

### 3.2. Cấp SSL cho custom domain: HTTP-01

Với custom domain thường (không phải wildcard), Caddy dùng **HTTP-01 challenge** mặc định — không cần quyền DNS của user. Điều kiện để HTTP-01 thành công:
1. DNS của domain đã trỏ đúng về IP VPS (A hoặc CNAME → đã resolve về ta).
2. Cổng 80 mở và Caddy đang lắng nghe.

Khi đó việc cấp cert cho custom domain là **on-demand**: ta bật `on_demand_tls` để Caddy xin cert ngay lần đầu có request tới hostname đó.

```caddyfile
{
    on_demand_tls {
        # Caddy hỏi backend NestJS: hostname này có được phép cấp cert không?
        ask http://localhost:3000/internal/caddy/check-domain
    }
}

# Block bắt mọi custom domain đã verify
https:// {
    tls {
        on_demand
    }
    reverse_proxy @route_by_host
}
```

Endpoint `ask` là **chốt chặn bắt buộc**: Caddy gọi nó trước khi xin cert; backend chỉ trả `200 OK` nếu hostname này thực sự là custom domain đã được verify trong DB. Nếu không có chốt này, kẻ xấu trỏ domain bất kỳ về IP ta và ép ta xin hàng loạt cert → dính rate limit Let's Encrypt.

```
GET /internal/caddy/check-domain?domain=app.khachhang.com
→ 200 nếu domain ∈ DB và status = VERIFIED
→ 4xx nếu không → Caddy từ chối cấp cert
```

---

## 4. Xác minh quyền sở hữu custom domain (TXT record)

Trước khi cho phép gắn `app.khachhang.com`, ta phải chắc user thật sự kiểm soát domain đó — nếu không, user A có thể "cướp" domain của user B. Cách chuẩn: yêu cầu user đặt một **TXT record** chứa giá trị bí mật do ta sinh.

### 4.1. Luồng verify

1. User bấm "Thêm domain" → nhập `app.khachhang.com`.
2. Backend sinh token ngẫu nhiên, vd `deploybox-verify=8f3a9c1e7b...`, lưu vào DB (Postgres/Prisma) gắn với user + domain, status = `PENDING`.
3. Dashboard hiển thị bản ghi cần thêm:

```
Loại:  TXT
Name:  _deploybox-challenge.app.khachhang.com
Value: deploybox-verify=8f3a9c1e7b...
```

4. User thêm record bên DNS provider của họ → bấm "Verify".
5. Backend tra DNS (resolve TXT của `_deploybox-challenge.app.khachhang.com`) và so khớp token.
6. Khớp → status = `VERIFIED`. Lúc này endpoint `ask` ở mục 3.2 mới trả `200` cho domain này, và cert mới được phép cấp.

### 4.2. Code minh hoạ (NestJS, dùng resolver DNS của Node)

```ts
import { promises as dns } from 'node:dns';

async function verifyDomainOwnership(domain: string, expectedToken: string) {
  const name = `_deploybox-challenge.${domain}`;
  try {
    const records = await dns.resolveTxt(name); // string[][]
    const flat = records.map((chunks) => chunks.join(''));
    return flat.some((v) => v === `deploybox-verify=${expectedToken}`);
  } catch {
    return false; // NXDOMAIN / chưa propagate
  }
}
```

> Lưu ý propagation: DNS có thể mất vài phút tới vài giờ. Cho user bấm "Verify" lại, đồng thời chạy một job nền (BullMQ — xem [02-tech-stack.md](02-tech-stack.md)) tự thử lại định kỳ trong 24h rồi mới báo fail.

---

## 5. HTTP-01 vs DNS-01 challenge — và vì sao wildcard buộc DNS-01

ACME (giao thức Let's Encrypt dùng) cần bằng chứng ta kiểm soát domain trước khi cấp cert. Hai kiểu phổ biến:

| | HTTP-01 | DNS-01 |
|---|---|---|
| Cách chứng minh | LE yêu cầu phục vụ một file token tại `http://domain/.well-known/acme-challenge/<token>` | LE yêu cầu tạo TXT record `_acme-challenge.domain` chứa giá trị token |
| Cần mở cổng 80? | Có | Không |
| Cần quyền ghi DNS? | Không | CÓ |
| Cấp được WILDCARD `*.x`? | **KHÔNG** | **CÓ** |
| Hợp với DeployBox dùng khi | Custom domain đã trỏ về ta | Subdomain wildcard `*.deploybox.app` |

### Vì sao wildcard BẮT BUỘC DNS-01

Với HTTP-01, LE xác minh bằng cách gọi `http://<một-hostname-cụ-thể>/.well-known/...`. Nhưng wildcard `*.deploybox.app` đại diện cho **vô số** hostname không xác định trước — không có một URL cụ thể nào để LE gõ vào kiểm. Trong khi đó, DNS-01 chứng minh quyền kiểm soát **toàn bộ zone** (qua TXT `_acme-challenge.deploybox.app`) → đủ sức bảo chứng cho mọi subdomain dưới zone đó. Vì vậy LE quy định: **cert wildcard chỉ cấp qua DNS-01**.

Hệ quả thực tế cho DeployBox:
- `*.deploybox.app` → Caddy phải có token Cloudflare để tự ghi TXT `_acme-challenge` (DNS-01). Đây chính là `CF_API_TOKEN` ở mục 2.3.
- Custom domain thường → HTTP-01 là đủ, không cần token DNS của user.

---

## 6. Tự động tạo bản ghi DNS qua Cloudflare API

Chỉ áp dụng cho zone TA sở hữu (`deploybox.app`): tạo `ingress.deploybox.app`, wildcard, hoặc bản ghi cho subdomain đặc biệt. KHÔNG áp dụng cho zone của user (trừ khi user uỷ quyền token).

### 6.1. Chuẩn bị token

Tạo API Token trên Cloudflare với scope tối thiểu:
- Permission: `Zone → DNS → Edit`
- Zone Resources: chỉ zone `deploybox.app`.

Token này dùng cho 2 việc: (1) Caddy làm DNS-01 cho wildcard, (2) backend tạo bản ghi qua API.

### 6.2. Ví dụ API call (pseudo)

Tạo bản ghi `ingress.deploybox.app` trỏ về IP VPS:

```http
POST https://api.cloudflare.com/client/v4/zones/{ZONE_ID}/dns_records
Authorization: Bearer {CF_API_TOKEN}
Content-Type: application/json

{
  "type": "A",
  "name": "ingress.deploybox.app",
  "content": "203.0.113.10",
  "ttl": 300,
  "proxied": false
}
```

> Lưu ý `proxied`: đặt `false` (DNS-only, biểu tượng mây xám) để Caddy tự cấp SSL và thấy IP thật của client. Nếu `true` (proxy cam) thì Cloudflare đứng trước → SSL do Cloudflare lo, không phải Caddy, và phải xử lý "Full (strict)" — phức tạp hơn. MVP dùng `proxied: false`.

Tạo wildcard một lần khi setup hạ tầng:

```http
POST .../dns_records
{
  "type": "A",
  "name": "*.deploybox.app",
  "content": "203.0.113.10",
  "ttl": 300,
  "proxied": false
}
```

### 6.3. Wrapper trong NestJS (minh hoạ)

```ts
async function upsertDnsRecord(input: {
  type: 'A' | 'CNAME' | 'TXT';
  name: string;
  content: string;
}) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...input, ttl: 300, proxied: false }),
    },
  );
  const json = await res.json();
  if (!json.success) throw new Error(JSON.stringify(json.errors));
  return json.result;
}
```

---

## 7. Gia hạn cert tự động

Đây là điểm cộng lớn của Caddy: **gia hạn hoàn toàn tự động, không cần cron của ta**.

- Cert Let's Encrypt có hạn **90 ngày**.
- Caddy tự kiểm tra và gia hạn khi cert còn **~30 ngày** (renew trước hạn 1/3).
- Wilddcard renew qua DNS-01 (vẫn dùng `CF_API_TOKEN`); custom domain renew qua HTTP-01. Caddy nhớ method đã dùng.
- Cert + key được Caddy lưu vào thư mục `/data` của nó. **Bắt buộc** mount thư mục này ra volume bền (Docker volume) để không mất cert khi restart container → tránh xin lại từ đầu và dính rate limit.

```yaml
# docker-compose (đoạn Caddy)
services:
  caddy:
    image: deploybox/caddy-cloudflare:latest   # bản build kèm caddy-dns/cloudflare
    ports: ["80:80", "443:443"]
    environment:
      - CF_API_TOKEN=${CF_API_TOKEN}
    volumes:
      - caddy_data:/data      # <-- cert sống ở đây, PHẢI bền
      - caddy_config:/config
volumes:
  caddy_data:
  caddy_config:
```

Cảnh báo rate limit Let's Encrypt: ~50 cert/tuần cho mỗi domain đăng ký, ~5 cert trùng/tuần. Vì vậy: (1) dùng wildcard cho subdomain để không tốn 1 cert/app; (2) giữ volume `caddy_data` bền; (3) khi dev/test dùng **staging CA** của Let's Encrypt để khỏi đốt quota.

---

## 8. Sơ đồ luồng: user thêm custom domain → live

```
┌──────────────┐
│ 1. User thêm │  app.khachhang.com  (trên Dashboard Next.js)
│    domain    │
└──────┬───────┘
       │ POST /domains  → NestJS sinh verify-token, lưu DB (status=PENDING)
       ▼
┌──────────────────────────────────────────────┐
│ 2. Dashboard hiển thị 2 bản ghi cần thêm:    │
│    • TXT  _deploybox-challenge...  (verify)   │
│    • CNAME app → ingress.deploybox.app        │
└──────┬───────────────────────────────────────┘
       │ user thêm DNS bên provider của họ
       ▼
┌──────────────┐   resolve TXT, so token
│ 3. Verify    │──────────────► khớp? ──No──► retry (BullMQ, tối đa 24h)
│   ownership  │                   │
└──────────────┘                  Yes
       │                           │
       │   status = VERIFIED ◄─────┘
       ▼
┌──────────────────────────────────────────────┐
│ 4. DNS đã trỏ về IP VPS (A/CNAME) → resolve  │
│    về Caddy. Có request đầu tiên tới hostname │
└──────┬───────────────────────────────────────┘
       │ Caddy hỏi endpoint `ask` /internal/caddy/check-domain
       ▼
┌──────────────┐   VERIFIED? ──No──► Caddy từ chối cấp cert
│ 5. on_demand │
│   TLS gate   │   Yes
└──────┬───────┘    │
       ▼            ▼
┌──────────────────────────────────────────────┐
│ 6. Caddy chạy ACME HTTP-01 với Let's Encrypt  │
│    (token tại /.well-known/acme-challenge/..) │
│    → nhận cert, lưu /data (volume bền)        │
└──────┬───────────────────────────────────────┘
       ▼
┌──────────────┐
│ 7. LIVE 🎉   │  https://app.khachhang.com  → reverse_proxy → container app
└──────┬───────┘
       │ sau ~60 ngày
       ▼
┌──────────────┐
│ 8. Caddy tự  │  renew cert (HTTP-01 / DNS-01) — không cần can thiệp
│   gia hạn    │
└──────────────┘
```

Với **subdomain tự sinh** (`ten-app.deploybox.app`), luồng ngắn hơn nhiều — bỏ bước 1–5 vì zone là của ta và wildcard đã phủ sẵn:

```
deploy app → backend gọi Caddy Admin API thêm route cho ten-app.deploybox.app
           → cert wildcard *.deploybox.app đã có sẵn (cấp 1 lần, DNS-01)
           → LIVE ngay
```

---

## 9. Checklist triển khai phần Domain/SSL

Hạ tầng (làm 1 lần):
- [ ] Mua/đăng ký zone `deploybox.app`, đưa nameserver về Cloudflare.
- [ ] Tạo Cloudflare API Token scope `Zone:DNS:Edit` chỉ cho zone `deploybox.app`.
- [ ] Tạo bản ghi `ingress.deploybox.app` (A → IP VPS, proxied=false).
- [ ] Tạo bản ghi wildcard `*.deploybox.app` (A → IP VPS, proxied=false).
- [ ] Build image Caddy kèm `caddy-dns/cloudflare`; mount volume bền cho `/data`.
- [ ] Cấp cert wildcard `*.deploybox.app` qua DNS-01 (Caddy tự làm khi có `CF_API_TOKEN`).

Cho mỗi custom domain (tự động hoá trong app):
- [ ] Sinh verify-token, lưu DB với status `PENDING`.
- [ ] Hiển thị hướng dẫn TXT (verify) + A/CNAME (trỏ traffic) đúng theo bảng mục 3.1.
- [ ] Verify TXT (resolve + so khớp), chuyển `VERIFIED`; có job retry trong 24h.
- [ ] Endpoint `ask` cho Caddy `on_demand_tls` chỉ trả 200 với domain `VERIFIED`.
- [ ] Để Caddy tự cấp + tự gia hạn cert; không tự viết cron renew.

Phòng tránh sự cố:
- [ ] Dev/test trỏ ACME về **staging CA** của Let's Encrypt để khỏi đốt rate limit.
- [ ] Backup volume `caddy_data` (cert + ACME account key).
- [ ] Giám sát hạn cert qua Prometheus/Grafana + Uptime Kuma (xem [10-chi-phi-va-van-hanh.md](10-chi-phi-va-van-hanh.md)).

---

## 10. Liên quan tới SaaS / multi-tenant

Khi lên SaaS (xem [08-phase-3-saas.md](08-phase-3-saas.md)), phần này gần như không phải làm lại — chỉ bồi thêm:
- Quota số custom domain / số cert theo gói.
- Chốt `ask` endpoint phải lọc theo **tenant** (domain thuộc đúng tổ chức trả tiền).
- Rate-limit việc thêm domain để chống lạm dụng xin cert hàng loạt (liên quan rủi ro số 1 ở [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md)).
- Cân nhắc nhiều IP / nhiều node ingress → cập nhật `ingress.deploybox.app` thành nhiều A record hoặc dùng load balancer.

Tóm tắt một câu: **subdomain tự sinh = wildcard + DNS-01 (zone của ta, tức thì); custom domain = TXT verify + A/CNAME + HTTP-01 on-demand (zone của user, có chốt chặn)**. Caddy lo toàn bộ cấp và gia hạn cert tự động.