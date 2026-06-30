#!/usr/bin/env bash
# Chạy DeployBox ở chế độ production bằng pm2 — 1 lệnh làm hết.
# Dùng:  ./start-server.sh           (build + (re)start)
#        ./start-server.sh --no-build (bỏ qua build, chỉ restart nhanh)
set -euo pipefail
cd "$(dirname "$0")"

BUILD=1
[ "${1:-}" = "--no-build" ] && BUILD=0

# 1. Đảm bảo có pm2
if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> Cài pm2 (global)..."
  npm install -g pm2
fi

# 2. Build production (shared + api + web)
if [ "$BUILD" = "1" ]; then
  echo "==> Cài deps + build production..."
  pnpm install --frozen-lockfile
  pnpm build
else
  echo "==> Bỏ qua build (--no-build)."
fi

# 3. (Re)start bằng pm2 — startOrReload: chưa có thì start, có rồi thì reload
echo "==> Khởi động DeployBox (pm2)..."
pm2 startOrReload ecosystem.config.js
pm2 save   # lưu để auto-start khi boot

echo ""
echo "==> Xong. Trạng thái:"
pm2 list
echo ""
echo "Dashboard:  http://localhost:3000"
echo "Logs:       pm2 logs        |  Dừng: pm2 stop all"
