# Motor Selection Authority — Part B (Remote V/I Parameter Write) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Superadmin bisa membaca dan menulis parameter elektrik (V-SET,
I-SET, OCP, OTP, LVP) untuk slot motor M0-M9 di channel manapun langsung
dari web admin panel, dengan interlock keselamatan, validasi batas nilai,
audit log lengkap, dan konfirmasi dua langkah di UI.

**Architecture:** Protokol firmware baru `$GETPARAM`/`$SETPARAM` (pola sama
dengan `$AUTH`/`$SELECT` yang sudah ada) menulis langsung ke register modul
XY-12550S via Modbus (reuse `xyWriteGroup15`/`xyVerifyGroup`/`saveProfileToNVS`
yang sudah dipakai jalur Settings-teknisi lokal) dan mengembalikan JSON
old+new dalam satu balasan `#OK setparam {...}`. Backend expose lewat
endpoint REST khusus role SUPERADMIN, mencatat setiap percobaan (sukses
maupun gagal) ke tabel audit baru.

**Tech Stack:** C++ (Arduino, ESP32), Node.js/Express (`node:test`),
React/TypeScript.

## Global Constraints

- **PRASYARAT KERAS:** Part A (`2026-07-10-motor-selection-authority-part-a.md`)
  HARUS sudah selesai dieksekusi dan di-commit sebelum plan ini dimulai —
  Task 2 di bawah menambah blok baru tepat setelah blok `$SELECT,` yang
  diubah Part A Task 1, dan memakai `webMotorName`/`selectFromBackend` yang
  didefinisikan di sana.
- Endpoint baru WAJIB pakai middleware `requireSuperadmin` (bukan
  `requireAdmin`) — ini sudah ada di `spklu-backend/src/auth/jwt.js:45` dan
  sudah dipakai pola yang sama di beberapa route `/admin/admins*`. Role
  `SUPERADMIN` sendiri SUDAH ada di schema (`spklu-backend/db/schema-delta.sql:11`)
  dan sudah diterapkan di produksi — TIDAK ADA migration role baru yang
  perlu ditulis di plan ini.
- Firmware WAJIB menolak `$SETPARAM` saat `ch[c].state == CHARGING` —
  interlock ini dicek DUA KALI (firmware DAN backend) supaya tidak ada
  celah race condition antara request diterima backend dan dieksekusi
  firmware.
- Validasi rentang nilai di backend (`commands.js`) HARUS identik dengan
  constraint yang sudah dipakai firmware di jalur `ADJ,` lokal
  (`SPKLU_Esp32_Rev8.2.ino:1480-1487`): VSET 1.0-125.0V, ISET 0.0-50.0A,
  OCP 0.1-52.0A (dan OCP >= ISET), OTP 60-120°C, LVP 10.0-145.0V.
- Firmware: tidak ada compiler tersedia di environment eksekusi plan ini —
  setiap task firmware WAJIB diverifikasi manual (baca ulang diff, lalu
  Verify/Compile di Arduino IDE user) sebelum diklaim selesai.
- Setiap percobaan `$SETPARAM` (sukses ATAU gagal) WAJIB tercatat di
  `motor_param_audit_log` — jangan ada jalur kode yang melewatkan insert
  audit log ini.

---

## File Structure

- Create: `spklu-backend/db/schema-delta-2.sql` — tabel `motor_param_audit_log`.
- Modify: `SPKLU_Esp32_Rev8.2/SPKLU_Esp32_Rev8.2.ino` — helper `csvField()`,
  blok `$SETPARAM,`/`$GETPARAM,` di `backendHandleLine()`.
- Modify: `spklu-backend/src/services/commands.js` — `buildGetParam()`,
  `buildSetParam()` dengan validasi rentang.
- Modify: `spklu-backend/test/commands.test.js` — test untuk kedua builder.
- Modify: `spklu-backend/src/routes/admin.js` — endpoint
  `GET/POST /admin/channels/:id/params[/:slot]`.
- Modify: `tools/machine-sim/sim.js` — simulasi `$GETPARAM`/`$SETPARAM`
  untuk testing end-to-end tanpa hardware.
- Create: `spklu-frontend/src/pages/admin/MotorParamsModal.tsx` — form edit
  parameter + konfirmasi dua langkah.
- Modify: `spklu-frontend/src/pages/admin/Channels.tsx` — tombol
  "Parameter Motor" (SUPERADMIN only) yang membuka modal di atas.

---

### Task 1: Migration — tabel audit log

**Files:**
- Create: `spklu-backend/db/schema-delta-2.sql`

**Interfaces:**
- Produces: tabel `motor_param_audit_log(id, admin_user_id, device_id,
  channel, fw_slot, old_values JSON, new_values JSON, result, created_at)`
  — dipakai Task 4 (endpoint admin).

- [ ] **Step 1: Tulis file migration**

