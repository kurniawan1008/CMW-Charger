# Motor Selection Authority — Part A (Blokir Picker Fisik + Sinkron Nama) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Blokir tombol pilih-motor fisik di layar Nextion (`b_m0..b_m9`) saat
mesin mode ONLINE, dan sinkronkan nama motor yang ditampilkan tombol dengan
nama yang dipilih user di web — tanpa mengubah parameter elektrik (V/I/dll),
yang tetap murni dari NVS lokal per slot.

**Architecture:** Firmware `handleCmd("SEL,...")` adalah satu-satunya titik
yang mengubah `ch[c].motorIdx`, dipanggil dari dua sumber (tombol Nextion
lokal via `nx.hasLine()`, dan `$SELECT` dari backend via
`backendHandleLine()`). Tambah flag `selectFromBackend` untuk membedakan
sumber panggilan tanpa mengubah kontrak fungsi. Nama motor dari web dikirim
sebagai field opsional ke-3 di `$SELECT`, disimpan di RAM
(`webMotorName[3]`, bukan NVS) dan dipakai `uiSetMotorLabels()` +
`uiUpdateMonitor()` untuk override kosmetik tampilan tombol/label ringkasan.

**Tech Stack:** C++ (Arduino, ESP32) untuk firmware; Node.js (`node:test`)
untuk backend.

## Global Constraints

- Firmware: tidak ada compiler tersedia di environment eksekusi plan ini
  (tidak ada `arduino-cli` terpasang) — setiap task firmware WAJIB
  diverifikasi manual: baca ulang diff untuk kesalahan sintaks/tipe, lalu
  buka file di Arduino IDE milik user (tombol Verify/Compile) sebelum
  upload ke device asli. Jangan klaim "selesai" untuk task firmware tanpa
  langkah ini dicatat eksplisit ke user.
- Parameter elektrik (V-SET/I-SET/OCP/OTP/LVP) TIDAK BOLEH disentuh oleh
  perubahan apa pun di plan ini — itu scope Part B (plan terpisah,
  `2026-07-10-motor-selection-authority-part-b.md`), yang HARUS dieksekusi
  setelah Part A selesai (Part B mereferensikan baris firmware hasil
  perubahan Part A).
- Field `profiles[c][m].label` (dipakai halaman Settings teknisi) TIDAK
  BOLEH ditulis oleh logic baru di plan ini — override nama hanya lewat
  `webMotorName[c]`, terpisah total dari struct itu.
- Backend: jalankan `npm test` (dari `spklu-backend/`) dan pastikan semua
  test lolos sebelum setiap commit yang menyentuh `src/services/commands.js`
  atau `src/services/sessionService.js`.

---

## File Structure

- Modify: `SPKLU_Esp32_Rev8.2/SPKLU_Esp32_Rev8.2.ino` — flag `selectFromBackend`,
  array `webMotorName[3]`, guard mode ONLINE di blok `SEL,`, parsing nama
  opsional di blok `$SELECT,`, override tampilan di `uiSetMotorLabels()` dan
  `uiUpdateMonitor()`.
- Modify: `spklu-backend/src/services/commands.js` — `buildSelect()` terima
  parameter `name` opsional, sanitasi sebelum dikirim.
- Modify: `spklu-backend/test/commands.test.js` — test baru untuk
  `buildSelect` dengan nama.
- Modify: `spklu-backend/src/services/sessionService.js` — kirim nama motor
  (`brand + model`) ke `buildSelect()`.

---

### Task 1: Firmware — blokir picker lokal saat ONLINE + override nama tampilan

**Files:**
- Modify: `SPKLU_Esp32_Rev8.2/SPKLU_Esp32_Rev8.2.ino`

**Interfaces:**
- Produces: global `bool selectFromBackend` (default `false`), global
  `String webMotorName[3]` (default `{"", "", ""}`) — dipakai Part B untuk
  tidak menimpa mekanisme ini saat menambah `$SETPARAM`/`$GETPARAM`.

- [ ] **Step 1: Tambah dua variabel global baru**

Cari deklarasi `static bool requireAuth = false;` (sekitar baris 67, di
bawah komentar blok "Runtime mode flag"). Tambahkan tepat setelahnya:

