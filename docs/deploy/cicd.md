# CI/CD — tự động deploy khi push code

Dự án có **2 tầng auto-deploy**, đừng nhầm nhau:

| Tầng | Cái gì được deploy | Cơ chế | Trạng thái |
|---|---|---|---|
| 1 | **Bản thân DeployBox** lên VPS | GitHub Actions ([.github/workflows/deploy-vps.yml](../../.github/workflows/deploy-vps.yml)) | Cần setup 3 secret (bên dưới) |
| 2 | **App của bạn** deploy LÊN DeployBox | Webhook git có sẵn trong sản phẩm | Có sẵn, chỉ cần gắn webhook |

---

## Tầng 1 — DeployBox tự cập nhật lên VPS (GitHub Actions)

### Cơ chế hoạt động

```
Bạn: git push lên main (repo LoiPham2005/deploybox)
        │
        ▼
Workflow "CI" chạy trước: test + typecheck + build thử (ci.yml)
        │  ĐỎ → DỪNG, không deploy (sửa code, push lại)
        ▼  XANH
Workflow "Deploy VPS" tự chạy tiếp
        │  (dùng 3 secret: VPS_HOST / VPS_USER / VPS_SSH_KEY để SSH vào VPS)
        ▼
Trên VPS /opt/deploybox chạy lần lượt:
  1. git reset --hard origin/main     ← lấy code mới (server không sửa tay nên theo remote tuyệt đối)
  2. pnpm install                     ← cài dependencies
  3. prisma db push + generate        ← đồng bộ schema DB (KHÔNG --accept-data-loss:
     │                                   thay đổi phá dữ liệu → FAIL để xử lý tay, an toàn)
  4. make deploy                      ← build shared → api → web, pm2 restart --update-env
  5. health check                     ← chờ API sống (tối đa 40s) + web sống;
                                        chết → workflow ĐỎ + in 30 dòng log API
```

- **Concurrency lock**: push dồn dập → các deploy xếp hàng, không giẫm nhau.
- **Chạy tay**: tab **Actions** → chọn "Deploy VPS" → **Run workflow** (không cần push).
- `.env` trên VPS **không bị đụng** (không nằm trong git) — đổi env vẫn sửa tay trên VPS rồi `make restart`.

### Thiết lập lần đầu (3 bước, ~3 phút)

**Bước 1 — Tạo cặp SSH key riêng cho Actions** (trên máy Mac):
```bash
ssh-keygen -t ed25519 -f ~/.ssh/deploybox_actions -N "" -C "github-actions-deploybox"
```
Ra 2 file: `deploybox_actions` (🔑 private — bí mật) và `deploybox_actions.pub` (🔓 public — ổ khoá).

**Bước 2 — Cài public key lên VPS** (nhập mật khẩu VPS lần cuối):
```bash
ssh root@14.225.204.227 'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys' < ~/.ssh/deploybox_actions.pub

# Kiểm tra: phải vào được KHÔNG hỏi mật khẩu
ssh -i ~/.ssh/deploybox_actions root@14.225.204.227 'echo OK'
```

**Bước 3 — Tạo 3 secret trên GitHub**: repo → **Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
|---|---|
| `VPS_HOST` | `14.225.204.227` |
| `VPS_USER` | `root` |
| `VPS_SSH_KEY` | **toàn bộ nội dung private key** — copy bằng `pbcopy < ~/.ssh/deploybox_actions` rồi Cmd+V (cả dòng BEGIN/END, nhiều dòng là đúng) |

Xong → push bất kỳ commit nào lên `main` → xem tab **Actions** chạy.

### Gỡ lỗi thường gặp

| Lỗi trong Actions | Nguyên nhân | Sửa |
|---|---|---|
| `Permission denied (publickey)` | Dán nhầm file `.pub` vào secret, thiếu dòng BEGIN/END, hoặc chưa cài pub key lên VPS | Làm lại Bước 2–3 |
| `Host key verification failed` | VPS đổi IP/cài lại | Workflow đã dùng `accept-new`; nếu vẫn lỗi → xoá known_hosts step (hiếm gặp) |
| Fail ở bước `prisma db push` | Schema mới **phá dữ liệu** (xoá cột/bảng) | Cố ý đấy — SSH vào chạy tay `prisma db push --accept-data-loss` nếu chắc chắn, hoặc migrate 2 bước |
| `❌ API không lên sau restart` | Code mới crash lúc boot | Đọc 30 dòng log in kèm; sửa code push lại; app cũ vẫn có thể đang chết → SSH vào `pm2 logs deploybox-api` |
| Actions xanh nhưng web chưa đổi | Trình duyệt cache | Hard reload (Cmd+Shift+R) |

**Deploy hỏng, cần quay lại bản cũ gấp:**
```bash
ssh root@14.225.204.227 'cd /opt/deploybox && git reset --hard HEAD~1 && pnpm install && make deploy'
```
(rồi sửa lỗi trên máy, push lại — Actions sẽ đè bản mới lên)

### ⚠️ Quy tắc khi đã bật CI/CD
- **KHÔNG sửa code tay trực tiếp trên VPS** — `git reset --hard` sẽ ghi đè sạch mỗi lần deploy.
- Muốn tắt tạm auto-deploy: tab Actions → chọn workflow → ⋯ → **Disable workflow**.
- Private key `deploybox_actions` chỉ dùng cho việc này — lộ thì xoá dòng tương ứng trong `~/.ssh/authorized_keys` trên VPS + tạo key mới.

---

## Tầng 2 — App của bạn tự deploy khi push (webhook có sẵn)

Tính năng có sẵn của DeployBox — mỗi project có `autoDeploy` (mặc định bật) + webhook URL riêng.

### Cơ chế

```
Push code app lên GitHub
   → GitHub gọi POST về https://api.sneakup.io.vn/api/v1/webhooks/...
   → DeployBox xác thực chữ ký HMAC (webhookSecret) + so branch
   → đúng branch project đang theo dõi → tự tạo deployment mới (trigger GIT_PUSH)
   → sai branch / sai chữ ký → ghi lịch sử "skipped / rejected"
```

### Thiết lập cho 1 project (1 lần)

1. Dashboard → mở project → phần cài đặt có **Webhook URL** + **Secret** → copy cả 2.
2. GitHub repo của app → **Settings → Webhooks → Add webhook**:
   - Payload URL = URL vừa copy
   - Content type = `application/json`
   - Secret = secret vừa copy
   - Events = **Just the push event**
3. Push thử vào branch project đang theo dõi → dashboard hiện deployment mới trigger `GIT_PUSH`.

> Điều kiện: GitHub phải gọi tới được server — VPS public (`sneakup.io.vn`) là OK. Chạy trên máy nhà không tunnel thì webhook không vào được (dùng nút Deploy tay).
