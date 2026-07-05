// Uji reconciler (audit C3): sesi berjalan -> simulator "mati listrik" ->
// reconciler harus menutup sesi & merefund sisa saldo tanpa event final.
// Jalankan: node tools/test-reconciler.mjs  (backend & sim harus jalan; skrip
// ini MEMATIKAN sim via sinyal tidak bisa — sim di-restart manual oleh runner.)
// Mode pakai: skrip hanya memantau DB sampai sesi ditutup reconciler.
import { execSync } from 'node:child_process';

const MYSQL = process.env.MYSQL_BIN || 'C:/xampp/mysql/bin/mysql.exe';
const sql = (q) =>
  execSync(`"${MYSQL}" -u root spklu_db -N -e "${q.replace(/"/g, '\\"')}"`).toString().trim();

const sid = process.argv[2];
if (!sid) { console.error('pakai: node tools/test-reconciler.mjs <sessionId>'); process.exit(1); }

const t0 = Date.now();
const timer = setInterval(() => {
  const row = sql(`SELECT status, end_reason, consumed_kwh, total_cost FROM sessions WHERE id='${sid}'`);
  const [status, endReason, kwh, cost] = row.split('\t');
  const elapsed = Math.round((Date.now() - t0) / 1000);
  if (status !== 'ACTIVE') {
    clearInterval(timer);
    const refund = sql(`SELECT COALESCE(SUM(amount),0) FROM transaction_logs WHERE session_id='${sid}' AND type='REFUND'`);
    console.log(`RECONCILED setelah ${elapsed}s: status=${status} reason=${endReason} kwh=${kwh} cost=${cost} refund=${refund}`);
    process.exit(0);
  }
  console.log(`${elapsed}s: masih ACTIVE (kwh=${kwh})`);
  if (elapsed > 360) { console.error('GAGAL: reconciler tidak menutup sesi dalam 6 menit'); process.exit(1); }
}, 15000);
