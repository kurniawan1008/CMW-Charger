// Simulator ESP32+gateway untuk trial localhost TANPA hardware.
// Meniru perilaku firmware SPKLU Rev8.2 yang relevan untuk integrasi:
//  - Perintah: $PING $STATUS $GETMODE $AUTH $DEAUTH $SELECT $START $STOP $CLEAR
//  - Validasi $AUTH identik firmware (#ERR auth_format/bad_ch/bad_ltype/bad_limit)
//  - #STATE telemetry per detik; #EVT session_start/stop/complete/fault
//  - Limit check kWh/Rp/detik -> auto STOP + session_complete (auth sekali pakai)
//  - Mode OFFLINE: START via "HMI" disimulasikan dengan env SIM_TRIAL_AFTER_S
//
// Pakai:  node sim.js  (env: SIM_WS_URL, SIM_DEVICE_KEY, SIM_MODE=ONLINE|OFFLINE,
//                       SIM_POWER_W=1200, SIM_SPEEDUP=1, SIM_TRIAL_AFTER_S)
import WebSocket from 'ws';

const WS_URL = process.env.SIM_WS_URL || 'ws://127.0.0.1:3001/api/ws/device';
const DEVICE_KEY = process.env.SIM_DEVICE_KEY || 'CHANGE_ME_DEVICE_KEY';
const PRICE_PER_KWH = 2440; // sama dengan firmware
const POWER_W = Number(process.env.SIM_POWER_W || 1200); // daya simulasi per channel
const SPEEDUP = Number(process.env.SIM_SPEEDUP || 1);    // percepat waktu untuk testing
const TRIAL_AFTER_S = Number(process.env.SIM_TRIAL_AFTER_S || 0);

const ST = { IDLE: 0, SELECT: 1, CHARGING: 2, DONE: 3, FAULT: 4, PAUSED: 5 };
let requireAuth = (process.env.SIM_MODE || 'ONLINE') === 'ONLINE';

const mkCh = () => ({
  state: ST.IDLE, motorIdx: 0, authorized: false, sessionId: '',
  limitType: 0, limitKwh: 0, limitRp: 0, limitSec: 0, limitReached: false,
  kwh: 0, sec: 0, vout: 0, iout: 0,
});
const ch = [mkCh(), mkCh(), mkCh()];

let ws;
const send = (line) => ws?.readyState === WebSocket.OPEN &&
  ws.send(JSON.stringify({ type: 'line', line }));

const kwhOf = (c) => Number(c.kwh.toFixed(3));
const rpOf = (c) => Math.round(c.kwh * PRICE_PER_KWH);

function emitSession(c, i, ev) {
  send(`#EVT {"ev":"${ev}","ch":${i + 1},"sid":"${c.sessionId}","kwh":${kwhOf(c)},` +
    `"rp":${rpOf(c)},"sec":${c.sec},"st":${c.state}}`);
}

function chJson(c, i) {
  return `{"ch":${i + 1},"en":1,"st":${c.state},"on":${c.state === ST.CHARGING ? 1 : 0},` +
    `"pr":0,"m":${c.motorIdx},"v":${c.vout.toFixed(2)},"i":${c.iout.toFixed(2)},` +
    `"p":${(c.vout * c.iout).toFixed(1)},"vset":58.80,"iset":10.00,` +
    `"kwh":${kwhOf(c)},"rp":${rpOf(c)},"sec":${c.sec},"tin":31.5,` +
    `"auth":${c.authorized ? 1 : 0},"sid":"${c.sessionId}","lt":${c.limitType}}`;
}

const emitState = () =>
  send(`#STATE {"t":${Date.now() % 2 ** 31},"ch":[${ch.map(chJson).join(',')}]}`);

function stopOutput(c, ev) {
  c.state = ST.DONE;
  c.vout = 0; c.iout = 0;
  c.authorized = false; c.limitType = 0; // auth sekali pakai (perilaku firmware)
}

function startCharging(c) {
  c.state = ST.CHARGING;
  c.kwh = 0; c.sec = 0; c.limitReached = false;
  c.vout = 58.8; c.iout = POWER_W / 58.8;
}

// Detak per detik: integrasi energi + cek limit (persis logika firmware:
// limit 0 tidak pernah dianggap tercapai).
setInterval(() => {
  for (let i = 0; i < 3; i++) {
    const c = ch[i];
    if (c.state !== ST.CHARGING) continue;
    c.sec += 1 * SPEEDUP;
    c.kwh += (POWER_W * SPEEDUP) / 3600 / 1000;

    if (c.limitType !== 0 && !c.limitReached) {
      const reached =
        (c.limitType === 1 && c.limitKwh > 0 && c.kwh >= c.limitKwh) ||
        (c.limitType === 2 && c.limitRp > 0 && rpOf(c) >= c.limitRp) ||
        (c.limitType === 3 && c.limitSec > 0 && c.sec >= c.limitSec);
      if (reached) {
        c.limitReached = true;
        stopOutput(c);
        emitSession(c, i, 'session_complete');
        continue;
      }
    }
  }
  emitState();
}, 1000);

