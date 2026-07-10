// Builder perintah serial firmware (kontrak SPKLU_Esp32_Rev8.2.ino).
// Semua fungsi melempar Error bila argumen di luar batas yang firmware terima,
// supaya perintah invalid tidak pernah sampai ke mesin.
import { isFirmwareSafeSessionId } from './sessionId.js';

export const LIMIT_TYPE = { NONE: 0, KWH: 1, RUPIAH: 2, SECONDS: 3 };

function assertChannel(ch) {
  if (!Number.isInteger(ch) || ch < 1 || ch > 3) {
    throw new Error(`channel harus 1..3, dapat: ${ch}`);
  }
}

function assertSlot(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot > 9) {
    throw new Error(`slot harus 0..9, dapat: ${slot}`);
  }
}

// Batas identik dengan constrain() di firmware (ADJ, — halaman Settings
// lokal), supaya remote-write tidak bisa menulis nilai yang tak akan
// pernah lolos lewat jalur fisik.
const PARAM_RANGE = {
  vset: [1, 125], iset: [0, 50], ocp: [0.1, 52], otp: [60, 120], lvp: [10, 145],
};

function assertParamRange(name, value) {
  const [min, max] = PARAM_RANGE[name];
  if (!(Number(value) >= min && Number(value) <= max)) {
    throw new Error(`${name} harus ${min}..${max}, dapat: ${value}`);
  }
}

export function buildSelect(ch, fwSlot, name) {
  assertChannel(ch);
  if (!Number.isInteger(fwSlot) || fwSlot < 0 || fwSlot > 9) {
    throw new Error(`fw_slot harus 0..9, dapat: ${fwSlot}`);
  }
  if (!name) return `$SELECT,${ch},${fwSlot}`;
  // Sanitasi: koma memecah parsing CSV firmware, kutip & backslash bisa
  // merusak string Nextion (backslash adalah escape character di sana);
  // truncate supaya muat di lebar tombol b_mX pada layar HMI.
  const safe = String(name).replace(/[,"\\]/g, '').slice(0, 24).trim();
  return safe ? `$SELECT,${ch},${fwSlot},${safe}` : `$SELECT,${ch},${fwSlot}`;
}

export function buildAuth(ch, sessionId, limitType, limitValue) {
  assertChannel(ch);
  if (!isFirmwareSafeSessionId(sessionId)) {
    throw new Error(`sessionId tidak aman untuk firmware: ${sessionId}`);
  }
  if (![1, 2, 3].includes(limitType)) {
    throw new Error(`limitType harus 1..3 untuk sesi berbayar, dapat: ${limitType}`);
  }
  // Firmware menolak lval<=0 (#ERR bad_limit) — tangkap lebih awal di sini.
  if (!(Number(limitValue) > 0)) {
    throw new Error(`limitValue harus > 0, dapat: ${limitValue}`);
  }
  // kWh boleh pecahan; Rupiah & detik integer.
  const lval =
    limitType === LIMIT_TYPE.KWH ? Number(limitValue).toFixed(3) : String(Math.round(limitValue));
  return `$AUTH,${ch},${sessionId},${limitType},${lval}`;
}

export const buildStart = (ch) => (assertChannel(ch), `$START,${ch}`);
export const buildStop = (ch) => (assertChannel(ch), `$STOP,${ch}`);
export const buildDeauth = (ch) => (assertChannel(ch), `$DEAUTH,${ch}`);
export const buildClear = (ch) => (assertChannel(ch), `$CLEAR,${ch}`);

export function buildGetParam(ch, slot) {
  assertChannel(ch);
  assertSlot(slot);
  return `$GETPARAM,${ch},${slot}`;
}

export function buildSetParam(ch, slot, { vset, iset, ocp, otp, lvp }) {
  assertChannel(ch);
  assertSlot(slot);
  assertParamRange('vset', vset);
  assertParamRange('iset', iset);
  assertParamRange('ocp', ocp);
  assertParamRange('otp', otp);
  assertParamRange('lvp', lvp);
  if (Number(ocp) < Number(iset)) {
    throw new Error(`ocp (${ocp}) harus >= iset (${iset})`);
  }
  return `$SETPARAM,${ch},${slot},${Number(vset).toFixed(2)},${Number(iset).toFixed(2)},` +
    `${Number(ocp).toFixed(2)},${Math.round(Number(otp))},${Number(lvp).toFixed(2)}`;
}

// ChState firmware -> enum kolom channels.status
export const CH_STATE = { IDLE: 0, SELECT: 1, CHARGING: 2, DONE: 3, FAULT: 4, PAUSED: 5 };

export function chStateToStatus(st) {
  switch (st) {
    case CH_STATE.CHARGING: return 'CHARGING';
    case CH_STATE.FAULT:    return 'FAULT';
    case CH_STATE.PAUSED:   return 'PAUSED';
    default:                return 'READY'; // IDLE/SELECT/DONE = bisa dipakai lagi
  }
}
