# Kỹ năng vận hành server production — sneakup.io.vn

> Cẩm nang quản lý server thật, viết theo đúng hệ thống đang chạy (cập nhật 03/07/2026).
> Nguyên tắc số 1: **server production không phải chỗ thử nghiệm** — thử ở máy local, CI xanh rồi mới lên.

## 0. Hệ thống đang có gì (đã setup xong)

| Lớp bảo vệ | Trạng thái | Bật/tắt ở Admin* | Kiểm tra bằng |
|---|---|---|---|
| CI/CD — push là tự test + deploy | ✅ | — (hạ tầng GitHub) | tab Actions trên GitHub |
| Khoá đăng ký (SIGNUP_CODE) | ✅ | `Cho phép đăng ký mới` (tắt = đóng đăng ký hẳn; mã mời vẫn ở .env) | thử đăng ký không mã → 403 |
| Rate-limit auth 10/phút/IP | ✅ | `Rate-limit đăng nhập` | 11 lần login sai → 429 |
| Swap 2GB (chống OOM khi build) | ✅ | — (cấp hệ điều hành) | `free -h` → dòng Swap |
| Backup DB 3h sáng hằng ngày, giữ 7 bản | ✅ | `Backup DB hằng đêm` (script đọc cờ trước khi chạy) | `ls /opt/deploybox-backups/` |
| pm2 tự bật sau reboot | ✅ | — (cấp hệ điều hành) | `systemctl status pm2-root` |
| Watchdog self-heal app user (≤60s) | ✅ | `Watchdog tự cứu app` | giết process app → tự sống lại |
| Thông báo Telegram (deploy/crash/báo cáo) | ✅ | `Thông báo Telegram` | bot @loipham_deploybox_bot |
| Uptime bên ngoài (UptimeRobot) | ⬜ bạn tự gắn — xem mục 4 | — (dịch vụ ngoài) | uptimerobot.com |

> \* **Admin → Tính năng hệ thống** trên web dashboard. Các dòng "—" là hạ tầng ngoài app (CI/CD, swap, pm2, UptimeRobot) — không gate được từ Admin, quản lý theo cách riêng của từng thứ. Các tính năng Nhóm A (preview PR, cron, database 1-click, CLI, hooks) cũng có cờ riêng tại đó.

---

## 1. Thói quen định kỳ (ít mà đủ)

**Hằng ngày (30 giây, qua Telegram):** đọc tin bot gửi — deploy ✅/❌, crash 🔥, báo cáo ngày 📊. Không có tin xấu = không cần làm gì.

**Hằng tuần (2 phút, SSH vào VPS):**
```bash
df -h /                          # đĩa còn bao nhiêu? (>80% là phải dọn)
free -h                          # RAM/swap — swap used tăng cao liên tục = RAM thiếu thật
pm2 status                       # 2 process online?
ls -lh /opt/deploybox-backups/ | tail -3   # backup đêm qua có chạy không?
tail -5 /opt/deploybox-backups/backup.log
```

**Hằng tháng:** `apt update && apt list --upgradable` → cân nhắc vá bảo mật hệ điều hành (`apt upgrade`) vào giờ vắng.

## 2. Backup & khôi phục DB (thứ quý nhất trên server)

**Cơ chế đang chạy:** cron `/etc/cron.d/deploybox-backup` gọi `/usr/local/bin/deploybox-backup.sh` lúc **3h sáng** → `pg_dump` toàn bộ DB Supabase → nén gzip → `/opt/deploybox-backups/db-YYYY-MM-DD-HHMM.sql.gz` → tự xoá bản quá 7 ngày. DB 11MB → mỗi bản ~44KB, không đáng kể.

**Chạy backup tay bất kỳ lúc nào** (vd trước khi làm gì nguy hiểm với DB):
```bash
/usr/local/bin/deploybox-backup.sh
```

**KHÔI PHỤC khi mất dữ liệu** (bình tĩnh, làm theo thứ tự):
```bash
# 1. Dừng API để không ai ghi thêm vào DB
cd /opt/deploybox && make stop

# 2. Chọn bản backup muốn quay về
ls -lh /opt/deploybox-backups/

# 3. Đổ lại vào DB (thay tên file cho đúng)
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' /opt/deploybox/.env | cut -d= -f2-)"
gunzip -c /opt/deploybox-backups/db-2026-07-03-0300.sql.gz | psql "$DATABASE_URL"

# 4. Bật lại + kiểm tra
make up && make health
```
> Lưu ý: khôi phục = quay cả DB về thời điểm backup (mất thay đổi sau đó). Muốn cứu 1 bảng lẻ thì hỏi AI trích riêng phần đó từ file .sql.

## 3. Đĩa & RAM — giữ máy khoẻ

- **Swap 2GB** đã bật (`/swapfile`, swappiness=10): bình thường `used 0B`; chỉ khi build app to mới đụng tới. Nếu thấy swap used **thường trực** vài trăm MB cả lúc rảnh → RAM thật sự thiếu, cân nhắc nâng VPS.
- **Đĩa đầy là chết deploy** (lỗi `input/output error` quen thuộc). Thủ phạm thường gặp + cách dọn:
```bash
du -sh /opt/deploybox/apps/api/.deploybox-data/* 2>/dev/null | sort -rh | head  # build/log app cũ
docker system df && docker system prune -f    # image/container Docker mồ côi
journalctl --vacuum-size=200M                 # log hệ thống phình to
```
- DeployBox có sẵn cleanup tự động sau mỗi deploy (giữ N bản gần nhất) — thường không phải dọn tay.