```sql
-- ============================================================================
-- SPKLU · Delta Schema 2 — audit log remote-write parameter motor (Part B)
--   mysql -u root -p spklu_db < db/schema-delta-2.sql
-- Prasyarat: schema-delta.sql SUDAH diterapkan (butuh tabel users, devices,
-- channels, dan role SUPERADMIN).
-- ============================================================================
USE spklu_db;

CREATE TABLE IF NOT EXISTS motor_param_audit_log (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  admin_user_id  INT NOT NULL,
  device_id      INT NOT NULL,
  channel        TINYINT NOT NULL,
  fw_slot        TINYINT NOT NULL,
  old_values     JSON NULL,
  new_values     JSON NOT NULL,
  result         ENUM('OK','FAILED') NOT NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_mpal_admin  FOREIGN KEY (admin_user_id) REFERENCES users(id),
  CONSTRAINT fk_mpal_device FOREIGN KEY (device_id) REFERENCES devices(id),
  KEY idx_mpal_device (device_id, channel),
  KEY idx_mpal_admin (admin_user_id)
) ENGINE=InnoDB;
```

- [ ] **Step 2: Terapkan ke MySQL lokal untuk development**

Run: `mysql -u root -p spklu_db < spklu-backend/db/schema-delta-2.sql`
Expected: tidak ada error. Verifikasi:
Run: `mysql -u root -p spklu_db -e "SHOW COLUMNS FROM motor_param_audit_log;"`
Expected: menampilkan 9 kolom sesuai definisi di atas.

- [ ] **Step 3: Commit**

```bash
git add spklu-backend/db/schema-delta-2.sql
git commit -m "DB: tabel motor_param_audit_log untuk audit remote-write parameter motor"
```

---

### Task 2: Firmware — `$GETPARAM` & `$SETPARAM`

**Files:**
- Modify: `SPKLU_Esp32_Rev8.2/SPKLU_Esp32_Rev8.2.ino`

**Interfaces:**
- Consumes: `selectFromBackend`/`webMotorName` TIDAK dipakai di task ini
  (hanya prasyarat urutan eksekusi — lihat Global Constraints). Reuse
  `xyEnableStage(c)`, `xySetOutput(c, bool)`, `SW_CLF_DELAY_MS`,
  `xyWriteGroup15(c, m, MotorProfile&)`, `xyVerifyGroup(c, m, MotorProfile&)`,
  `saveProfileToNVS(c, m)`, `xyReadBlock(c)` — semua sudah ada, tidak diubah.
- Produces: balasan serial `#OK setparam {...}` / `#OK getparam {...}` /
  `#ERR <code>` — dipakai Task 4 (`admin.js`, parsing via `reply.slice(...)`).

- [ ] **Step 1: Tambah helper `csvField()`**

Cari fungsi `parseChannel` (sekitar baris 1323, `static inline bool
parseChannel(...)`). Tambahkan tepat SEBELUM fungsi tersebut:

```cpp
// Ekstrak field ke-n (0-based) dari string CSV mulai dari startIdx.
// Contoh: csvField("$X,1,2,3", 3, 1) -> "2". Return "" bila field ke-n
// tidak ada (tidak cukup koma).
static String csvField(const String& s, int startIdx, uint8_t n) {
  int pos = startIdx;
  for (uint8_t i = 0; i < n; i++) {
    pos = s.indexOf(',', pos);
    if (pos < 0) return "";
    pos++;
  }
  int end = s.indexOf(',', pos);
  return (end < 0) ? s.substring(pos) : s.substring(pos, end);
}
```

- [ ] **Step 2: Tambah blok `$SETPARAM,` dan `$GETPARAM,` di `backendHandleLine()`**

Cari blok `$SELECT,` (hasil ubahan Part A Task 1 Step 3 — dimulai komentar
`// $SELECT,<ch>,<m>[,<name>]`) di dalam `backendHandleLine()`. Tambahkan
DUA blok baru tepat SETELAH blok `$SELECT,` selesai (`return; }` penutupnya),
SEBELUM blok `$START,` berikutnya:

```cpp
  // $SETPARAM,<ch>,<slot>,<vset>,<iset>,<ocp>,<otp>,<lvp>
  // Remote-write parameter elektrik satu slot M0-M9. Interlock CHARGING +
  // validasi rentang identik dengan ADJ, (halaman Settings lokal) — supaya
  // remote-write tidak bisa menulis nilai yang tak akan pernah lolos lewat
  // jalur fisik. Balasan membawa JSON old+new untuk audit log backend.
  if (ln.startsWith("$SETPARAM,")) {
    int chNum  = csvField(ln, 10, 0).toInt();
    int slot   = csvField(ln, 10, 1).toInt();
    float vset = csvField(ln, 10, 2).toFloat();
    float iset = csvField(ln, 10, 3).toFloat();
    float ocp  = csvField(ln, 10, 4).toFloat();
    int otp    = csvField(ln, 10, 5).toInt();
    float lvp  = csvField(ln, 10, 6).toFloat();

    if (chNum < 1 || chNum > 3 || slot < 0 || slot > 9) { Serial.println("#ERR setparam_arg"); return; }
    uint8_t c = (uint8_t)(chNum - 1);
    if (!chEnabled(c)) { Serial.println("#ERR ch_disabled"); return; }
    if (ch[c].state == CHARGING) { Serial.println("#ERR ch_charging"); return; }

    if (vset < 1.0f   || vset > 125.0f) { Serial.println("#ERR range_vset"); return; }
    if (iset < 0.0f   || iset > 50.0f)  { Serial.println("#ERR range_iset"); return; }
    if (ocp  < 0.1f   || ocp  > 52.0f)  { Serial.println("#ERR range_ocp");  return; }
    if (otp  < 60     || otp  > 120)    { Serial.println("#ERR range_otp");  return; }
    if (lvp  < 10.0f  || lvp  > 145.0f) { Serial.println("#ERR range_lvp");  return; }
    if (ocp < iset) { Serial.println("#ERR ocp_lt_iset"); return; }

    MotorProfile oldP = profiles[c][slot];

    MotorProfile newP;
    newP.label  = oldP.label; // nama tetap dikontrol lewat $SELECT, bukan di sini
    newP.vset_V = vset; newP.iset_A = iset; newP.ocp_A = ocp;
    newP.otp_C  = otp;  newP.lvp_V  = lvp;

    xyEnableStage(c);
    xySetOutput(c, false);
    delay(SW_CLF_DELAY_MS);

    bool okW = xyWriteGroup15(c, (uint8_t)slot, newP);
    bool okV = okW ? xyVerifyGroup(c, (uint8_t)slot, newP) : false;
    if (!okW || !okV) { Serial.println("#ERR setparam_write_failed"); return; }

    profiles[c][slot] = newP;
    saveProfileToNVS(c, (uint8_t)slot);
    if (ch[c].motorIdx == (uint8_t)slot) xyReadBlock(c);

    char cb[220];
    snprintf(cb, sizeof(cb),
      "#OK setparam {\"ch\":%d,\"slot\":%d,"
      "\"old\":{\"vset\":%.2f,\"iset\":%.2f,\"ocp\":%.2f,\"otp\":%d,\"lvp\":%.2f},"
      "\"new\":{\"vset\":%.2f,\"iset\":%.2f,\"ocp\":%.2f,\"otp\":%d,\"lvp\":%.2f}}",
      chNum, slot, oldP.vset_V, oldP.iset_A, oldP.ocp_A, oldP.otp_C, oldP.lvp_V,
      newP.vset_V, newP.iset_A, newP.ocp_A, newP.otp_C, newP.lvp_V);
    Serial.println(cb);
    return;
  }

  // $GETPARAM,<ch>,<slot> — baca nilai tersimpan satu slot (read-only, untuk
  // prefill form admin sebelum $SETPARAM).
  if (ln.startsWith("$GETPARAM,")) {
    int chNum = csvField(ln, 10, 0).toInt();
    int slot  = csvField(ln, 10, 1).toInt();
    if (chNum < 1 || chNum > 3 || slot < 0 || slot > 9) { Serial.println("#ERR getparam_arg"); return; }
    uint8_t c = (uint8_t)(chNum - 1);
    if (!chEnabled(c)) { Serial.println("#ERR ch_disabled"); return; }

    const auto &p = profiles[c][slot];
    char cb[200];
    snprintf(cb, sizeof(cb),
      "#OK getparam {\"ch\":%d,\"slot\":%d,\"label\":\"%s\","
      "\"vset\":%.2f,\"iset\":%.2f,\"ocp\":%.2f,\"otp\":%d,\"lvp\":%.2f}",
      chNum, slot, p.label.c_str(), p.vset_V, p.iset_A, p.ocp_A, p.otp_C, p.lvp_V);
    Serial.println(cb);
    return;
  }
```

- [ ] **Step 3: Verifikasi manual (tidak ada compiler di environment ini)**

Baca ulang kedua blok baru, periksa:
- `csvField()` dari Step 1 sudah muncul SEBELUM `backendHandleLine()`
  didefinisikan di file (urutan deklarasi C++).
- Tidak ada bentrok nama fungsi/variabel dengan yang sudah ada.
- Format string `snprintf` — jumlah `%s`/`%.2f`/`%d` di template PERSIS
  sama urutan dan jumlahnya dengan argumen yang di-pass setelahnya (mismatch
  di sini adalah bug klasik yang tidak akan tertangkap compiler C++, hanya
  crash/garbage output saat runtime).

Laporkan ke user: *"Perubahan firmware Part B selesai ditulis, tolong
Verify/Compile di Arduino IDE dan upload ke device test sebelum lanjut ke
verifikasi manual di Task 6."*

- [ ] **Step 4: Commit**

```bash
git add SPKLU_Esp32_Rev8.2/SPKLU_Esp32_Rev8.2.ino
git commit -m "Firmware: tambah \$SETPARAM/\$GETPARAM untuk remote-write parameter motor

Interlock CHARGING + validasi rentang identik jalur ADJ, lokal. Balasan
\$SETPARAM membawa JSON old+new untuk audit log backend. Reuse
xyWriteGroup15/xyVerifyGroup/saveProfileToNVS yang sudah dipakai halaman
Settings teknisi — tidak ada jalur tulis baru ke modul XY-12550S."
```