```cpp
static bool requireAuth = false;

// Part A — pemisahan otoritas pilih motor (web vs HMI fisik):
//  - selectFromBackend: true HANYA selama backendHandleLine() memanggil
//    handleCmd("SEL,...") atas nama $SELECT dari web. Dipakai blok SEL,
//    di handleCmd() untuk membedakan tombol Nextion lokal dari relay
//    backend, TANPA mengubah signature fungsi yang sudah ada.
//  - webMotorName[3]: override kosmetik nama tombol per channel, RAM saja
//    (bukan NVS) — TIDAK PERNAH menimpa profiles[c][m].label yang dipakai
//    halaman Settings teknisi. Kosong = pakai label default firmware.
static bool selectFromBackend = false;
static String webMotorName[3] = {"", "", ""};
```

- [ ] **Step 2: Tambah guard mode ONLINE + reset override di blok `SEL,` (handleCmd)**

Cari blok berikut (dalam `handleCmd()`, dimulai `if (cmd.startsWith("SEL,"))`):

```cpp
  if (cmd.startsWith("SEL,")) {
    int p1 = cmd.indexOf(',', 4);
    if (p1 < 0) return;

    int chNum = cmd.substring(4, p1).toInt();
    int mIdx  = cmd.substring(p1+1).toInt();
    if (chNum < 1 || chNum > 3 || mIdx < 0 || mIdx > 9) return;

    uint8_t c = (uint8_t)(chNum - 1);
    if (!ensureChannelEnabled(c)) return;

    // Interlock
    if (ch[c].state == CHARGING) { setChanMsg(c, "STOP dulu (OUTPUT ON)", 0xFCA0); return; }
    if (ch[c].state == FAULT)    { setChanMsg(c, "FAULT - tekan CLEAR", 0xFCA0); return; }

    if (xySelectDataSet(c, (uint8_t)mIdx)) {
      ch[c].motorIdx = (uint8_t)mIdx;
      ch[c].state = SELECT;
      if (xyReadBlock(c)) resetSession(c);
      if (activePage == (uint8_t)(c+1)) uiHighlightMotor(ch[c].motorIdx);
      uiMsg("PROFILE SELECTED", 0xAD97);
    } else {
      uiMsg("SELECT FAILED", 0xF9C6);
    }
    return;
  }
```

Ganti seluruhnya dengan:

```cpp
  if (cmd.startsWith("SEL,")) {
    int p1 = cmd.indexOf(',', 4);
    if (p1 < 0) return;

    int chNum = cmd.substring(4, p1).toInt();
    int mIdx  = cmd.substring(p1+1).toInt();
    if (chNum < 1 || chNum > 3 || mIdx < 0 || mIdx > 9) return;

    uint8_t c = (uint8_t)(chNum - 1);
    if (!ensureChannelEnabled(c)) return;

    // Interlock
    if (ch[c].state == CHARGING) { setChanMsg(c, "STOP dulu (OUTPUT ON)", 0xFCA0); return; }
    if (ch[c].state == FAULT)    { setChanMsg(c, "FAULT - tekan CLEAR", 0xFCA0); return; }

    // Command lokal (tombol Nextion) diblokir saat mode ONLINE — satu-
    // satunya sumber pilihan motor jadi aplikasi web selama requireAuth
    // aktif. Command dari backend (selectFromBackend=true) selalu lolos.
    if (requireAuth && !selectFromBackend) {
      setChanMsg(c, "Pilih motor via aplikasi", 0xFCA0);
      return;
    }

    if (xySelectDataSet(c, (uint8_t)mIdx)) {
      ch[c].motorIdx = (uint8_t)mIdx;
      // Pilihan lokal (OFFLINE mode) selalu pakai label asli — bukan sisa
      // override dari sesi web sebelumnya.
      if (!selectFromBackend) webMotorName[c] = "";
      ch[c].state = SELECT;
      if (xyReadBlock(c)) resetSession(c);
      if (activePage == (uint8_t)(c+1)) { uiHighlightMotor(ch[c].motorIdx); uiSetMotorLabels(c); }
      uiMsg("PROFILE SELECTED", 0xAD97);
    } else {
      uiMsg("SELECT FAILED", 0xF9C6);
    }
    return;
  }
```

- [ ] **Step 3: Parsing nama opsional di blok `$SELECT,` (backendHandleLine)**

Cari blok berikut (dalam `backendHandleLine()`):

