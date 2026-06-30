// PM2 config DÙNG TRONG CONTAINER (pm2-runtime). Khác bản ngoài host: ROOT = /app.
const ROOT = '/app';

module.exports = {
  apps: [
    {
      name: 'deploybox-api',
      cwd: `${ROOT}/apps/api`,
      script: 'dist/main.js',
      interpreter: 'node',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 15,
      min_uptime: '10s',
      time: true,
    },
    {
      name: 'deploybox-web',
      cwd: `${ROOT}/apps/web`,
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      interpreter: 'node',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 15,
      min_uptime: '10s',
      time: true,
    },
  ],
};
