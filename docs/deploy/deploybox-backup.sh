#!/bin/bash
# Backup DB DeployBox hằng đêm — bản gốc nằm ở /usr/local/bin/deploybox-backup.sh trên VPS
# (file này là BẢN LƯU trong repo để tham chiếu/khôi phục — sửa xong nhớ scp lên VPS).
# Gồm 2 phần:
#   1. DB nền tảng (Supabase) — pg_dump toàn bộ.
#   2. DB user tạo bằng "Database 1-click" (container deploybox-db-*) — pg_dump/RDB từng cái.
# Bật/tắt ở Admin → Tính năng hệ thống (flag db_backup). Giữ 7 bản gần nhất.
set -euo pipefail
BACKUP_DIR=/opt/deploybox-backups
DATABASE_URL="$(grep -m1 "^DATABASE_URL=" /opt/deploybox/.env | cut -d= -f2-)"

# Đọc cờ từ DB — thiếu cờ / lỗi truy vấn = coi như BẬT (thà backup thừa còn hơn mất backup)
ENABLED="$(psql "$DATABASE_URL" -tAc "select enabled from \"FeatureFlag\" where key='db_backup'" 2>/dev/null || echo t)"
if [ "$ENABLED" = "f" ]; then
  echo "$(date "+%F %T") SKIP — flag db_backup đang tắt (Admin → Tính năng hệ thống)"
  exit 0
fi
mkdir -p "$BACKUP_DIR"

# ── 1. DB nền tảng ──
FILE="$BACKUP_DIR/db-$(date +%F-%H%M).sql.gz"
pg_dump "$DATABASE_URL" | gzip > "$FILE"
gunzip -t "$FILE"
[ "$(stat -c%s "$FILE")" -gt 1000 ] || { echo "backup quá nhỏ, nghi hỏng"; exit 1; }
echo "$(date "+%F %T") OK $(basename "$FILE") $(du -h "$FILE" | cut -f1)"

# ── 2. DB user (Database 1-click) — lỗi 1 db không được làm hỏng cả script ──
if command -v docker >/dev/null 2>&1; then
  psql "$DATABASE_URL" -tAc 'select "containerName", engine from "ManagedDatabase"' 2>/dev/null |
  while IFS='|' read -r CN ENGINE; do
    CN="$(echo "$CN" | tr -d ' ')"; ENGINE="$(echo "$ENGINE" | tr -d ' ')"
    [ -z "$CN" ] && continue
    if ! docker ps --format '{{.Names}}' | grep -qx "$CN"; then
      echo "$(date "+%F %T") WARN $CN không chạy — bỏ qua"
      continue
    fi
    if [ "$ENGINE" = "POSTGRES" ]; then
      UF="$BACKUP_DIR/user-$CN-$(date +%F).sql.gz"
      # Trong container: kết nối local qua unix socket = trust, không cần mật khẩu
      if docker exec "$CN" pg_dump -U app app 2>/dev/null | gzip > "$UF" \
         && [ "$(stat -c%s "$UF")" -gt 200 ]; then
        echo "$(date "+%F %T") OK $(basename "$UF") $(du -h "$UF" | cut -f1)"
      else
        rm -f "$UF"; echo "$(date "+%F %T") WARN backup $CN (postgres) thất bại"
      fi
    elif [ "$ENGINE" = "REDIS" ]; then
      # Mật khẩu nằm trong Cmd của container: redis-server --requirepass <pw>
      PW="$(docker inspect -f '{{index .Config.Cmd 2}}' "$CN" 2>/dev/null || true)"
      docker exec "$CN" redis-cli --no-auth-warning -a "$PW" SAVE >/dev/null 2>&1 || true
      UF="$BACKUP_DIR/user-$CN-$(date +%F).rdb.gz"
      TMP="$(mktemp)"
      if docker cp "$CN":/data/dump.rdb "$TMP" 2>/dev/null && gzip -c "$TMP" > "$UF"; then
        echo "$(date "+%F %T") OK $(basename "$UF") $(du -h "$UF" | cut -f1)"
      else
        rm -f "$UF"; echo "$(date "+%F %T") WARN backup $CN (redis) thất bại"
      fi
      rm -f "$TMP"
    fi
  done
fi

# ── Dọn bản cũ hơn 7 ngày (cả nền tảng lẫn user) ──
find "$BACKUP_DIR" -name "db-*.sql.gz" -mtime +7 -delete
find "$BACKUP_DIR" \( -name "user-*.sql.gz" -o -name "user-*.rdb.gz" \) -mtime +7 -delete
