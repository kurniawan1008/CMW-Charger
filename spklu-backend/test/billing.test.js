import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  costFromKwh, reservationAmount, limitForMode, settleSession,
} from '../src/services/billing.js';

const PRICE = 2440;

test('costFromKwh membulatkan sesuai firmware (lroundf)', () => {
  assert.equal(costFromKwh(1, PRICE), 2440);
  assert.equal(costFromKwh(0.5, PRICE), 1220);
  assert.equal(costFromKwh(0, PRICE), 0);
  assert.equal(costFromKwh(2.0001, PRICE), Math.round(2.0001 * PRICE));
});

test('reservationAmount: kwh dibulatkan ke ATAS agar reservasi >= biaya maksimal', () => {
  assert.equal(reservationAmount('kwh', 2, PRICE), 4880);
  assert.equal(reservationAmount('kwh', 1.5, PRICE), 3660);
  assert.equal(reservationAmount('kwh', 0.3, PRICE), 732); // 0.3*2440=732 pas
  assert.equal(reservationAmount('kwh', 0.333, PRICE), Math.ceil(0.333 * PRICE));
  assert.equal(reservationAmount('idr', 15000, PRICE), 15000);
  assert.throws(() => reservationAmount('kwh', 0, PRICE));
  assert.throws(() => reservationAmount('menit', 5, PRICE), /mode/);
});

test('limitForMode memetakan mode UI -> limitType firmware', () => {
  assert.deepEqual(limitForMode('kwh', 2.5), { limitType: 1, limitValue: 2.5 });
  assert.deepEqual(limitForMode('idr', 15000), { limitType: 2, limitValue: 15000 });
  assert.throws(() => limitForMode('idr', -1));
});

test('settleSession: refund = reservasi - biaya, biaya tidak melebihi reservasi', () => {
  // Sesi target Rp 15.000, terpakai 5 kWh (12.200) -> refund 2.800
  assert.deepEqual(settleSession(15000, 5, PRICE), { cost: 12200, refund: 2800 });
  // Terpakai penuh
  assert.deepEqual(settleSession(4880, 2, PRICE), { cost: 4880, refund: 0 });
  // Guard pembulatan: biaya mentah > reservasi -> dipotong ke reservasi, refund 0
  const over = settleSession(4880, 2.001, PRICE);
  assert.equal(over.cost, 4880);
  assert.equal(over.refund, 0);
  // Fault dini: hampir semua kembali
  assert.deepEqual(settleSession(15000, 0.1, PRICE), { cost: 244, refund: 14756 });
});