```cpp
  // $SELECT,<ch>,<m>
  if (ln.startsWith("$SELECT,")) {
    int p1 = ln.indexOf(',', 8);
    if (p1 < 0) { Serial.println("#ERR sel_format"); return; }
    int chNum = ln.substring(8, p1).toInt();
    int mIdx  = ln.substring(p1 + 1).toInt();
    if (chNum < 1 || chNum > 3 || mIdx < 0 || mIdx > 9) { Serial.println("#ERR sel_arg"); return; }
    handleCmd("SEL," + String(chNum) + "," + String(mIdx));
    Serial.println("#OK select");
    return;
  }
```

Ganti seluruhnya dengan:

```cpp
  // $SELECT,<ch>,<m>[,<name>] — name opsional: label tampilan dari katalog
  // web, override kosmetik tombol Nextion (webMotorName[]). Parameter
  // elektrik TIDAK dikirim di sini — itu murni dari slot NVS lokal (m).
  if (ln.startsWith("$SELECT,")) {
    int p1 = ln.indexOf(',', 8);
    if (p1 < 0) { Serial.println("#ERR sel_format"); return; }
    int p2 = ln.indexOf(',', p1 + 1); // -1 kalau nama tidak dikirim
    String mPart = (p2 < 0) ? ln.substring(p1 + 1) : ln.substring(p1 + 1, p2);
    int chNum = ln.substring(8, p1).toInt();
    int mIdx  = mPart.toInt();
    if (chNum < 1 || chNum > 3 || mIdx < 0 || mIdx > 9) { Serial.println("#ERR sel_arg"); return; }
    uint8_t c = (uint8_t)(chNum - 1);
    String name = (p2 >= 0) ? ln.substring(p2 + 1) : "";

    selectFromBackend = true;
    handleCmd("SEL," + String(chNum) + "," + String(mIdx));
    selectFromBackend = false;

    // Terapkan override HANYA kalau seleksi di atas benar-benar sukses
    // (state==SELECT & motorIdx cocok — interlock CHARGING/FAULT tidak
    // mengubah motorIdx sama sekali, jadi override tidak boleh ikut ter-set
    // untuk seleksi yang sebenarnya ditolak).
    if (ch[c].state == SELECT && ch[c].motorIdx == (uint8_t)mIdx) {
      webMotorName[c] = name;
      if (activePage == (uint8_t)(c + 1)) uiSetMotorLabels(c);
    }
    Serial.println("#OK select");
    return;
  }
```

- [ ] **Step 4: Override di `uiSetMotorLabels()` (dipanggil ulang saat halaman channel dibuka/reload — `uiEnterPage()`)**

Cari:

```cpp
void uiSetMotorLabels(uint8_t c) {
  for(int i=0;i<10;i++){
    nxSendCmd("b_m"+String(i)+".txt=\""+profiles[c][i].label+"\"");
    delay(1);
  }
}
```

Ganti dengan:

```cpp
void uiSetMotorLabels(uint8_t c) {
  for(int i=0;i<10;i++){
    // Slot yang sedang aktif pakai nama dari web (webMotorName) kalau ada;
    // 9 slot lain (bukan pilihan aktif) selalu pakai label asli firmware.
    String label = (i == ch[c].motorIdx && webMotorName[c].length())
      ? webMotorName[c] : profiles[c][i].label;
    nxSendCmd("b_m"+String(i)+".txt=\""+label+"\"");
    delay(1);
  }
}
```

- [ ] **Step 5: Override di `uiUpdateMonitor()` (ringkasan nama motor aktif per channel)**

Cari (dalam `uiUpdateMonitor()`, loop `for(int c=0;c<3;c++)`):

```cpp
    snprintf(buf, sizeof(buf), "%s%s", pref_s, "mot.txt=\"");
    String mcmd = String(buf) + profiles[c][ch[c].motorIdx].label + "\"";
    nxSendCmd(mcmd);
```

Ganti dengan:

```cpp
    snprintf(buf, sizeof(buf), "%s%s", pref_s, "mot.txt=\"");
    String motLabel = webMotorName[c].length()
      ? webMotorName[c] : profiles[c][ch[c].motorIdx].label;
    String mcmd = String(buf) + motLabel + "\"";
    nxSendCmd(mcmd);
```

- [ ] **Step 6: Verifikasi manual (tidak ada compiler di environment ini)**

