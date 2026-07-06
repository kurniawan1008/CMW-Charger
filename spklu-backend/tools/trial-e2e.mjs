// Trial end-to-end Tahap 1 (localhost): register -> topup -> approve ->
// wizard start sesi -> live tick WS -> session_complete -> cek refund & saldo.
// Prasyarat: backend jalan di :3001, simulator mesin terhubung (mode ONLINE),
// MySQL berisi schema + delta. Jalankan dari folder spklu-backend:
//   node tools/trial-e2e.mjs
import { execSync } from 'node:child_process';
import WebSocket from 'ws';

const API = (process.env.API_URL || 'http://127.0.0.1:3001') + '/api';
const WSC = API.replace('http', 'ws') + '/ws/client';
const MYSQL = process.env.MYSQL_BIN || 'C:/xampp/mysql/bin/mysql.exe';
const sql = (q) =>
  execSync(`"${MYSQL}" -u root spklu_db -N -e "${q.replace(/"/g, '\\"')}"`).toString().trim();

let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '  ✔' : '  ✘ GAGAL:'} ${label}`);
  if (!cond) failures++;
};

async function api(method, path, body, token) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const stamp = Date.now().toString(36);

console.log('== 1. Registrasi user & admin ==');
const reg = await api('POST', '/auth/register', {
  name: 'Budi Trial', email: `budi_${stamp}@test.id`, phone: `08${stamp}`, password: 'rahasia123',
});
ok(reg.status === 201, `register user (${reg.status})`);
let userToken = reg.json.token;
const userId = reg.json.user.id;

const regAdm = await api('POST', '/auth/register', {
  name: 'Admin Trial', email: `admin_${stamp}@test.id`, password: 'rahasia123',
});
sql(`UPDATE users SET role='SUPERADMIN' WHERE id=${regAdm.json.user.id}`);
const admLogin = await api('POST', '/auth/login', {
  identifier: `admin_${stamp}@test.id`, password: 'rahasia123',
});
const admToken = admLogin.json.token;
ok(admLogin.json.user.role === 'SUPERADMIN', 'admin dipromosikan & login ulang');

console.log('== 2. Top-up: request -> approve -> saldo ==');
const tu = await api('POST', '/user/topups', { amount: 50000 }, userToken);
ok(tu.status === 201, `request top-up (${tu.status})`);
const app1 = await api('POST', `/admin/topups/${tu.json.id}/approve`, {}, admToken);
ok(app1.status === 200, 'admin approve');
const me1 = await api('GET', '/user/me', null, userToken);
ok(Number(me1.json.balance) === 50000, `saldo = 50000 (aktual ${me1.json.balance})`);
const rej = await api('POST', `/admin/topups/${tu.json.id}/reject`, { reason: 'x' }, admToken);
ok(rej.status === 409, 'keputusan ganda ditolak (409)');

console.log('== 3. Wizard: lokasi -> charger flat -> motor ==');
const locs = await api('GET', '/locations', null, userToken);
ok(locs.json.length >= 1, `daftar lokasi (${locs.json.length})`);
const chargers = await api('GET', '/locations/1/chargers', null, userToken);
console.log('    chargers:', JSON.stringify(chargers.json));
const avail = chargers.json.find((c) => c.available);
ok(Boolean(avail), 'ada charger available (simulator online, mode ONLINE)');
ok(chargers.json.every((c, i) => c.label === `Charger ${i + 1}`), 'label flat Charger N lintas mesin');
const motors = await api('GET', '/motors', null, userToken);
ok(motors.json.length >= 1 && motors.json[0].vset_v === undefined,
  'katalog motor tanpa parameter teknis');

console.log('== 4. Validasi penolakan ==');
const tooBig = await api('POST', '/sessions/start',
  { channelId: avail.id, motorProfileId: motors.json[0].id, mode: 'idr', target: 999999 }, userToken);
ok(tooBig.status === 402, `saldo kurang ditolak 402 (${tooBig.status}: ${tooBig.json.error})`);
const badMode = await api('POST', '/sessions/start',
  { channelId: avail.id, motorProfileId: motors.json[0].id, mode: 'menit', target: 5 }, userToken);
ok(badMode.status >= 400, `mode invalid ditolak (${badMode.status})`);

console.log('== 5. Sesi berbayar mode Rupiah (target Rp 2.000) ==');
const start = await api('POST', '/sessions/start',
  { channelId: avail.id, motorProfileId: motors.json[0].id, mode: 'idr', target: 2000 }, userToken);
ok(start.status === 201, `start sesi (${start.status}: ${JSON.stringify(start.json)})`);
const sid = start.json.sessionId;
ok(typeof sid === 'string' && sid.length <= 23 && /^[A-Za-z0-9_-]+$/.test(sid),
  `sessionId aman utk firmware: ${sid} (${sid?.length} char)`);
const meAfterStart = await api('GET', '/user/me', null, userToken);
ok(Number(meAfterStart.json.balance) === 48000,
  `saldo direservasi: 48000 (aktual ${meAfterStart.json.balance})`);

const dup = await api('POST', '/sessions/start',
  { channelId: avail.id, motorProfileId: motors.json[0].id, mode: 'idr', target: 2000 }, userToken);
ok(dup.status === 409, `channel sibuk ditolak 409 (${dup.status})`);

console.log('== 6. Live telemetry via /ws/client ==');
const ticks = [];
const finalEvt = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout menunggu session_complete')), 60000);
  const wsc = new WebSocket(`${WSC}?token=${userToken}`);
  wsc.on('open', () => wsc.send(JSON.stringify({ type: 'subscribe', topic: `session.${sid}` })));
  wsc.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.type !== 'event' || msg.topic !== `session.${sid}`) return;
    if (msg.data.final) { clearTimeout(t); wsc.close(); resolve(msg.data); }
    else if (msg.data.energy !== undefined) ticks.push(msg.data);
  });
  wsc.on('error', reject);
});
ok(ticks.length >= 2, `terima ${ticks.length} tick telemetry`);
const lastTick = ticks.at(-1);
console.log('    tick terakhir:', JSON.stringify(lastTick));
ok(lastTick.voltage > 0 && lastTick.power > 0 && lastTick.cost > 0, 'tick berisi V/P/biaya');
console.log('    final:', JSON.stringify(finalEvt));
ok(finalEvt.status === 'COMPLETED' && finalEvt.endReason === 'target_reached',
  'sesi selesai karena target tercapai (limit firmware)');
ok(finalEvt.cost <= 2000, `biaya (${finalEvt.cost}) <= reservasi 2000`);

console.log('== 7. Rekonsiliasi saldo & log ==');
await new Promise((r) => setTimeout(r, 1500)); // beri waktu commit finalisasi
const me2 = await api('GET', '/user/me', null, userToken);
const expected = 50000 - finalEvt.cost;
ok(Number(me2.json.balance) === expected,
  `saldo akhir = 50000 - ${finalEvt.cost} = ${expected} (aktual ${me2.json.balance})`);
const sess = await api('GET', `/sessions/${sid}`, null, userToken);
ok(sess.json.status === 'COMPLETED' && Number(sess.json.total_cost) === finalEvt.cost,
  `record sesi final (status=${sess.json.status}, cost=${sess.json.total_cost})`);
const admTx = await api('GET', `/admin/transactions?billing=payment`, null, admToken);
ok(admTx.json.data.some((s) => s.id === sid), 'sesi tampil di log admin');
const refundLogs = sql(`SELECT COUNT(*) FROM transaction_logs WHERE session_id='${sid}' AND type='REFUND'`);
ok(Number(refundLogs) === (finalEvt.refund > 0 ? 1 : 0), `log REFUND sesuai (refund=${finalEvt.refund})`);

console.log(failures ? `\n✘ ${failures} pemeriksaan GAGAL` : '\n✔ SEMUA PEMERIKSAAN LOLOS');
process.exit(failures ? 1 : 0);
