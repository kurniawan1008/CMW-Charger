// PM2 config produksi.
// Pakai:
//   pm2 start ecosystem.config.js --env production
//   pm2 save                 # persist supaya boot restart otomatis
//   pm2 startup              # ikuti instruksi output-nya (sekali)
//
// Cek log:  pm2 logs spklu-backend
// Monit :   pm2 monit
// Restart:  pm2 restart spklu-backend

module.exports = {
  apps: [
    {
      name: 'spklu-backend',
      script: 'src/server.js',

      // WS device hub menyimpan state koneksi di memori satu proses.
      // Cluster mode akan pecah state -> jangan diaktifkan.
      instances: 1,
      exec_mode: 'fork',

      autorestart: true,
      max_memory_restart: '300M',

      // Backend menangani SIGTERM dengan graceful shutdown (server.close + pool.end).
      // Beri jendela 8 detik sebelum PM2 SIGKILL.
      kill_timeout: 8000,
      wait_ready: false,

      // Log
      out_file: './logs/out.log',
      error_file: './logs/err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,

      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