---

### Task 3: Backend — `buildGetParam()` & `buildSetParam()`

**Files:**
- Modify: `spklu-backend/src/services/commands.js`
- Test: `spklu-backend/test/commands.test.js`

**Interfaces:**
- Produces: `buildGetParam(ch: number, slot: number): string`,
  `buildSetParam(ch: number, slot: number, params: {vset, iset, ocp, otp,
  lvp}): string` — dipakai Task 4 (`admin.js`).

- [ ] **Step 1: Tambah test yang gagal dulu**

Tambahkan di akhir `spklu-backend/test/commands.test.js`, setelah import
tambahkan `buildGetParam, buildSetParam` ke daftar import baris 3-6:

```javascript
import {
  buildSelect, buildAuth, buildStart, buildStop, buildDeauth, buildClear,
  buildGetParam, buildSetParam,
  chStateToStatus, CH_STATE,
} from '../src/services/commands.js';
```

Lalu tambahkan test baru di akhir file:

```javascript
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
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `node --test test/commands.test.js`
Expected: FAIL — `buildGetParam`/`buildSetParam` belum diekspor dari
`commands.js` (`SyntaxError` atau `undefined is not a function`).

- [ ] **Step 3: Implementasi**

Edit `spklu-backend/src/services/commands.js`. Tambahkan setelah fungsi
`assertChannel` (baris 8-12):

```javascript
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
```

Tambahkan di akhir file (setelah `buildClear`):

```javascript
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
```

- [ ] **Step 4: Jalankan test, pastikan lolos**

Run: `node --test test/commands.test.js`
Expected: PASS semua test di file ini.

- [ ] **Step 5: Commit**

```bash
git add spklu-backend/src/services/commands.js spklu-backend/test/commands.test.js
git commit -m "Backend: buildGetParam/buildSetParam dengan validasi rentang identik firmware"
```

---

### Task 4: Backend — endpoint admin + audit log

**Files:**
- Modify: `spklu-backend/src/routes/admin.js`

**Interfaces:**
- Consumes: `buildGetParam`, `buildSetParam` dari Task 3;
  `sendToDevice` dari `../realtime/deviceHub.js` (sudah ada,
  `spklu-backend/src/realtime/deviceHub.js:190`); `requireSuperadmin` dari
  `../auth/jwt.js` (sudah ada, sudah diimport di baris 4 file ini).
- Produces: `GET /admin/channels/:id/params/:slot` ->
  `{ch, slot, label, vset, iset, ocp, otp, lvp}`;
  `POST /admin/channels/:id/params` (body `{slot, vset, iset, ocp, otp,
  lvp}`) -> `{ch, slot, old:{...}, new:{...}}` — dipakai Task 6 (frontend).

- [ ] **Step 1: Tambah import**

Edit baris 3-7 `spklu-backend/src/routes/admin.js`:

```javascript
import { query, withTx } from '../db.js';
import { authRequired, requireAdmin, requireSuperadmin } from '../auth/jwt.js';
import { paginate } from './helpers.js';
import { notify } from '../realtime/clientHub.js';
import { isDeviceOnline } from '../realtime/deviceHub.js';
```

menjadi:

```javascript
import { query, withTx } from '../db.js';
import { authRequired, requireAdmin, requireSuperadmin } from '../auth/jwt.js';
import { paginate } from './helpers.js';
import { notify } from '../realtime/clientHub.js';
import { isDeviceOnline, sendToDevice } from '../realtime/deviceHub.js';
import { buildGetParam, buildSetParam } from '../services/commands.js';
```

- [ ] **Step 2: Tambah dua endpoint baru**

Cari blok `/channels/:id/maintenance` (baris 190-202). Tambahkan DUA
endpoint baru tepat SETELAHNYA, SEBELUM komentar `// ===== Motor Profiles`:

```javascript
// ===== Parameter Motor per-slot (SUPERADMIN) — remote V/I write =====
adminRouter.get('/channels/:id/params/:slot', requireSuperadmin, async (req, res, next) => {
  try {
    const slot = Number(req.params.slot);
    const [chn] = await query(
      `SELECT c.device_ch, d.id AS device_id FROM channels c
       JOIN devices d ON d.id = c.device_id WHERE c.id = ?`,
      [req.params.id],
    );
    if (!chn) return res.status(404).json({ error: 'Channel tidak ditemukan' });

    let line;
    try { line = buildGetParam(chn.device_ch, slot); }
    catch (err) { return res.status(400).json({ error: err.message }); }

    const reply = await sendToDevice(chn.device_id, line);
    res.json(JSON.parse(reply.slice('#OK getparam '.length)));
  } catch (err) { next(err); }
});

adminRouter.post('/channels/:id/params', requireSuperadmin, async (req, res, next) => {
  try {
    const { slot, vset, iset, ocp, otp, lvp } = req.body || {};
    const [chn] = await query(
      `SELECT c.device_ch, c.status, d.id AS device_id FROM channels c
       JOIN devices d ON d.id = c.device_id WHERE c.id = ?`,
      [req.params.id],
    );
    if (!chn) return res.status(404).json({ error: 'Channel tidak ditemukan' });
    if (chn.status === 'CHARGING') {
      return res.status(409).json({ error: 'Tidak bisa ubah parameter saat channel sedang CHARGING' });
    }

    let line;
    try { line = buildSetParam(chn.device_ch, Number(slot), { vset, iset, ocp, otp, lvp }); }
    catch (err) { return res.status(400).json({ error: err.message }); }

    let reply;
    try {
      reply = await sendToDevice(chn.device_id, line);
    } catch (err) {
      await query(
        `INSERT INTO motor_param_audit_log
           (admin_user_id, device_id, channel, fw_slot, old_values, new_values, result)
         VALUES (?,?,?,?,NULL,?,'FAILED')`,
        [req.user.id, chn.device_id, chn.device_ch, slot, JSON.stringify({ vset, iset, ocp, otp, lvp })],
      );
      return res.status(502).json({ error: `Mesin menolak: ${err.message}` });
    }

    const json = JSON.parse(reply.slice('#OK setparam '.length));
    await query(
      `INSERT INTO motor_param_audit_log
         (admin_user_id, device_id, channel, fw_slot, old_values, new_values, result)
       VALUES (?,?,?,?,?,?,'OK')`,
      [req.user.id, chn.device_id, chn.device_ch, slot, JSON.stringify(json.old), JSON.stringify(json.new)],
    );
    res.json(json);
  } catch (err) { next(err); }
});
```

- [ ] **Step 3: Verifikasi manual endpoint (butuh backend + simulator jalan — lihat Task 5 untuk simulator baru)**

Task ini akan diverifikasi bersama Task 5 (simulator perlu mendukung
`$GETPARAM`/`$SETPARAM` dulu supaya endpoint bisa dites tanpa hardware).
Tunda verifikasi manual endpoint ke Task 5 Step 3 — jangan skip, hanya
digabung supaya tidak menyalakan backend+simulator dua kali.

- [ ] **Step 4: Commit**

```bash
git add spklu-backend/src/routes/admin.js
git commit -m "Backend: endpoint GET/POST /admin/channels/:id/params (SUPERADMIN) + audit log"
```

---

### Task 5: Simulator — dukungan `$GETPARAM`/`$SETPARAM`

**Files:**
- Modify: `tools/machine-sim/sim.js`

**Interfaces:**
- Consumes: tidak ada (state internal simulator saja).
- Produces: balasan `#OK getparam {...}` / `#OK setparam {...}` dengan
  format JSON identik firmware asli — dipakai untuk verifikasi manual
  endpoint Task 4 tanpa hardware.

- [ ] **Step 1: Tambah state `params` per channel**

Cari `mkCh` (baris 23-27):

```javascript
const mkCh = () => ({
  state: ST.IDLE, motorIdx: 0, authorized: false, sessionId: '',
  limitType: 0, limitKwh: 0, limitRp: 0, limitSec: 0, limitReached: false,
  kwh: 0, sec: 0, vout: 0, iout: 0,
});
```

Ganti dengan:

```javascript
const defaultParams = () => ({ vset: 64.30, iset: 15.00, ocp: 16.00, otp: 65, lvp: 85.00 });

const mkCh = () => ({
  state: ST.IDLE, motorIdx: 0, authorized: false, sessionId: '',
  limitType: 0, limitKwh: 0, limitRp: 0, limitSec: 0, limitReached: false,
  kwh: 0, sec: 0, vout: 0, iout: 0,
  params: Array.from({ length: 10 }, defaultParams),
});
```

- [ ] **Step 2: Tambah handler `$GETPARAM,`/`$SETPARAM,`**

Cari blok `$SELECT,` (baris 139-145). Tambahkan DUA blok baru tepat
SETELAHNYA, SEBELUM blok `$START,`:

```javascript
  if (line.startsWith('$GETPARAM,')) {
    const [chS, slotS] = line.slice(10).split(',');
    const c = parseCh(chS), slot = Number(slotS);
    if (c < 0 || !(slot >= 0 && slot <= 9)) return send('#ERR getparam_arg');
    const p = ch[c].params[slot];
    return send(`#OK getparam {"ch":${c + 1},"slot":${slot},"label":"Slot ${slot}",` +
      `"vset":${p.vset.toFixed(2)},"iset":${p.iset.toFixed(2)},"ocp":${p.ocp.toFixed(2)},` +
      `"otp":${p.otp},"lvp":${p.lvp.toFixed(2)}}`);
  }
  if (line.startsWith('$SETPARAM,')) {
    const [chS, slotS, vsetS, isetS, ocpS, otpS, lvpS] = line.slice(10).split(',');
    const c = parseCh(chS), slot = Number(slotS);
    if (c < 0 || !(slot >= 0 && slot <= 9)) return send('#ERR setparam_arg');
    if (ch[c].state === ST.CHARGING) return send('#ERR ch_charging');
    const old = ch[c].params[slot];
    const next = {
      vset: Number(vsetS), iset: Number(isetS), ocp: Number(ocpS),
      otp: Number(otpS), lvp: Number(lvpS),
    };
    ch[c].params[slot] = next;
    return send(`#OK setparam {"ch":${c + 1},"slot":${slot},` +
      `"old":{"vset":${old.vset.toFixed(2)},"iset":${old.iset.toFixed(2)},"ocp":${old.ocp.toFixed(2)},"otp":${old.otp},"lvp":${old.lvp.toFixed(2)}},` +
      `"new":{"vset":${next.vset.toFixed(2)},"iset":${next.iset.toFixed(2)},"ocp":${next.ocp.toFixed(2)},"otp":${next.otp},"lvp":${next.lvp.toFixed(2)}}}`);
  }
