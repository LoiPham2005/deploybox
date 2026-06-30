#!/usr/bin/env bash
# Tắt HẾT DeployBox: app đã deploy + Caddy + API/Web (pm2). Bật lại: ./start-server.sh
set -uo pipefail
cd "$(dirname "$0")"

echo "==> Dừng các app đã deploy (host-run)..."
for f in apps/api/.deploybox-data/run/*.pid; do
  [ -f "$f" ] || continue
  pid=$(cat "$f" 2>/dev/null || true)
  [ -n "${pid:-}" ] || continue
  kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  rm -f "$f"
done

echo "==> Dừng Caddy..."
pkill -f "caddy run" 2>/dev/null || true

echo "==> Dừng DeployBox (pm2 api + web)..."
pm2 delete all 2>/dev/null || true
pm2 save --force 2>/dev/null || true   # lưu danh sách rỗng → auto-start KHÔNG bật lại
# dọn process API mồ côi (nếu có)
pkill -f "apps/api/dist/main" 2>/dev/null || true

echo ""
echo "==> Đã tắt server. Bật lại bằng: ./start-server.sh"
