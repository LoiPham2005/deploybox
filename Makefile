# DeployBox — Makefile gom lệnh pm2 + build hay dùng.
# Gõ `make` (hoặc `make help`) để xem danh sách lệnh.
#
# Lưu ý: KHÔNG chạy `pnpm dev` khi pm2 đang chạy (trùng cổng 3000/4000
# → EADDRINUSE). Muốn dev: `make stop` trước, code xong `make up`.

.PHONY: help up stop restart restart-api restart-web status logs logs-api logs-web monit \
        build build-shared build-api build-web deploy deploy-api deploy-web \
        save boot health dev

help: ## Hiện danh sách lệnh
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# ─── Chạy / dừng ──────────────────────────────────────────────────────────────

up: ## Bật DeployBox (pm2 start ecosystem.config.js)
	pm2 start ecosystem.config.js

stop: ## Dừng cả API + web (để chạy pnpm dev chẳng hạn)
	pm2 stop deploybox-api deploybox-web

restart: ## Restart cả 2 + nạp lại .env (dùng sau khi đổi .env)
	pm2 restart deploybox-api deploybox-web --update-env

restart-api: ## Restart riêng API + nạp lại .env
	pm2 restart deploybox-api --update-env

restart-web: ## Restart riêng web + nạp lại .env
	pm2 restart deploybox-web --update-env

# ─── Theo dõi ────────────────────────────────────────────────────────────────

status: ## Trạng thái các process
	pm2 status

logs: ## Xem log cả 2 (Ctrl+C để thoát)
	pm2 logs

logs-api: ## Xem log API
	pm2 logs deploybox-api

logs-web: ## Xem log web
	pm2 logs deploybox-web

monit: ## Dashboard CPU/RAM realtime của pm2
	pm2 monit

health: ## Kiểm tra nhanh API + web có sống không
	@curl -s -o /dev/null -w "API  (4000): HTTP %{http_code}\n" http://localhost:4000/api/v1/health || true
	@curl -s -o /dev/null -w "Web  (3000): HTTP %{http_code}\n" http://localhost:3000/login || true

# ─── Build ───────────────────────────────────────────────────────────────────

build-shared: ## Build packages/shared (làm trước khi build api/web)
	pnpm --filter @deploybox/shared build

build-api: build-shared ## Build API (NestJS)
	pnpm --filter @deploybox/api build

build-web: build-shared ## Build web (Next.js)
	pnpm --filter @deploybox/web build

build: build-api build-web ## Build tất cả (shared → api → web)

# ─── Cập nhật code lên production (build + restart) ─────────────────────────

deploy: build restart ## Build tất cả rồi restart pm2 — dùng sau khi sửa code

deploy-api: build-api restart-api ## Chỉ build + restart API

deploy-web: build-web restart-web ## Chỉ build + restart web

# ─── Bền vững qua reboot ─────────────────────────────────────────────────────

save: ## Lưu danh sách process hiện tại (pm2 tự bật lại đúng list này khi boot)
	pm2 save

boot: ## In lệnh cấu hình pm2 tự chạy khi khởi động máy (chạy lệnh nó in ra)
	pm2 startup

# ─── Dev ─────────────────────────────────────────────────────────────────────

dev: ## Dừng pm2 rồi chạy dev hot-reload (Ctrl+C xong nhớ `make up`)
	pm2 stop deploybox-api deploybox-web || true
	pnpm dev