```

- [ ] **Step 3: Verifikasi manual endpoint Task 4 + simulator, end-to-end**

Pastikan `spklu-backend/db/schema-delta-2.sql` sudah diterapkan (Task 1).
Jalankan di 2 terminal:

Terminal 1: `cd spklu-backend && npm start`
Terminal 2: `cd tools/machine-sim && SIM_MODE=ONLINE node sim.js`

Login sebagai superadmin (`rd@cmw.co.id`), ambil token JWT dari
`localStorage` browser atau dari response `/api/auth/login`, lalu dari
terminal ketiga:

```bash
curl -s http://127.0.0.1:3001/api/admin/channels/1/params/0 \
  -H "Authorization: Bearer <TOKEN>"
```

Expected: JSON `{"ch":1,"slot":0,"label":"Slot 0","vset":64.3,"iset":15,"ocp":16,"otp":65,"lvp":85}`.

```bash
curl -s -X POST http://127.0.0.1:3001/api/admin/channels/1/params \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"slot":0,"vset":58.8,"iset":10,"ocp":11,"otp":65,"lvp":75}'
```

Expected: JSON dengan `old` (nilai sebelumnya, 64.3/15/16/65/85) dan `new`
(58.8/10/11/65/75). Verifikasi audit log tercatat:

```bash
mysql -u root -p spklu_db -e "SELECT * FROM motor_param_audit_log ORDER BY id DESC LIMIT 1;"
```

Expected: satu baris baru, `result='OK'`, `old_values`/`new_values` cocok
dengan response curl di atas.

Matikan Terminal 1 dan 2 (Ctrl+C) setelah selesai.

- [ ] **Step 4: Commit**

```bash
git add tools/machine-sim/sim.js
git commit -m "Simulator: dukungan \$GETPARAM/\$SETPARAM untuk testing tanpa hardware"
```

---

### Task 6: Frontend — modal edit parameter + konfirmasi dua langkah

**Files:**
- Create: `spklu-frontend/src/pages/admin/MotorParamsModal.tsx`
- Modify: `spklu-frontend/src/pages/admin/Channels.tsx`

**Interfaces:**
- Consumes: `GET /admin/channels/:id/params/:slot`,
  `POST /admin/channels/:id/params` dari Task 4; `useAuth()` dari
  `spklu-frontend/src/lib/auth.tsx` (pola `user?.role === 'SUPERADMIN'`
  sudah dipakai di `spklu-frontend/src/layouts/AdminLayout.tsx:178`).
- Produces: komponen `MotorParamsModal` — dipakai `Channels.tsx`.

- [ ] **Step 1: Buat `MotorParamsModal.tsx`**

```tsx
// spklu-frontend/src/pages/admin/MotorParamsModal.tsx
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Field, Button } from '../../components/ui';
import { Modal, ConfirmDialog, useToast } from '../../components/overlay';

interface ParamValues { vset: number; iset: number; ocp: number; otp: number; lvp: number }
interface GetParamResponse extends ParamValues { ch: number; slot: number; label: string }
interface SetParamResponse { ch: number; slot: number; old: ParamValues; new: ParamValues }

const FIELDS: { key: keyof ParamValues; label: string; unit: string; step: string }[] = [
  { key: 'vset', label: 'V-SET', unit: 'V', step: '0.01' },
  { key: 'iset', label: 'I-SET', unit: 'A', step: '0.01' },
  { key: 'ocp', label: 'OCP', unit: 'A', step: '0.01' },
  { key: 'otp', label: 'OTP', unit: '°C', step: '1' },
  { key: 'lvp', label: 'LVP', unit: 'V', step: '0.01' },
];

