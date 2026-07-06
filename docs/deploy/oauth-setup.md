# Bật "Đăng nhập với GitHub / GitLab / Bitbucket" (OAuth)

> Mỗi nhà cần đăng ký 1 OAuth App (~3 phút/nhà) để lấy Client ID + Secret, bỏ vào `.env`.
> Nhà nào có đủ 2 biến → nút đăng nhập + kết nối + chọn repo của nhà đó tự hiện.
> Tắt nhanh toàn bộ: Admin → Tính năng hệ thống → "Đăng nhập OAuth".

Giá trị dùng chung (production sneakup.io.vn):

| Trường | Giá trị |
|---|---|
| Homepage / Website | `https://sneakup.io.vn` |
| **Callback / Redirect URL** | `https://api.sneakup.io.vn/api/v1/auth/oauth/<nhà>/callback` | 

(`<nhà>` = `github` \| `gitlab` \| `bitbucket`. Dev local thì thay bằng `http://localhost:4000/...`.)

## 1. GitHub (~3 phút)

1. Vào **github.com/settings/developers** → OAuth Apps → **New OAuth App**
2. Application name: `DeployBox` · Homepage: `https://sneakup.io.vn`
3. Authorization callback URL: `https://api.sneakup.io.vn/api/v1/auth/oauth/github/callback`
4. Register → **Generate a new client secret**
5. Vào `.env` trên VPS (`nano /opt/deploybox/.env`):
   ```
   GITHUB_OAUTH_CLIENT_ID=<Client ID>
   GITHUB_OAUTH_CLIENT_SECRET=<Client secret>
   ```

## 2. GitLab (~3 phút)

1. Vào **gitlab.com/-/user_settings/applications** → **Add new application**
2. Name: `DeployBox` · Redirect URI: `https://api.sneakup.io.vn/api/v1/auth/oauth/gitlab/callback`
3. Confidential: ✅ · Scopes: tick **`api`** và **`read_user`**
4. Save → lấy Application ID + Secret:
   ```
   GITLAB_OAUTH_CLIENT_ID=<Application ID>
   GITLAB_OAUTH_CLIENT_SECRET=<Secret>
   ```
   (GitLab **self-host** thì thêm `GITLAB_OAUTH_BASE_URL=https://gitlab.cong-ty.vn`)

## 3. Bitbucket (~4 phút)

1. Vào **bitbucket.org** → Workspace settings → **OAuth consumers** → **Add consumer**
2. Name: `DeployBox` · Callback URL: `https://api.sneakup.io.vn/api/v1/auth/oauth/bitbucket/callback`
3. ⚠️ Bitbucket đặt quyền TRÊN consumer (không phải lúc đăng nhập) — tick đúng các ô:
   - **Account: Read** + **Email**
   - **Repositories: Read**
   - **Webhooks: Read and write**
4. Save → lấy Key + Secret:
   ```
   BITBUCKET_OAUTH_CLIENT_ID=<Key>
   BITBUCKET_OAUTH_CLIENT_SECRET=<Secret>
   ```

## Áp dụng

```bash
ssh root@14.225.204.227
nano /opt/deploybox/.env       # dán các biến ở trên
cd /opt/deploybox && make restart
```

Kiểm tra: `curl -s https://api.sneakup.io.vn/api/v1/auth/oauth/providers` → nhà nào
`"configured":true` là nhà đó sẵn sàng; mở trang đăng nhập sẽ thấy nút tương ứng.

## Cách hoạt động (tóm tắt)

- **Đăng nhập**: đúng danh tính đã liên kết → vào thẳng. Email trùng tài khoản sẵn có
  (đã verified phía provider) → tự gộp về 1 tài khoản. User hoàn toàn mới → **vẫn phải
  nhập mã mời** (SIGNUP_CODE) — OAuth không mở cửa sau cho người lạ.
- **Kết nối** (trang Tài khoản): gắn thêm nhà vào tài khoản hiện tại — để chọn repo từ
  danh sách khi tạo project + tự gắn webhook auto-deploy.
- **Token**: mã hoá at-rest; GitLab/Bitbucket hết hạn ~2h → DeployBox tự làm mới bằng
  refresh token. GitHub OAuth token không hết hạn.
- **Đăng nhập OAuth đi vòng 2FA email** (ủy quyền bảo mật cho provider) — chủ đích.
- Gỡ liên kết: trang Tài khoản (chặn gỡ danh tính cuối nếu chưa đặt mật khẩu).
