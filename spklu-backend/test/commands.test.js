import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSelect, buildAuth, buildStart, buildStop, buildDeauth, buildClear,
  buildGetParam, buildSetParam,
  chStateToStatus, CH_STATE,
} from '../src/services/commands.js';

test('buildAuth menghasilkan format persis kontrak firmware', () => {
  assert.equal(buildAuth(1, 'SABC123', 2, 15000), '$AUTH,1,SABC123,2,15000');
  assert.equal(buildAuth(3, 'SXYZ', 1, 1.5), '$AUTH,3,SXYZ,1,1.500');
  assert.equal(buildAuth(2, 'SDUR', 3, 3600.4), '$AUTH,2,SDUR,3,3600');
});

test('buildAuth menolak nilai yang akan ditolak firmware (#ERR)', () => {
  assert.throws(() => buildAuth(0, 'SID', 1, 1), /channel/);      // bad_ch
  assert.throws(() => buildAuth(4, 'SID', 1, 1), /channel/);      // bad_ch
  assert.throws(() => buildAuth(1, 'SID', 0, 1), /limitType/);    // 0 bukan sesi berbayar
  assert.throws(() => buildAuth(1, 'SID', 5, 1), /limitType/);    // bad_ltype
  assert.throws(() => buildAuth(1, 'SID', 2, 0), /limitValue/);   // bad_limit
  assert.throws(() => buildAuth(1, 'SID', 2, -5), /limitValue/);  // bad_limit
});

test('buildAuth menolak sessionId yang akan rusak di firmware', () => {
  assert.throws(() => buildAuth(1, 'ada spasi', 1, 1), /sessionId/);
  assert.throws(() => buildAuth(1, 'punya,koma', 1, 1), /sessionId/); // koma merusak parsing CSV
  assert.throws(() => buildAuth(1, 'X'.repeat(24), 1, 1), /sessionId/); // > char[23]
  assert.throws(() => buildAuth(1, '', 1, 1), /sessionId/);
});

test('perintah sederhana valid', () => {
  assert.equal(buildSelect(2, 7), '$SELECT,2,7');
  assert.throws(() => buildSelect(1, 10), /fw_slot/);
  assert.equal(buildStart(1), '$START,1');
  assert.equal(buildStop(3), '$STOP,3');
  assert.equal(buildDeauth(2), '$DEAUTH,2');
  assert.equal(buildClear(1), '$CLEAR,1');
});

test('buildSelect menyertakan nama motor tersanitasi', () => {
  assert.equal(buildSelect(2, 7, 'Honda ICON-e'), '$SELECT,2,7,Honda ICON-e');
  assert.equal(buildSelect(1, 0, 'Motor, "Aneh"'), '$SELECT,1,0,Motor Aneh');
  assert.equal(buildSelect(1, 0, 'AC\\DC Motor'), '$SELECT,1,0,ACDC Motor');
  assert.equal(buildSelect(1, 0, ''), '$SELECT,1,0');
  assert.equal(buildSelect(1, 0), '$SELECT,1,0');

  const long = 'A'.repeat(40);
  assert.equal(buildSelect(1, 0, long), '$SELECT,1,0,' + 'A'.repeat(24));
});

test('mapping ChState firmware -> status channel DB', () => {
  assert.equal(chStateToStatus(CH_STATE.IDLE), 'READY');
  assert.equal(chStateToStatus(CH_STATE.SELECT), 'READY');
  assert.equal(chStateToStatus(CH_STATE.CHARGING), 'CHARGING');
  assert.equal(chStateToStatus(CH_STATE.DONE), 'READY');
  assert.equal(chStateToStatus(CH_STATE.FAULT), 'FAULT');
  assert.equal(chStateToStatus(CH_STATE.PAUSED), 'PAUSED');
});

test('buildGetParam format & validasi', () => {
  assert.equal(buildGetParam(1, 0), '$GETPARAM,1,0');
  assert.throws(() => buildGetParam(0, 0), /channel/);
  assert.throws(() => buildGetParam(1, 10), /slot/);
});

test('buildSetParam format & validasi rentang', () => {
  const p = { vset: 64.3, iset: 15, ocp: 16, otp: 65, lvp: 85 };
  assert.equal(buildSetParam(1, 0, p), '$SETPARAM,1,0,64.30,15.00,16.00,65,85.00');

  assert.throws(() => buildSetParam(1, 0, { ...p, vset: 0.5 }), /vset/);
  assert.throws(() => buildSetParam(1, 0, { ...p, vset: 200 }), /vset/);
  assert.throws(() => buildSetParam(1, 0, { ...p, iset: -1 }), /iset/);
  assert.throws(() => buildSetParam(1, 0, { ...p, ocp: 60 }), /ocp/);
  assert.throws(() => buildSetParam(1, 0, { ...p, otp: 50 }), /otp/);
  assert.throws(() => buildSetParam(1, 0, { ...p, lvp: 5 }), /lvp/);
  assert.throws(() => buildSetParam(1, 0, { ...p, ocp: 10, iset: 15 }), />=/);
});