export function MotorParamsModal({
  channelId, channelLabel, open, onClose,
}: { channelId: number; channelLabel: string; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [slot, setSlot] = useState(0);
  const [loading, setLoading] = useState(false);
  const [original, setOriginal] = useState<ParamValues | null>(null);
  const [form, setForm] = useState<ParamValues | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setOriginal(null);
    setForm(null);
    api.get<GetParamResponse>(`/admin/channels/${channelId}/params/${slot}`)
      .then((r) => {
        const v: ParamValues = { vset: r.vset, iset: r.iset, ocp: r.ocp, otp: r.otp, lvp: r.lvp };
        setOriginal(v);
        setForm(v);
      })
      .catch((err) => toast('err', err instanceof Error ? err.message : 'Gagal baca parameter'))
      .finally(() => setLoading(false));
  }, [open, slot, channelId]);

  const save = async () => {
    if (!form) return;
    await api.post<SetParamResponse>(`/admin/channels/${channelId}/params`, { slot, ...form });
    toast('ok', `Parameter slot M${slot} tersimpan.`);
    onClose();
  };

  return (
    <>
      <Modal open={open && !confirming} onClose={onClose} title={`Parameter Motor — ${channelLabel}`} wide>
        <div className="mb-4 flex flex-col gap-1.5">
          <label htmlFor="param-slot" className="text-[13px] font-bold text-ink-700">Slot (M0-M9)</label>
          <select
            id="param-slot"
            value={slot}
            onChange={(e) => setSlot(Number(e.target.value))}
            className="rounded-control border border-line bg-white px-4 py-3 text-sm font-medium text-ink-900 outline-none focus:border-cmw-500 focus:ring-2 focus:ring-cmw-100"
          >
            {Array.from({ length: 10 }, (_, i) => (
              <option key={i} value={i}>M{i}</option>
            ))}
          </select>
        </div>

        {loading && <p className="text-sm text-ink-400">Memuat nilai saat ini…</p>}

        {form && !loading && (
          <div className="grid grid-cols-2 gap-4">
            {FIELDS.map((f) => (
              <Field
                key={f.key}
                label={`${f.label} (${f.unit})`}
                type="number"
                step={f.step}
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) })}
              />
            ))}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2.5">
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button variant="primary" disabled={!form} onClick={() => setConfirming(true)}>
            Simpan
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={save}
        title={`Konfirmasi ubah parameter slot M${slot}?`}
        body={
          original && form
            ? FIELDS.map((f) => `${f.label}: ${original[f.key]} -> ${form[f.key]} ${f.unit}`).join(' · ')
            : ''
        }
        confirmLabel="Ya, tulis ke mesin"
        danger
      />
    </>
  );
}
```

- [ ] **Step 2: Integrasikan ke `Channels.tsx`**

Edit `spklu-frontend/src/pages/admin/Channels.tsx`. Ganti import baris 1-8:

```tsx
import { useEffect, useState } from 'react';
import { Wrench } from 'lucide-react';
import { api } from '../../lib/api';
import { Badge } from '../../components/ui';
import { ConfirmDialog, useToast } from '../../components/overlay';
import { PageHeader, Table, Pager } from './shared';
import { useTopic } from '../../lib/ws';
import type { Paged } from '../../lib/types';
```

menjadi:

```tsx
import { useEffect, useState } from 'react';
import { Wrench, SlidersHorizontal } from 'lucide-react';
import { api } from '../../lib/api';
import { Badge } from '../../components/ui';
import { ConfirmDialog, useToast } from '../../components/overlay';
import { PageHeader, Table, Pager } from './shared';
import { useTopic } from '../../lib/ws';
import { useAuth } from '../../lib/auth';
import { MotorParamsModal } from './MotorParamsModal';
import type { Paged } from '../../lib/types';
```

Tambahkan state baru setelah `const [confirming, setConfirming] =
useState<ChannelRow | null>(null);` (baris 28):

```tsx
  const [confirming, setConfirming] = useState<ChannelRow | null>(null);
  const [editingParams, setEditingParams] = useState<ChannelRow | null>(null);
  const { user } = useAuth();
```

Ganti sel Maintenance (baris 66-75):

```tsx
              <td className="px-4 py-3">
                <button
                  onClick={() => (ch.maintenance ? toggleMaintenance(ch) : setConfirming(ch))}
                  disabled={!ch.maintenance && ch.status === 'CHARGING'}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${ch.maintenance ? 'bg-energy-50 text-energy-700 hover:bg-energy-100' : 'bg-surface-sunken text-ink-600 hover:bg-amber-100 hover:text-amber-700'}`}
                >
                  <Wrench size={13} />
                  {ch.maintenance ? 'Aktifkan lagi' : 'Maintenance'}
                </button>
              </td>
```

menjadi:

```tsx
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => (ch.maintenance ? toggleMaintenance(ch) : setConfirming(ch))}
                    disabled={!ch.maintenance && ch.status === 'CHARGING'}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${ch.maintenance ? 'bg-energy-50 text-energy-700 hover:bg-energy-100' : 'bg-surface-sunken text-ink-600 hover:bg-amber-100 hover:text-amber-700'}`}
                  >
                    <Wrench size={13} />
                    {ch.maintenance ? 'Aktifkan lagi' : 'Maintenance'}
                  </button>
                  {user?.role === 'SUPERADMIN' && (
                    <button
                      onClick={() => setEditingParams(ch)}
                      disabled={ch.status === 'CHARGING'}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-surface-sunken px-3 py-2 text-[12px] font-bold text-ink-600 transition-colors hover:bg-cmw-100 hover:text-cmw-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <SlidersHorizontal size={13} />
                      Parameter Motor
                    </button>
                  )}
                </div>
              </td>
