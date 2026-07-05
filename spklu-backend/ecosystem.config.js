// PM2 (deploy VPS): pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'spklu-backend',
      script: 'src/server.js',
      instances: 1, // WS device hub menyimpan state koneksi — jangan cluster
      autorestart: true,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
