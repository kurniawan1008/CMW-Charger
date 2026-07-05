import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSessionId, isFirmwareSafeSessionId, SESSION_ID_MAX,
} from '../src/services/sessionId.js';

test('sessionId selalu muat di buffer firmware char[24] dan lolos sanitizer', () => {
  for (let i = 0; i < 500; i++) {
    const id = generateSessionId();
    assert.ok(id.length <= SESSION_ID_MAX, `terlalu panjang: ${id}`);
    assert.ok(isFirmwareSafeSessionId(id), `karakter tidak aman: ${id}`);
  }
});

test('sessionId unik pada timestamp yang sama (komponen random)', () => {
  const now = Date.now();
  const ids = new Set(Array.from({ length: 200 }, () => generateSessionId(now)));
  assert.ok(ids.size > 190, `terlalu banyak tabrakan: ${200 - ids.size}`);
});

test('isFirmwareSafeSessionId menolak UUID v4 penuh (36 char)', () => {
  assert.equal(isFirmwareSafeSessionId('550e8400-e29b-41d4-a716-446655440000'), false);
  assert.equal(isFirmwareSafeSessionId('S1ABC-DEF_2'), true);
  assert.equal(isFirmwareSafeSessionId('sid dengan spasi'), false);
  assert.equal(isFirmwareSafeSessionId(''), false);
});