```

Tambahkan render `MotorParamsModal` setelah `<ConfirmDialog ... />` di
akhir JSX (sebelum penutup `</div>` terakhir, baris 90-91):

```tsx
      {editingParams && (
        <MotorParamsModal
          channelId={editingParams.id}
          channelLabel={`CH ${editingParams.device_ch} — ${editingParams.machine_name ?? 'mesin'}`}
          open={editingParams !== null}
          onClose={() => setEditingParams(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verifikasi manual di browser**

Pastikan backend (`npm start`) dan simulator (`SIM_MODE=ONLINE node
sim.js`) jalan (lihat Task 5 Step 3), lalu jalankan frontend dev server
(`cd spklu-frontend && npm run dev`).

1. Login sebagai `rd@cmw.co.id` (superadmin) — buka
   `/admin/channels` — tombol "Parameter Motor" harus terlihat.
2. Login sebagai admin biasa (kalau ada akun test dengan role `ADMIN`,
   bukan `SUPERADMIN`) — tombol "Parameter Motor" TIDAK BOLEH terlihat.
3. Sebagai superadmin, klik "Parameter Motor" pada salah satu channel —
   modal terbuka, field terisi otomatis dari `$GETPARAM` (nilai default
   simulator: 64.30/15.00/16.00/65/85.00).
4. Ganti slot ke M1 — field harus reload ke nilai default yang sama
   (simulator: semua slot punya default identik).
5. Ubah nilai V-SET jadi `58.8`, klik Simpan — dialog konfirmasi muncul
   menampilkan "V-SET: 64.3 -> 58.8 V" di antara field lainnya.
6. Klik "Ya, tulis ke mesin" — toast sukses muncul, modal tertutup.
7. Buka lagi modal untuk slot yang sama — field V-SET harus menampilkan
   `58.8` (bukti `$GETPARAM` membaca nilai yang baru saja ditulis, bukan
   cache lama).
8. Coba buka modal untuk channel yang sedang `CHARGING` (kalau ada sesi
   simulator aktif) — tombol "Parameter Motor" harus disabled.

Laporkan hasil checklist ini ke user.

- [ ] **Step 4: Commit**

```bash
git add spklu-frontend/src/pages/admin/MotorParamsModal.tsx spklu-frontend/src/pages/admin/Channels.tsx
git commit -m "Frontend: modal edit parameter motor per-slot (SUPERADMIN) + konfirmasi dua langkah"
```

---

### Task 7: Regresi penuh + verifikasi akhir on-device

**Files:** tidak ada file baru — regresi lintas seluruh perubahan Part B.

- [ ] **Step 1: Jalankan seluruh test suite backend**

Run (dari `spklu-backend/`): `npm test`
Expected: semua test PASS, termasuk test baru dari Task 3.

- [ ] **Step 2: Jalankan trial E2E untuk pastikan Part B tidak merusak alur sesi charging biasa**

Terminal 1: `cd spklu-backend && npm start`
Terminal 2: `cd tools/machine-sim && SIM_MODE=ONLINE SIM_SPEEDUP=600 node sim.js`
Terminal 3: `cd spklu-backend && node tools/trial-e2e.mjs`

Expected: `✔ SEMUA PEMERIKSAAN LOLOS` — memastikan endpoint/protokol baru
tidak mengganggu alur `$SELECT/$AUTH/$START/$STOP` yang sudah ada.

Matikan Terminal 1 dan 2 setelah selesai.

- [ ] **Step 3: Verifikasi manual on-device (setelah Task 2 firmware di-upload ke ESP32 asli)**

Checklist untuk dijalankan user di hardware fisik:
1. Set channel dalam keadaan TIDAK `CHARGING`. Dari web admin (superadmin),
   buka "Parameter Motor", pilih slot yang sedang TIDAK dipakai
   (`ch[c].motorIdx` berbeda dari slot yang dipilih), ubah salah satu nilai,
   simpan.
2. Cek di layar Nextion halaman Settings (`SETOPEN,`) untuk slot yang sama
   — nilai yang tampil harus sesuai dengan yang baru saja ditulis dari web.
3. Mulai sesi charging (dari web atau HMI) memakai SLOT yang baru diubah —
   pastikan mesin benar-benar charge dengan V/I sesuai nilai baru (ukur
   dengan multimeter di output kalau memungkinkan, atau bandingkan dengan
   tampilan `t_vset`/`t_iset` di layar Nextion selama charging).
3. Coba ubah parameter untuk slot yang SEDANG DIPAKAI channel yang lagi
   `CHARGING` — request dari web harus ditolak dengan pesan error 409
   (endpoint) sebelum sempat mengirim `$SETPARAM` ke mesin.
4. Cek tabel `motor_param_audit_log` di database produksi — setiap
   percobaan (baik yang sukses maupun yang ditolak karena CHARGING) harus
   punya jejak yang bisa ditelusuri ke akun superadmin yang melakukannya.

Laporkan hasil checklist ini ke user sebelum menganggap Part B selesai.

- [ ] **Step 4: Tidak ada commit di step ini** — task ini murni verifikasi;
  semua perubahan kode sudah di-commit di task-task sebelumnya.