Baca ulang kelima perubahan di atas satu per satu, periksa:
- Tidak ada brace `{`/`}` yang tidak seimbang (blok `SEL,` dan `$SELECT,`
  masing-masing harus tetap diakhiri `return;` sebelum blok command
  berikutnya dimulai).
- Semua variabel yang dipakai (`selectFromBackend`, `webMotorName`,
  `activePage`, `uiSetMotorLabels`, `uiHighlightMotor`) sudah dideklarasikan
  SEBELUM baris yang memakainya (urutan deklarasi di file C++ penting —
  `selectFromBackend`/`webMotorName` dari Step 1 harus muncul sebelum
  `handleCmd()` dan `backendHandleLine()` didefinisikan).

Laporkan ke user: *"Perubahan firmware selesai ditulis, tidak bisa
dikompilasi otomatis di sini — tolong buka `SPKLU_Esp32_Rev8.2.ino` di
Arduino IDE, klik Verify, dan upload ke device test sebelum lanjut ke
verifikasi manual on-device di Task 3."*

- [ ] **Step 7: Commit**

```bash
git add SPKLU_Esp32_Rev8.2/SPKLU_Esp32_Rev8.2.ino
git commit -m "Firmware: blokir picker motor Nextion saat ONLINE, sinkron nama dari web

SEL, lokal (tombol Nextion) ditolak dengan pesan saat requireAuth=true;
\$SELECT dari backend (selectFromBackend=true) selalu lolos. Field ke-3
opsional pada \$SELECT membawa nama motor dari katalog web, disimpan di
webMotorName[] (RAM, bukan NVS) sebagai override kosmetik tombol/label
ringkasan — parameter elektrik tetap murni dari slot NVS lokal."
```

---

### Task 2: Backend — `buildSelect()` bawa nama motor tersanitasi

**Files:**
- Modify: `spklu-backend/src/services/commands.js:14-20`
- Test: `spklu-backend/test/commands.test.js`

**Interfaces:**
- Consumes: tidak ada (murni fungsi baru dari yang sudah ada).
- Produces: `buildSelect(ch: number, fwSlot: number, name?: string): string`
  — dipakai Task 3 (`sessionService.js`).

- [ ] **Step 1: Tambah test yang gagal dulu**

Edit `spklu-backend/test/commands.test.js`, tambahkan test baru setelah test
`'perintah sederhana valid'` (baris 37):

