// PM2 — chạy DeployBox ở chế độ production, tự restart khi crash, tự lên khi boot.
// Dùng: pm2 start ecosystem.config.js  → pm2 save  → cấu hình auto-start (LaunchAgent).
const ROOT = '/Users/loipd/personal/deploybox';

module.exports = {
  apps: [
    {
      name: 'deploybox-api',
      cwd: `${ROOT}/apps/api`,
      script: 'dist/main.js', // tự đọc ../../.env (envFilePath trong ConfigModule)
      interpreter: 'node',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 15,
      min_uptime: '10s', // sống >10s mới tính là start thành công
      time: true, // log có timestamp
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
