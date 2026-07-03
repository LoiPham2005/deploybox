# deploybox CLI

Deploy / xem log / list project DeployBox từ terminal. Không phụ thuộc package ngoài (chỉ Node ≥ 18).

## Cài

```bash
# Trong repo:
pnpm --filter @deploybox/cli build
npm link ./packages/cli          # hoặc: node packages/cli/dist/index.js
```

## Dùng

```bash
# 1. Đăng nhập bằng API token (tạo ở dashboard → Settings → Tokens)
deploybox login --url https://api.sneakup.io.vn --token deploybox_xxxxx

deploybox whoami                 # xem đang đăng nhập bằng ai
deploybox list                   # liệt kê project: slug, trạng thái, URL
deploybox deploy <slug>          # deploy + xem build log realtime
deploybox deploy <slug> --no-logs
deploybox logs <deploymentId>    # stream log 1 deployment
```

Config lưu ở `~/.deploybox/config.json`. Dùng chung API token với CI/CD.