```javascript
test('buildSelect menyertakan nama motor tersanitasi', () => {
  assert.equal(buildSelect(2, 7, 'Honda ICON-e'), '$SELECT,2,7,Honda ICON-e');
  assert.equal(buildSelect(1, 0, 'Motor, "Aneh"'), '$SELECT,1,0,Motor Aneh');
  assert.equal(buildSelect(1, 0, ''), '$SELECT,1,0');
  assert.equal(buildSelect(1, 0), '$SELECT,1,0');

  const long = 'A'.repeat(40);
  assert.equal(buildSelect(1, 0, long), '$SELECT,1,0,' + 'A'.repeat(24));
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run (dari `spklu-backend/`): `node --test test/commands.test.js`
Expected: FAIL pada test baru — `buildSelect(2, 7, 'Honda ICON-e')` masih
menghasilkan `'$SELECT,2,7'` (argumen ke-3 diabaikan oleh implementasi lama).

- [ ] **Step 3: Implementasi minimal**

Edit `spklu-backend/src/services/commands.js`, ganti fungsi `buildSelect`
(baris 14-20):

```javascript
export function buildSelect(ch, fwSlot) {
  assertChannel(ch);
  if (!Number.isInteger(fwSlot) || fwSlot < 0 || fwSlot > 9) {
    throw new Error(`fw_slot harus 0..9, dapat: ${fwSlot}`);
  }
  return `$SELECT,${ch},${fwSlot}`;
}
```

menjadi:

```javascript
export function buildSelect(ch, fwSlot, name) {
  assertChannel(ch);
  if (!Number.isInteger(fwSlot) || fwSlot < 0 || fwSlot > 9) {
    throw new Error(`fw_slot harus 0..9, dapat: ${fwSlot}`);
  }
  if (!name) return `$SELECT,${ch},${fwSlot}`;
  // Sanitasi: koma memecah parsing CSV firmware, kutip bisa merusak string
  // Nextion; truncate supaya muat di lebar tombol b_mX pada layar HMI.
  const safe = String(name).replace(/[,"]/g, '').slice(0, 24).trim();
  return safe ? `$SELECT,${ch},${fwSlot},${safe}` : `$SELECT,${ch},${fwSlot}`;
}
```

- [ ] **Step 4: Jalankan test, pastikan lolos**

Run: `node --test test/commands.test.js`
Expected: PASS semua test di file ini, termasuk test lama
`'perintah sederhana valid'` (baris 31, `buildSelect(2, 7)` — 2 argumen,
harus tetap `'$SELECT,2,7'`).

- [ ] **Step 5: Commit**

```bash
git add spklu-backend/src/services/commands.js spklu-backend/test/commands.test.js
git commit -m "Backend: buildSelect bawa nama motor tersanitasi untuk override HMI"
```

---

### Task 3: Wire `sessionService.js` + regresi penuh

**Files:**
- Modify: `spklu-backend/src/services/sessionService.js:99`

**Interfaces:**
- Consumes: `buildSelect(ch, fwSlot, name?)` dari Task 2.

- [ ] **Step 1: Kirim nama motor saat start session**

Cari baris 99 di `spklu-backend/src/services/sessionService.js`:

```javascript
    await sendToDevice(channel.dev_id, buildSelect(ch, profile.fw_slot));
```

Ganti dengan:

```javascript
    await sendToDevice(channel.dev_id, buildSelect(ch, profile.fw_slot, `${profile.brand} ${profile.model}`));
```

- [ ] **Step 2: Jalankan seluruh test suite backend**

Run (dari `spklu-backend/`): `npm test`
Expected: semua test PASS (termasuk `billing.test.js`, `sessionId.test.js`,
`commands.test.js` dari Task 2).

- [ ] **Step 3: Jalankan trial E2E untuk regresi integrasi**

Pastikan MySQL/MariaDB lokal jalan dan backend `.env` sudah terkonfigurasi
(lihat `spklu-backend/.env.example`). Jalankan di 3 terminal terpisah:

Terminal 1: `cd spklu-backend && npm start`
Terminal 2: `cd tools/machine-sim && SIM_MODE=ONLINE SIM_SPEEDUP=600 node sim.js`
Terminal 3: `cd spklu-backend && node tools/trial-e2e.mjs`

Expected: skrip mencetak `✔ SEMUA PEMERIKSAAN LOLOS` — trial ini tidak
memverifikasi nama motor di layar (skrip tidak bisa melihat Nextion), tapi
memastikan alur `$SELECT → $AUTH → $START` masih berjalan normal dengan
signature `buildSelect` yang baru (3 argumen, argumen ke-3 tidak mengganggu
parsing simulator karena `sim.js` sudah destructure hanya 2 field pertama
dari hasil split koma).

Matikan proses Terminal 1 dan 2 (Ctrl+C) setelah selesai.

- [ ] **Step 4: Verifikasi manual on-device (setelah Task 1 di-upload ke ESP32 asli)**

Checklist untuk dijalankan user di hardware fisik (bukan simulator):
1. Set mesin mode ONLINE (`$SETONLINE` via serial monitor atau tombol HMI
   yang relevan).
2. Di layar Nextion channel, tekan salah satu tombol `b_mX` — harus muncul
   pesan `"Pilih motor via aplikasi"` di area pesan channel, TIDAK berubah
   motor aktif.
3. Dari web app, mulai sesi charging dengan memilih motor tertentu — begitu
   `$AUTH` diterima, tombol yang sesuai slot di layar Nextion harus berubah
   teksnya jadi nama motor dari web (bukan label default firmware).
4. Navigasi ke halaman lain di Nextion lalu kembali ke halaman channel yang
   sama — teks tombol harus TETAP menampilkan nama dari web (bukan reset ke
   label default).
5. Selesaikan/stop sesi, lalu set mesin mode OFFLINE — tombol `b_mX` harus
   bisa ditekan lagi secara normal tanpa pesan blokir.

Laporkan hasil checklist ini ke user sebelum menganggap Part A selesai.

- [ ] **Step 5: Commit**

```bash
git add spklu-backend/src/services/sessionService.js
git commit -m "Backend: sessionService kirim nama motor ke firmware via buildSelect"
```