## 4. UptimeRobot — người canh cửa đứng NGOÀI (bạn tự gắn, 5 phút)

Mọi cảnh báo hiện tại do chính VPS gửi → **VPS sập là câm luôn**. UptimeRobot đứng ngoài ping hộ, 0 tốn tài nguyên máy:

1. Vào **uptimerobot.com** → Sign up free (Gmail của bạn)
2. **+ New Monitor**: Type `HTTP(s)` · URL `https://sneakup.io.vn` · Interval 5 phút · Alert = email
3. Tạo thêm monitor thứ 2: URL `https://api.sneakup.io.vn/api/v1/health` (web sống chưa chắc API sống)
4. (Nên) Integrations → **Telegram** → nối vào để sập là nhắn thẳng Telegram

## 5. Cập nhật code & rollback

- **Đường chính:** sửa code ở máy local → test → `git push` → CI xanh → tự deploy (~5 phút). Chi tiết + gỡ lỗi: [cicd.md](cicd.md).
- **CẤM:** sửa code tay trên VPS (workflow `git reset --hard` sẽ ghi đè). `.env` thì được (không nằm trong git).
- **Đổi `.env` trên VPS:** `nano /opt/deploybox/.env` → `make restart` (nạp lại env, không cần build).
- **Rollback khẩn cấp** khi bản mới hỏng:
```bash
ssh root@14.225.204.227 'cd /opt/deploybox && git reset --hard HEAD~1 && pnpm install && make deploy'
```

## 6. Quy tắc bảo mật (đã áp dụng — đừng phá)

1. **SIGNUP_CODE luôn có giá trị** — xoá là người lạ deploy code lên máy bạn. Xem lại mã: `grep SIGNUP_CODE /opt/deploybox/.env`
2. **Mỗi thứ một mật khẩu riêng** — không dùng lại mật khẩu DB cho bất kỳ chỗ nào khác
3. **Secret chỉ nằm trong `.env`** (đã gitignore) — tuyệt đối không hardcode vào code/commit/docs
4. **`ENCRYPTION_KEY` không được đổi bừa** — đổi là toàn bộ git token/SSH key user đã lưu giải mã fail (muốn xoay key phải re-encrypt, hỏi AI làm script)
5. Không chạy `ufw enable` hay đổi firewall — VPS dùng chung
6. Credential nghi lộ → thu hồi + cấp mới ngay (Telegram: @BotFather `/revoke`; Gmail: apppasswords; DB: Supabase reset password)

## 7. Playbook sự cố — "web sập rồi làm gì?"

Làm **theo thứ tự**, đừng nhảy cóc:

```bash
# B1. Web hay API sập? (từ máy bất kỳ)
curl -s -o /dev/null -w '%{http_code}\n' https://sneakup.io.vn          # web
curl -s -o /dev/null -w '%{http_code}\n' https://api.sneakup.io.vn/api/v1/health  # api

# B2. SSH vào xem tầng nào chết
ssh root@14.225.204.227
pm2 status                       # api/web online? → chết thì: pm2 restart all
systemctl status deploybox-caddy # Caddy sống? → chết thì: systemctl restart deploybox-caddy
df -h / && free -h               # đĩa đầy? RAM cạn?

# B3. Đọc log tìm nguyên nhân
pm2 logs deploybox-api --lines 50 --nostream
journalctl -u deploybox-caddy -n 30

# B4. Vẫn bí? Reboot là bạn (mọi thứ tự bật lại: pm2 resurrect + self-heal + Caddy)
reboot
```

| Triệu chứng | Khả năng cao là | Xử lý nhanh |
|---|---|---|
| Cả web + api chết, SSH không vào được | VPS sập / mất mạng | Chờ/liên hệ nhà cung cấp VPS; UptimeRobot sẽ báo lúc nó sập |
| Web 502, api OK | Next chết | `pm2 restart deploybox-web` |
| API 502/timeout | API crash / DB mất kết nối | `pm2 logs deploybox-api`, kiểm tra Supabase |
| App user `<slug>.` 502 | App đó chết | Watchdog tự cứu trong ≤60s; hoặc Deploy lại project |
| Deploy nào cũng fail `input/output error` | Đĩa đầy | Dọn theo mục 3 |
| HTTPS lỗi cert | Caddy/DNS | `journalctl -u deploybox-caddy`, check `dig +short sneakup.io.vn` |

## 8. Cheatsheet lệnh hay dùng

```bash
# ── từ máy Mac ──
ssh root@14.225.204.227                       # vào VPS (mật khẩu)
make health                                   # (trên VPS) API + web sống?

# ── trên VPS ──
pm2 status | pm2 logs | pm2 monit             # trạng thái / log / dashboard RAM-CPU
make restart                                  # restart + nạp .env mới
make deploy                                   # build + restart (ít dùng — CI/CD lo rồi)
df -h / ; free -h ; swapon --show             # đĩa / RAM / swap
/usr/local/bin/deploybox-backup.sh            # backup DB ngay
ls -lh /opt/deploybox-backups/                # xem các bản backup
grep SIGNUP_CODE /opt/deploybox/.env          # xem lại mã mời
```