// Simulasi trial mode OFFLINE: "user menekan START di HMI" setelah N detik.
if (TRIAL_AFTER_S > 0) {
  setTimeout(() => {
    if (!requireAuth && ch[0].state === ST.IDLE) {
      ch[0].sessionId = '';
      startCharging(ch[0]);
      emitSession(ch[0], 0, 'session_start');
      // trial berhenti sendiri setelah 15 detik simulasi
      setTimeout(() => {
        if (ch[0].state === ST.CHARGING) {
          stopOutput(ch[0]);
          emitSession(ch[0], 0, 'session_stop');
        }
      }, 15000);
    }
  }, TRIAL_AFTER_S * 1000);
}

const parseCh = (s) => { const n = Number(s); return n >= 1 && n <= 3 ? n - 1 : -1; };

function handleCmd(line) {
  if (line === '$PING') return send('#PONG');
  if (line === '$STATUS') return emitState();
  if (line === '$GETMODE') return send(`#MODE ${requireAuth ? 'ONLINE' : 'OFFLINE'}`);

  if (line.startsWith('$AUTH,')) {
    const parts = line.slice(6).split(',');
    if (parts.length !== 4) return send('#ERR auth_format');
    const [chS, sid, ltypeS, lvalS] = parts;
    const c = parseCh(chS);
    if (c < 0) return send('#ERR bad_ch');
    const ltype = Number(ltypeS), lval = Number(lvalS);
    if (!(ltype >= 0 && ltype <= 3)) return send('#ERR bad_ltype');
    if (ltype >= 1 && !(lval > 0)) return send('#ERR bad_limit');
    ch[c].sessionId = sid.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 23);
    ch[c].limitType = ltype;
    ch[c].limitKwh = ltype === 1 ? lval : 0;
    ch[c].limitRp = ltype === 2 ? lval : 0;
    ch[c].limitSec = ltype === 3 ? lval : 0;
    ch[c].authorized = true;
    ch[c].limitReached = false;
    return send(`#OK auth ch${c + 1} sid=${ch[c].sessionId} lt=${ltype}`);
  }
  if (line.startsWith('$DEAUTH,')) {
    const c = parseCh(line.slice(8));
    if (c < 0) return send('#ERR bad_ch');
    Object.assign(ch[c], { authorized: false, sessionId: '', limitType: 0, limitReached: false });
    return send('#OK deauth');
  }
  if (line.startsWith('$SELECT,')) {
    const [chS, mS] = line.slice(8).split(',');
    const c = parseCh(chS), m = Number(mS);
    if (c < 0 || !(m >= 0 && m <= 9)) return send('#ERR sel_arg');
    ch[c].motorIdx = m;
    return send('#OK select');
  }
  if (line.startsWith('$START,')) {
    const c = parseCh(line.slice(7));
    if (c < 0) return send('#ERR bad_ch');
    if (requireAuth && !ch[c].authorized) return send('#ERR not_authorized');
    if (ch[c].state === ST.CHARGING) return send('#ERR start_failed');
    startCharging(ch[c]);
    emitSession(ch[c], c, 'session_start');
    return send('#OK start');
  }
  if (line.startsWith('$STOP,')) {
    const c = parseCh(line.slice(6));
    if (c < 0) return send('#ERR bad_ch');
    if (ch[c].state === ST.CHARGING) {
      stopOutput(ch[c]);
      emitSession(ch[c], c, 'session_stop');
    }
    return send('#OK stop');
  }
  if (line.startsWith('$CLEAR,')) {
    const c = parseCh(line.slice(7));
    if (c < 0) return send('#ERR bad_ch');
    ch[c] = mkCh();
    return send('#OK clear');
  }
  send('#ERR unknown_cmd');
}

function connect() {
  ws = new WebSocket(WS_URL);
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'hello', deviceKey: DEVICE_KEY, fw: 'sim/rev8.2' }));
    console.log(`[sim] terhubung ke ${WS_URL} (mode ${requireAuth ? 'ONLINE' : 'OFFLINE'})`);
  });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'cmd' && typeof msg.line === 'string') handleCmd(msg.line.trim());
  });
  ws.on('close', () => {
    console.log('[sim] koneksi putus, reconnect 3s...');
    setTimeout(connect, 3000);
  });
  ws.on('error', () => {});
}
connect();
