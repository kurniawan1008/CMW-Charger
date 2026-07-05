import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 3001),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'spklu_db',
  },
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret',
  jwtExpires: process.env.JWT_EXPIRES || '7d',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  // Konstanta hardware fleet (lihat spec): 3 channel & 7 kW per mesin
  maxChannelsPerMachine: 3,
  machinePowerKw: 7,
};
