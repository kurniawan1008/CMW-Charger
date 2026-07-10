#include <Arduino.h>
#include <ModbusMaster.h>
#include <Preferences.h>
#include "esp_task_wdt.h"   // hardware watchdog (auto-reboot bila loop hang)
#include "esp_system.h"     // Phase 3 hardening: esp_reset_reason()
#include "spklu_types.h"

// ===========================================================
//                CONFIG (EDIT THIS SECTION)
// ===========================================================
// XY12550S registers
static const uint16_t REG_LOCK = 0x000F;   // 0=unlock, 1=lock
static const uint16_t REG_DEVICE = 0x001E; // device enable/status (R/W)
static const uint16_t REG_BLED = 0x0014;   // backlight brightness
static const uint16_t REG_SLEEP = 0x0015;  // rest screen time (minutes)
static const uint16_t XY_BLED_WAKE = 100;
static const uint16_t XY_BLED_SLEEP = 0;
static const uint16_t XY_SLEEP_MINUTES = 1;


//PIN
static String panelPin = "1234"; // default kalau belum ada di NVS

// Warna default (tidak aktif)
static const uint16_t MOTOR_INACTIVE_BCO = 0xFFFF; // background
static const uint16_t MOTOR_INACTIVE_PCO = 0x1A13; // teks putih (biar kebaca)

// Warna aktif (yang dipilih)
static const uint16_t MOTOR_ACTIVE_BCO   = 0x03DF; // background 0x03DF
static const uint16_t MOTOR_ACTIVE_PCO   = 0xFFFF; // teks putih

// Nextion UART
static const uint32_t NEXTION_BAUD = 115200;
static const int UART_NEXTION_RX = 16;
static const int UART_NEXTION_TX = 17;

// RS485 Modbus UART
static const uint32_t MODBUS_BAUD  = 56000;  // already configured on XY12550S
static const int UART_MODBUS_RX = 26;
static const int UART_MODBUS_TX = 27;

// Pricing
static const float PRICE_PER_KWH = 2440.0f;

// ===========================================================
//        BACKEND / PAYMENT INTEGRATION (Phase 2)
//  Antarmuka transport-agnostic lewat Serial (UART0/USB). Bisa dijembatani
//  oleh gateway server, modul WiFi/4G, atau Raspberry Pi yang terhubung ke
//  website payment. TIDAK mengganggu HMI Nextion (di Serial2 terpisah).
//
//  ENABLE_BACKEND        : aktifkan parser perintah + telemetri di UART0.
//  BACKEND_TELEMETRY_MS  : interval push #STATE (telemetri) ke backend.
//
//  MODE OPERASI (runtime, disimpan ke NVS):
//    OFFLINE (requireAuth=false) : tombol HMI bebas dipakai tanpa payment.
//                                  Cocok untuk uji coba atau mode mandiri.
//    ONLINE  (requireAuth=true)  : tombol HMI diblokir sampai $AUTH diterima.
//                                  Cocok untuk operasi berbayar penuh.
//  Toggle via: $SETONLINE / $SETOFFLINE dari backend, atau tombol ADM di HMI.
//  Status ditampilkan di HMI: "FREE MODE" vs "PAYMENT MODE".
// ===========================================================
static const bool     ENABLE_BACKEND       = true;
static const uint32_t BACKEND_TELEMETRY_MS  = 2000;

// Runtime mode flag — disimpan ke NVS key "req_auth"
// false = OFFLINE/FREE, true = ONLINE/PAYMENT
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

// Slave IDs for 3 channels
// NOTE: set to 0 to disable a channel in firmware.
static const uint8_t SLAVE_ID[3] = {1, 2, 3};
static inline bool chEnabled(uint8_t c){ return (c < 3) && (SLAVE_ID[c] != 0); }

// Start stop Timing
static uint32_t runMsAccum[3]  = {0,0,0};
static uint32_t runStartMs[3]  = {0,0,0};
static bool     runRunning[3]  = {false,false,false};
static bool     sessArmed[3]   = {false,false,false};

// State deteksi kabel dicabut
static uint8_t  cabutCount[3]   = {0, 0, 0};  // counter sample berturut-turut
static uint32_t cabutArmedMs[3] = {0, 0, 0};  // millis() batas mulai deteksi aktif

// Phase 3 hardening: rate-limit alarm suhu dini per channel
static uint32_t otWarnMs[3]     = {0, 0, 0};

// State debounce pushbutton emergency stop
static bool     btnLastRaw[3]      = {HIGH, HIGH, HIGH};
static bool     btnStable[3]       = {HIGH, HIGH, HIGH};
static uint32_t btnLastChangeMs[3] = {0, 0, 0};


// Timing
static const uint32_t POLL_INTERVAL_MS = 120;  // poll 1 channel every tick (RR)
static const uint32_t UI_INTERVAL_MS   = 250;

// Fault threshold
static const uint8_t MODBUS_FAIL_LIMIT = 5;

// Jumlah percobaan baca per poll sebelum dihitung gagal (tahan glitch RS485).
static const uint8_t MODBUS_READ_ATTEMPTS = 2;

// ===========================================================
//                 HARDWARE WATCHDOG (WDT)
//  Auto-reboot bila loop() macet > WDT_TIMEOUT_S detik. Penting untuk
//  stasiun tanpa operator. Operasi blocking terpanjang (PANELALL ~1s)
//  jauh di bawah timeout ini, jadi tidak akan reboot saat normal.
// ===========================================================
static const bool     ENABLE_TASK_WDT = true;
static const uint32_t WDT_TIMEOUT_S    = 12;

// ===========================================================
//          WATCHDOG EKSTERNAL (Phase 3 hardening)
//  Toggle pin ini tiap loop() untuk "menendang" IC WDT eksternal
//  (mis. TPS3813 / MAX6369) — sabuk-pengaman di atas WDT internal,
//  berguna bila WDT internal pun bermasalah. Set -1 untuk menonaktifkan.
// ===========================================================
static const int      EXT_WDT_PIN     = -1;   // contoh: GPIO4. -1 = nonaktif

// ===========================================================
//        ALARM SUHU DINI / SOFT OVER-TEMP (Phase 3 hardening)
//  Peringatan lebih awal di bawah OTP hardware XY-12550S. TIDAK
//  menggantikan OTP modul (itu tetap pengaman utama di hardware).
//   - t_in >= OTP_WARN_C  -> tampilkan peringatan + emit event (rate-limited)
//     (t_ex diabaikan untuk alarm: probe eksternal sengaja tidak dipasang,
//     hanya mengandalkan sensor internal modul yang sudah cukup akurat)
//   - OTP_SOFT_STOP true & suhu >= OTP_STOP_C -> hentikan output lebih dini
// ===========================================================
static const bool     OTP_SOFT_ENABLE = true;
static const float    OTP_WARN_C       = 70.0f;
static const bool     OTP_SOFT_STOP    = false;  // default: hanya warning
static const float    OTP_STOP_C       = 80.0f;
static const uint32_t OTP_WARN_INTERVAL_MS = 30000;

// ===========================================================
//            OCP AUTO-RECOVERY (Phase 1)
//  - Automatic retry setiap OCP_RETRY_INTERVAL_MS (2-3 detik)
//  - Max OCP_MAX_RETRIES (misal 5x) sebelum manual CLEAR
//  - Saat retry berhasil (output ON lagi), kembali ke CHARGING
//  - Saat exceed max retries, masuk OCP_FAULT (tunggu CLEAR manual)
// ===========================================================
static const uint32_t OCP_RETRY_INTERVAL_MS = 2500;  // 2.5 detik retry interval
static const uint8_t  OCP_MAX_RETRIES = 5;           // max 5 attempts


// Verify tolerances
static const float TOL_V   = 0.03f;   // 30mV
static const float TOL_A   = 0.03f;   // 30mA
static const float TOL_LVP = 0.08f;   // 80mV

// "Software CLF": always force output OFF before switching dataset / writing group.
static const bool SW_CLF_FORCE_OFF_BEFORE_SWITCH = true;
static const uint16_t SW_CLF_DELAY_MS = 20;

// ===========================================================
//          DETEKSI KABEL DICABUT (Cable Pull Detection)
//
//  Aktif hanya setelah charging berjalan >= CABUT_ARM_DELAY_MS.
//  Jika Iout tiba-tiba < CABUT_IOUT_THRESHOLD_A selama
//  CABUT_CONFIRM_SAMPLES sample berturut-turut => output OFF.
//
//  CABUT_IOUT_THRESHOLD_A : batas arus "beban hilang"
//  CABUT_CONFIRM_SAMPLES  : jumlah sample berturut-turut
//                           (120ms x 2 = 240ms konfirmasi)
//  CABUT_ISET_MIN_A       : deteksi aktif hanya jika iset >= ini
//                           (hindari false-trigger di CV tail)
//  CABUT_ARM_DELAY_MS     : grace period setelah START sebelum
//                           deteksi aktif (beri waktu arus naik)
// ===========================================================
static const float    CABUT_IOUT_THRESHOLD_A = 0.50f;
static const uint8_t  CABUT_CONFIRM_SAMPLES  = 2;
static const float    CABUT_ISET_MIN_A       = 4.0f;
static const uint32_t CABUT_ARM_DELAY_MS     = 5000; // 5 detik

// ===========================================================
//            PUSHBUTTON EXTERNAL EMERGENCY STOP
//  - 1 pushbutton per channel, fungsi: STOP saja.
//  - Tekan kapanpun saat CHARGING => STOP (identik tombol STOP di HMI).
//  - Jika tidak sedang CHARGING, tekanan diabaikan.
//  - Wiring: pushbutton antara GPIO dan GND, pakai INPUT_PULLUP.
//      C  -> GPIO
//      NO -> GND
//      NC -> tidak dipakai
//  - Debounce software 50ms, deteksi FALLING edge (tekan = LOW).
//  - Set pin ke -1 untuk menonaktifkan channel tertentu.
// ===========================================================
static const int      BTN_PIN[3]      = {32, 33, 25}; // GPIO CH1, CH2, CH3
static const uint32_t BTN_DEBOUNCE_MS = 50;

// ===========================================================
//                     SERIALS / MODBUS
// ===========================================================
HardwareSerial SerialModbus(1);
HardwareSerial SerialNextion(2);

ModbusMaster nodes[3];
Preferences prefs;

Channel ch[3];
MotorProfile profiles[3][10];

volatile uint8_t activePage = 0;

// W4 FIX: helper atomic read untuk activePage.
// Di ESP32 single-core Arduino, uint8_t read sudah atomic secara hardware,
// tapi fungsi ini mendokumentasikan intent dan memudahkan upgrade ke dual-core/FreeRTOS.
static inline uint8_t getActivePage() {
  return activePage; // uint8_t read pada ESP32 bersifat atomic
}

// Per-channel transient message (shown on g_sum on channel pages)
static String chanMsgText[3];
static uint16_t chanMsgColor[3] = {0xAD97,0xAD97,0xAD97};
static uint32_t chanMsgUntil[3] = {0,0,0};

// B2 FIX: cek expired dengan subtraksi unsigned, tahan millis() overflow 49-hari.
// BUGFIX (Rev8.3): logika sebelumnya TERBALIK -> pesan tidak tampil saat masih
// aktif, lalu menempel selamanya setelah lewat. Sekarang dipakai casting signed
// yang ringkas dan benar: expired bila (now - until) >= 0.
//   - Belum expired: millis() < until  -> selisih unsigned besar (>=0x80000000)
//                    -> (int32_t) bernilai negatif -> return false.
//   - Sudah expired: millis() >= until -> selisih kecil positif
//                    -> (int32_t) >= 0 -> return true.
static inline bool chanMsgExpired(uint8_t c) {
  return (int32_t)(millis() - chanMsgUntil[c]) >= 0;
}
 // from Nextion sendme (0=monitor, 1..3=channel pages, others=setting pages etc.)

// ===========================================================
//                        LOW LEVEL
// ===========================================================

// =====================  SKALA REGISTER XY12550S  =====================
// Sumber kebenaran tunggal untuk konversi <-> register (baca & tulis pakai
// konstanta yang SAMA supaya selalu konsisten).
//
//  - Voltage : 0.01V/LSB (datasheet radix 2)  -> SCALE 100   [cocok datasheet]
//  - Temp    : 0.1 C/LSB (datasheet radix 1)  -> /10
//  - OPP/S-OPP: 0.1W/LSB (datasheet radix 1)  -> *10
//
//  >>> PERINGATAN ARUS (WAJIB VERIFIKASI HARDWARE) <<<
//  Datasheet XY-12550S menyatakan I-SET/IOUT/S-OCP = radix 3 (0.001A/LSB, x1000),
//  contoh: 1.500A => 1500. Namun kode asli memakai x100 dengan catatan penulis
//  "confirmed: 15.00A => 1500" pada unit nyata. Kedua sisi (tulis & baca) di
//  firmware ini konsisten x100, sehingga nilai yang ditampilkan = nilai yang
//  di-set. Billing TIDAK terpengaruh (billing pakai register energi mWh).
//
//  JANGAN mengubah XY_A_SCALE ke 1000 tanpa mengukur arus nyata dengan clamp meter:
//   - x100 padahal hardware x1000  -> charger under-current (aman, hanya lambat).
//   - x1000 padahal hardware x100  -> charger OVER-CURRENT 10x (BAHAYA).
//  Default dipertahankan x100 (pilihan aman). Verifikasi, baru naikkan bila perlu.
static const float XY_V_SCALE = 100.0f;  // V  -> register
static const float XY_A_SCALE = 100.0f;  // A  -> register  (lihat peringatan di atas)
static const float XY_OPP_SCALE = 10.0f; // OPP 0.1W -> register (dipakai tulis & verify)

static inline uint16_t clampU16(int32_t x){ if(x<0) return 0; if(x>65535) return 65535; return (uint16_t)x; }
static inline uint16_t regV100(float v)  { return clampU16((int32_t)lroundf(v * XY_V_SCALE)); }
static inline uint16_t regA100(float a)  { return clampU16((int32_t)lroundf(a * XY_A_SCALE)); }

//Helper PIN
static bool isValidPin(const String& s){
  int n = s.length();
  if (n < 4 || n > 8) return false;
  for(int i=0;i<n;i++){
    if (!isDigit((unsigned char)s[i])) return false;
  }
  return true;
}

static void loadPanelPin(){
  // B3 FIX: pastikan namespace "spklu" aktif sebelum membaca PIN
  // loadProfilesFromNVSOrDefault() sudah memanggil prefs.begin("spklu"),
  // tapi loadPanelPin() dipanggil setelahnya jadi namespace sudah aktif.
  // Guard ini melindungi jika loadPanelPin() pernah dipanggil di konteks lain.
  panelPin = prefs.getString("panel_pin", "1234");
  if (!isValidPin(panelPin)) panelPin = "1234";
}

static void savePanelPin(const String& newPin){
  // Namespace "spklu" sudah dibuka sekali di loadProfilesFromNVSOrDefault()
  // (dipanggil di setup) dan tetap terbuka selama runtime. Memanggil
  // prefs.begin() berulang tidak diperlukan; cukup tulis nilainya.
  if (!isValidPin(newPin)) return;   // tolak PIN tidak valid
  panelPin = newPin;
  prefs.putString("panel_pin", panelPin);
}

// void rs485TxOn(){ digitalWrite(RS485_DE_RE, HIGH); }
// void rs485TxOff(){ digitalWrite(RS485_DE_RE, LOW); }
//void preTransmission(){ rs485TxOn(); }
//void postTransmission(){
  // Guard time (optional) – uncomment if you see sporadic timeouts/CRC issues.
  // SerialModbus.flush();
  // delayMicroseconds(200);
//   rs485TxOff();


// ===========================================================
//                      NEXTION HELPERS
// ===========================================================
void nxSendCmd(const String &cmd) {
  SerialNextion.print(cmd);
  SerialNextion.write(0xFF);
  SerialNextion.write(0xFF);
  SerialNextion.write(0xFF);
}

// Optional UI components (if you created them)
void uiMsg(const String& s, uint16_t color=0xAD97) {
  // if t_msg doesn't exist, Nextion will ignore (bkcmd=0 recommended)
  nxSendCmd("t_msg.txt=\"" + s + "\"");
  nxSendCmd("t_msg.pco=" + String(color));
}

// Show a short message on the active channel page (uses g_sum).
// This helps debugging interlocks like "STOP dulu" when user presses motor buttons.
void setChanMsg(uint8_t c, const String& s, uint16_t color=0xFCA0, uint32_t durMs=2500) {
  if (c >= 3) return;
  chanMsgText[c] = s;
  chanMsgColor[c] = color;
  chanMsgUntil[c] = millis() + durMs;
  if (activePage == (uint8_t)(c+1)) {
    nxSendCmd("g_sum.txt=\"" + s + "\"");
    nxSendCmd("g_sum.pco=" + String(color));
  }
}


// ===========================================================
//                 NEXTION INPUT PARSER (ROBUST)
//  - Handles Nextion return frames terminated by FF FF FF
//    (sendme 0x66, touch 0x65, ack 0x01/0x00, startup 0x00..)
//  - Handles ASCII commands ended with '\n'
// ===========================================================
struct NxParser {
  // ASCII command buffer
  String lineBuf;

  // Binary frame buffer (Nextion return data)
  bool inFrame = false;
  uint8_t fBuf[32];
  uint8_t fLen = 0;
  uint8_t ffCount = 0;

  void resetFrame(){ inFrame=false; fLen=0; ffCount=0; }

  void handleFrame() {
    if (fLen < 4) return; // minimal: <type> FF FF FF
    uint8_t type = fBuf[0];

    // strip last 3 FFs logically
    uint8_t payloadLen = (fLen >= 3) ? (uint8_t)(fLen - 3) : 0;

    // 0x66: sendme – current page
    if (type == 0x66 && payloadLen >= 2) {
      activePage = fBuf[1];
      return;
    }

    // 0x65: touch event (ignored here)
    // 0x00..0x1F: status/ack/error codes (ignored)
    // 0x70/0x71: get return string/number (ignored for now)
    (void)type;
  }

  bool hasLine(String &out) {
    out = "";

    while (SerialNextion.available()) {
      uint8_t b = SerialNextion.read();

      // If we're in a binary frame, accumulate until FF FF FF
      if (inFrame) {
        if (fLen < sizeof(fBuf)) fBuf[fLen++] = b;

        if (b == 0xFF) ffCount++; else ffCount = 0;

        if (ffCount >= 3) {
          // end of frame
          handleFrame();
          resetFrame();
        }
        continue;
      }

      // Start of binary frame?
      // IMPORTANT: do NOT treat '\r'/'\n' as binary, because those are our ASCII delimiters.
      const bool isAsciiDelimiter = (b == '\n' || b == '\r');
      const bool isKnownBinaryLead = (b == 0x65 || b == 0x66 || b == 0x67 || b == 0x68 || b == 0x70 || b == 0x71 || b == 0xFE || b == 0xFD);
      const bool isControl = (b < 0x20) && !isAsciiDelimiter;

      if (isKnownBinaryLead || isControl) {
        inFrame = true;
        fLen = 0;
        ffCount = 0;
        fBuf[fLen++] = b;
        continue;
      }

      // ASCII command handling
      char c = (char)b;
      if (c == '\n') {
        out = lineBuf;
        lineBuf = "";
        out.trim();
        if (out.length()) return true;
      } else if (c == '\r') {
        // ignore CR
      } else {
        lineBuf += c;
        if (lineBuf.length() > 220) lineBuf = "";
      }
    }

    return false;
  }
} nx;

// ===========================================================
//                      PROFILE DEFAULTS
// ===========================================================
void initDefaultProfiles() {
  for(int c=0;c<3;c++){
    profiles[c][0] = {"United T1800 Normal Charge", 64.30f, 15.00f, 16.00f, 65, 85.00f};
    profiles[c][1] = {"United T1800 Fast Charge", 64.30f, 20.00f, 21.00f, 65, 85.00f};
    profiles[c][2] = {"Polytron Normal Charge", 84.00f, 10.00f, 11.00f, 65, 85.00f};
    profiles[c][3] = {"Polytron Fast Charge", 84.00f,  20.00f,  21.00f, 65, 85.00f};
    profiles[c][4] = {"Gesits Normal Charge", 84.00f, 10.00f, 11.00f, 65, 85.00f};
    profiles[c][5] = {"Gesits Fast Charge", 84.00f, 20.00f, 21.00f, 65, 85.00f};
    profiles[c][6] = {"Honda CUV-e", 55.00f, 10.00f, 11.00f, 65, 85.00f};
    profiles[c][7] = {"Honda ICON-e", 55.00f, 10.00f, 11.00f, 65, 85.00f};
    profiles[c][8] = {"Polytron EVO",  71.00f,  10.00f, 11.00f, 65, 85.00f};
    profiles[c][9] = {"Alpha Atom", 62.40f, 10.00f, 11.00f, 65, 85.00f};
  }
}

// ===========================================================
//                      NVS (PREFERENCES)
// ===========================================================
static void makeKey(char* out, size_t outSz, const char* field, uint8_t c, uint8_t m) {
  // keep same prefix to preserve backward compatibility of keys
  // format: v1_ch<idx>_m<idx>_<field>
  snprintf(out, outSz, "v1_ch%u_m%u_%s", (unsigned)c, (unsigned)m, field);
}

void saveProfileToNVS(uint8_t c, uint8_t m) {
  char k[32];
  auto &p = profiles[c][m];

  makeKey(k,sizeof(k),"lab",c,m);  prefs.putString(k, p.label);
  makeKey(k,sizeof(k),"vset",c,m); prefs.putFloat (k, p.vset_V);
  makeKey(k,sizeof(k),"iset",c,m); prefs.putFloat (k, p.iset_A);
  makeKey(k,sizeof(k),"ocp", c,m); prefs.putFloat (k, p.ocp_A);
  makeKey(k,sizeof(k),"otp", c,m); prefs.putInt   (k, p.otp_C);
  makeKey(k,sizeof(k),"lvp", c,m); prefs.putFloat (k, p.lvp_V);
}

void loadProfilesFromNVSOrDefault() {
  initDefaultProfiles();

  prefs.begin("spklu", false);

  // first boot init
  if (!prefs.getBool("inited", false)) {
    for(uint8_t c=0;c<3;c++) for(uint8_t m=0;m<10;m++) saveProfileToNVS(c,m);
    prefs.putBool("inited", true);
    return;
  }

  char k[32];
  for(uint8_t c=0;c<3;c++){
    for(uint8_t m=0;m<10;m++){
      makeKey(k,sizeof(k),"lab",c,m);  profiles[c][m].label = prefs.getString(k, profiles[c][m].label);
      makeKey(k,sizeof(k),"vset",c,m); profiles[c][m].vset_V= prefs.getFloat (k, profiles[c][m].vset_V);
      makeKey(k,sizeof(k),"iset",c,m); profiles[c][m].iset_A= prefs.getFloat (k, profiles[c][m].iset_A);
      makeKey(k,sizeof(k),"ocp", c,m); profiles[c][m].ocp_A = prefs.getFloat (k, profiles[c][m].ocp_A);
      makeKey(k,sizeof(k),"otp", c,m); profiles[c][m].otp_C = prefs.getInt   (k, profiles[c][m].otp_C);
      makeKey(k,sizeof(k),"lvp", c,m); profiles[c][m].lvp_V = prefs.getFloat (k, profiles[c][m].lvp_V);
    }
  }
}

// ===========================================================
//                      XY12550S MODBUS OPS
// ===========================================================

static inline bool xyOk(uint8_t c, uint8_t mbRes) {
  return (chEnabled(c) && (mbRes == nodes[c].ku8MBSuccess));
}

bool xySetOutput(uint8_t c, bool on) {
  if (!chEnabled(c)) return false;
  return xyOk(c, nodes[c].writeSingleRegister(0x0012, on ? 1 : 0)); // ONOFF
}

// Try to "enable" device/panel logic so ONOFF works even when LCD panel is still off.
// This does NOT intentionally turn output ON; it only prepares the stage.
// W5 FIX: delay() di sini memblokir loop(). Fungsi ini hanya dipanggil dari:
//   - setup()      : blocking OK karena belum masuk loop
//   - PANELALL cmd : diterima dari HMI, blocking singkat bisa ditoleransi
//   - SETSAVE cmd  : diterima dari HMI, blocking singkat bisa ditoleransi
// Delay dikurangi ke minimum yang aman berdasarkan datasheet XY12550S.
bool xyEnableStage(uint8_t c) {
  if (!chEnabled(c)) return false;

  // 1) unlock (some units block ONOFF when locked)
  nodes[c].writeSingleRegister(REG_LOCK, 0);
  delay(20); // W5 FIX: dikurangi dari 30ms ke 20ms

  // 2) enable device logic (if supported by your XY firmware)
  nodes[c].writeSingleRegister(REG_DEVICE, 1);
  delay(50); // W5 FIX: dikurangi dari 80ms ke 50ms

  // 3) safety: make sure output is OFF before we proceed
  nodes[c].writeSingleRegister(0x0012, 0);
  delay(10); // W5 FIX: dikurangi dari 20ms ke 10ms

  // Optional verify (non-fatal)
  nodes[c].readHoldingRegisters(REG_DEVICE, 1);
  nodes[c].readHoldingRegisters(REG_LOCK, 1);
  return true;
}


bool xyExtractM(uint8_t c, uint8_t m) {
  if (!chEnabled(c)) return false;
  return xyOk(c, nodes[c].writeSingleRegister(0x001D, m)); // EXTRACT-M
}

bool xySelectDataSet(uint8_t c, uint8_t m) {
  if (!chEnabled(c)) return false;
  if (SW_CLF_FORCE_OFF_BEFORE_SWITCH) {
    xySetOutput(c, false);
    delay(SW_CLF_DELAY_MS);
  }
  bool ok = xyExtractM(c, m);
  if (SW_CLF_FORCE_OFF_BEFORE_SWITCH) delay(SW_CLF_DELAY_MS);
  return ok;
}

// Build 15 regs for group base..base+0x0E
void buildGroupRegs15(const MotorProfile& p, uint16_t regs[15]) {
  for(int i=0;i<15;i++) regs[i]=0;

  // default rules (can be expanded later per profile)
  float ovp  = p.vset_V * 1.05f;
  float oppW = p.vset_V * p.ocp_A;

  regs[0]  = regV100(p.vset_V);
  regs[1]  = regA100(p.iset_A);
  regs[2]  = regV100(p.lvp_V);
  regs[3]  = regV100(ovp);
  regs[4]  = regA100(p.ocp_A);
  regs[5]  = clampU16((int32_t)lroundf(oppW * XY_OPP_SCALE)); // 0.1W

  regs[6]  = 0; regs[7]=0;   // OHP off
  regs[8]  = 0; regs[9]=0;   // OAH off
  regs[10] = 0; regs[11]=0;  // OWH off

  regs[12] = (uint16_t)p.otp_C;
  regs[13] = 0; // INI default
  regs[14] = 0; // ETP off
}

bool xyWriteGroup15(uint8_t c, uint8_t m, const MotorProfile& p) {
  if (!chEnabled(c)) return false;

  uint16_t base = 0x0050 + (uint16_t)m * 0x0010;
  uint16_t regs[15];
  buildGroupRegs15(p, regs);
  for(int i=0;i<15;i++) nodes[c].setTransmitBuffer(i, regs[i]);
  return xyOk(c, nodes[c].writeMultipleRegisters(base, 15));
}

bool xyVerifyGroup(uint8_t c, uint8_t m, const MotorProfile& p) {
  if (!chEnabled(c)) return false;

  uint16_t base = 0x0050 + (uint16_t)m * 0x0010;
  uint8_t res = nodes[c].readHoldingRegisters(base, 15); // offsets 0..14
  if (!xyOk(c, res)) return false;

  auto get = [&](uint16_t off){ return nodes[c].getResponseBuffer(off); };

  // BUGFIX: pakai konstanta skala yang SAMA dengan sisi tulis (buildGroupRegs15),
  // supaya verify tidak selalu gagal bila XY_A_SCALE/XY_V_SCALE diubah kelak.
  float vset = get(0) / XY_V_SCALE;
  float iset = get(1) / XY_A_SCALE;
  float lvp  = get(2) / XY_V_SCALE;
  float ovp  = get(3) / XY_V_SCALE;
  float ocp  = get(4) / XY_A_SCALE;
  float opp  = get(5) / XY_OPP_SCALE;

  uint16_t ohp_h = get(6);
  uint16_t ohp_m = get(7);
  uint16_t oah_l = get(8);
  uint16_t oah_h = get(9);
  uint16_t owh_l = get(10);
  uint16_t owh_h = get(11);

  int otp   = (int)get(12);
  uint16_t ini = get(13);
  uint16_t etp = get(14);

  float ovpExp  = p.vset_V * 1.05f;
  float oppExpW = p.vset_V * p.ocp_A;

  if (fabsf(vset - p.vset_V) > TOL_V) return false;
  if (fabsf(iset - p.iset_A) > TOL_A) return false;
  if (fabsf(lvp  - p.lvp_V ) > TOL_LVP) return false;
  if (fabsf(ovp  - ovpExp ) > TOL_V) return false;
  if (fabsf(ocp  - p.ocp_A) > TOL_A) return false;
  if (fabsf(opp  - oppExpW) > 1.0f) return false; // power tolerance (W)

  // expected to be off by default
  if (ohp_h != 0 || ohp_m != 0) return false;
  if (oah_l != 0 || oah_h != 0) return false;
  if (owh_l != 0 || owh_h != 0) return false;

  if (otp != p.otp_C) return false;
  if (ini != 0) return false;
  if (etp != 0) return false;

  return true;
}

bool xyReadBlock(uint8_t c) {
  if (!chEnabled(c)) return false;

  // 0x0000..0x0014 (21 registers)
  uint8_t res = nodes[c].readHoldingRegisters(0x0000, 0x0015);
  if (!xyOk(c, res)) return false;

  auto &r = ch[c].r;

  uint16_t vset = nodes[c].getResponseBuffer(0x0000);
  uint16_t iset = nodes[c].getResponseBuffer(0x0001);
  uint16_t vout = nodes[c].getResponseBuffer(0x0002);
  uint16_t iout = nodes[c].getResponseBuffer(0x0003);
  uint16_t pwr  = nodes[c].getResponseBuffer(0x0004);
  uint16_t uin  = nodes[c].getResponseBuffer(0x0005);

  uint16_t wh_l = nodes[c].getResponseBuffer(0x0008);
  uint16_t wh_h = nodes[c].getResponseBuffer(0x0009);

  uint16_t out_h= nodes[c].getResponseBuffer(0x000A);
  uint16_t out_m= nodes[c].getResponseBuffer(0x000B);
  uint16_t out_s= nodes[c].getResponseBuffer(0x000C);

  uint16_t t_in = nodes[c].getResponseBuffer(0x000D);
  uint16_t t_ex = nodes[c].getResponseBuffer(0x000E);

  uint16_t pr   = nodes[c].getResponseBuffer(0x0010);
  uint16_t cvcc = nodes[c].getResponseBuffer(0x0011);
  uint16_t onoff= nodes[c].getResponseBuffer(0x0012);

  r.vset  = vset / XY_V_SCALE;
  r.iset  = iset / XY_A_SCALE;
  r.vout  = vout / XY_V_SCALE;
  r.iout  = iout / XY_A_SCALE;
  r.power = pwr  / 10.0f; // 0.1W/LSB pada unit ini (datasheet radix 2 = 0.01W; penulis merevisi ke /10 sesuai pengukuran). Tidak memengaruhi billing.
  r.uin   = uin  / XY_V_SCALE;

  r.wh_mWh= ((uint32_t)wh_h << 16) | wh_l;
  r.out_seconds = (uint32_t)out_h*3600UL + (uint32_t)out_m*60UL + out_s;

  // Temperature: assume 0.1°C scaling
  r.t_in = t_in / 10.0f;
  r.t_ex = t_ex / 10.0f;

  r.protect = pr;
  r.cvcc = cvcc;
  r.onoff = onoff;

  return true;
}

// Baca blok dengan beberapa percobaan cepat untuk menahan glitch transien
// pada bus RS485 (CRC/timeout sesekali) sebelum dihitung sebagai kegagalan.
bool xyReadBlockRetry(uint8_t c, uint8_t attempts) {
  for (uint8_t i = 0; i < attempts; i++) {
    if (xyReadBlock(c)) return true;
  }
  return false;
}

bool writeReg(uint8_t c, uint16_t reg, uint16_t val)
{
  if (c >= 3) return false;
  uint8_t sid = SLAVE_ID[c];
  if (sid == 0) return false;

  nodes[c].begin(sid, SerialModbus);
  uint8_t r = nodes[c].writeSingleRegister(reg, val);
  return (r == nodes[c].ku8MBSuccess);
}


void xyPanelSet(bool awake)
{
  static int8_t last = -1;
  if ((int8_t)awake == last) return;
  last = awake;

  for (uint8_t c = 0; c < 3; c++)
  {
    if (SLAVE_ID[c] == 0) continue;

    if (awake)
    {
      writeReg(c, REG_SLEEP, XY_SLEEP_MINUTES);
      writeReg(c, REG_LOCK, 0);                 // unlock
      writeReg(c, REG_BLED, XY_BLED_WAKE);      // backlight on
    }
    else
    {
      writeReg(c, REG_BLED, XY_BLED_SLEEP);     // backlight off
      writeReg(c, REG_LOCK, 1);                 // lock
      writeReg(c, REG_SLEEP, XY_SLEEP_MINUTES);
    }
    delay(20);
  }
}



// ===========================================================
//                     SESSION / BILLING
// ===========================================================
void resetSession(uint8_t c) {
  ch[c].sessionWhStart_mWh = ch[c].r.wh_mWh;
  ch[c].sessionWhLast_mWh  = ch[c].r.wh_mWh;  // BUGFIX billing: baseline akumulator
  ch[c].sessionWhAccum_mWh = 0;
  ch[c].sessionStartMillis = millis();
}

// BUGFIX billing (revisi W3): akumulasi energi sesi secara INKREMENTAL supaya tahan
// terhadap RESET counter energi modul XY (mis. modul power-cycle saat ESP32 tetap
// hidup). Versi lama me-rebaseline ke nilai sekarang saat now<base sehingga energi
// pra-reset HILANG (under-billing); komentar lama soal "threshold 500Wh" tak pernah
// terimplementasi. Dipanggil sekali per poll (pada pembacaan sukses).
void sessionAccumulate(uint8_t c) {
  uint32_t now  = ch[c].r.wh_mWh;
  uint32_t last = ch[c].sessionWhLast_mWh;
  if (now >= last) ch[c].sessionWhAccum_mWh += (now - last);
  else             ch[c].sessionWhAccum_mWh += now; // counter modul ter-reset -> energi sejak reset
  ch[c].sessionWhLast_mWh = now;
}

float sessionKWh(uint8_t c) {
  return ch[c].sessionWhAccum_mWh / 1000000.0f;
}

uint32_t sessionSec(uint8_t c) {
  return (millis() - ch[c].sessionStartMillis) / 1000UL;
}

// timer helpers (prototypes)
static inline void tmrStart(uint8_t c);
static inline void tmrStop(uint8_t c);
static inline void tmrReset(uint8_t c);
static inline uint32_t tmrSec(uint8_t c);

// UI mode indicator — definisi di bawah bersama backend
void uiUpdateMode();
static void saveRequireAuth();

// Backend / payment (Phase 2) — definisi lengkap di bawah, gate ENABLE_BACKEND.
// Dideklarasikan di sini supaya bisa dipanggil dari state machine di atasnya.
void backendInit();
void backendPoll();
void backendEmitSession(uint8_t c, const char* event);
void backendEmitFault(uint8_t c, const char* reason);
void backendCheckSessionLimit(uint8_t c);

static inline bool isChargeCompleteProtect(uint16_t pr) {
  return pr == 13;
}

// comm=true bila FAULT dipicu komunikasi Modbus hilang (boleh auto-recover),
// comm=false bila dipicu proteksi modul (butuh CLEAR manual).
void goFault(uint8_t c, bool comm=false) {
  xySetOutput(c, false);
  tmrStop(c);
  ch[c].faultIsComm = comm;
  ch[c].state = FAULT;

  // Phase 3 hardening: catat kejadian FAULT ke NVS (frekuensi rendah, hanya saat
  // transisi masuk FAULT) untuk diagnosa lapangan. Namespace "spklu" sudah terbuka.
  prefs.putUInt("fault_cnt", prefs.getUInt("fault_cnt", 0) + 1);
  prefs.putUShort("last_pr", ch[c].r.protect);
}

// reason: nama event yang dikirim ke backend ("session_stop" default —
// dipakai juga oleh goChargeComplete() & handleCmd STOP dengan reason lain,
// backend membedakan label alasan berhenti dari nama event ini).
void goDone(uint8_t c, const char *reason = "session_stop") {
  xySetOutput(c, false);
  tmrStop(c);
  ch[c].done_kWh = sessionKWh(c);
  ch[c].done_rp  = (uint32_t)lroundf(ch[c].done_kWh * PRICE_PER_KWH);
  ch[c].done_sec = tmrSec(c);
  ch[c].state = DONE;
  // BUGFIX (security/billing): sesi berakhir -> cabut otorisasi (auth sekali pakai).
  // Sebelumnya STOP dari web & goChargeComplete() masuk PAUSED (bukan DONE) tanpa
  // deauthorize, sehingga bila onoff modul balik ON (tombol fisik/auto-resume)
  // channel langsung CHARGING lagi TANPA otorisasi baru — padahal backend sudah
  // menutup & me-refund sesi itu (celah charging gratis pasca-refund).
  ch[c].authorized = false;
  webMotorName[c]  = "";
  ch[c].limitType  = 0;
  backendEmitSession(c, reason);
}

void goChargeComplete(uint8_t c) {
  // Limit (kWh/waktu) tercapai -> sesi berakhir penuh, sama seperti STOP dari
  // web. Sebelumnya masuk PAUSED "Resume Session" tanpa deauthorize (lihat
  // catatan bugfix di goDone()) -> dipersatukan agar tidak ada resume diam-diam.
  goDone(c, "session_complete");
  setChanMsg(c, "Charging Complete", 0x362B, 5000);
  uiMsg("CHARGING COMPLETE", 0x362B);
}

// Dipanggil saat kabel terdeteksi dicabut paksa saat charging.
// Output dimatikan, sesi di-snapshot, tampil notif di HMI.
void goCabutKabel(uint8_t c) {
  xySetOutput(c, false);
  tmrStop(c);

  ch[c].done_kWh = sessionKWh(c);
  ch[c].done_rp  = (uint32_t)lroundf(ch[c].done_kWh * PRICE_PER_KWH);
  ch[c].done_sec = tmrSec(c);

  cabutCount[c]   = 0;
  cabutArmedMs[c] = 0;
  ch[c].state     = DONE;
  // BUGFIX (security/billing): kabel dicabut -> sesi berakhir, cabut otorisasi.
  ch[c].authorized = false;
  webMotorName[c]  = "";
  ch[c].limitType  = 0;

  char buf[64];
  snprintf(buf, sizeof(buf), "Kabel Dicabut | %.3f kWh | Rp %lu",
           ch[c].done_kWh, (unsigned long)ch[c].done_rp);
  setChanMsg(c, buf, 0xFCA0, 8000);
  uiMsg("KABEL DICABUT", 0xFCA0);
  backendEmitSession(c, "cable_unplug");
}

// ===========================================================
//              OCP AUTO-RECOVERY HANDLER (Phase 1)
// ===========================================================
// Dipanggil setiap loop untuk handle OCP retry state machine.
// Logic:
//   1. Jika protect != 2 (OCP), reset ocpState ke NONE
//   2. Jika protect == 2 dan ocpState == NONE, masuk RETRY
//   3. Jika ocpState == RETRY dan waktunya, coba turn ON lagi
//   4. Jika berhasil, kembali ke CHARGING
//   5. Jika gagal & exceed max retries, masuk FAULT (manual CLEAR)
void handleOCPRetry(uint8_t c) {
  if (!chEnabled(c)) return;

  // Bukan OCP (protect != 2): reset state machine OCP.
  if (ch[c].r.protect != 2) {
    if (ch[c].ocpState != Channel::OCP_NONE) {
      ch[c].ocpState = Channel::OCP_NONE;
      ch[c].ocpRetryCount = 0;
      ch[c].ocpLastProtectCode = 0;
    }
    return;
  }

  // ---- protect == 2 (OCP terdeteksi) ----

  // SAFETY: hanya auto-recover bila memang sedang sesi charging.
  // OCP di luar charging -> jangan energize output; minta CLEAR manual.
  if (ch[c].state != CHARGING && ch[c].ocpState == Channel::OCP_NONE) {
    ch[c].ocpState = Channel::OCP_FAULT;   // diteruskan ke FAULT oleh updateChannelState
    return;
  }

  // Pertama kali deteksi OCP saat charging -> mulai retry.
  if (ch[c].ocpState == Channel::OCP_NONE) {
    ch[c].ocpState        = Channel::OCP_RETRY;
    ch[c].ocpRetryCount   = 0;
    ch[c].ocpRetryUntilMs = millis() + OCP_RETRY_INTERVAL_MS;
    setChanMsg(c, "OCP terdeteksi, auto-retry...", 0xFCA0, 2500);
    return;
  }

  // Sudah menyerah -> tunggu CLEAR manual (output dijaga OFF oleh goFault()).
  if (ch[c].ocpState == Channel::OCP_FAULT) return;

  // ocpState == OCP_RETRY: tunggu jadwal, lalu coba ON lagi.
  if (ch[c].ocpState == Channel::OCP_RETRY) {
    // BUGFIX (interlock keselamatan): JANGAN re-energize bila channel sudah TIDAK
    // charging. STOP / e-stop / comm-fault mematikan output tanpa mereset ocpState,
    // sehingga tanpa guard ini retry akan menyalakan ulang output ~2.5s setelah
    // user berhenti. Bila bukan CHARGING -> batalkan retry & reset state OCP.
    if (ch[c].state != CHARGING) {
      ch[c].ocpState = Channel::OCP_NONE;
      ch[c].ocpRetryCount = 0;
      ch[c].ocpLastProtectCode = 0;
      return;
    }
    if ((int32_t)(millis() - ch[c].ocpRetryUntilMs) < 0) return; // belum waktunya

    ch[c].ocpRetryCount++;
    bool sent = xySetOutput(c, true);                 // coba energize ulang
    ch[c].ocpRetryUntilMs = millis() + OCP_RETRY_INTERVAL_MS;

    if (ch[c].ocpRetryCount >= OCP_MAX_RETRIES) {
      // Jatah retry habis -> FAULT, tunggu CLEAR manual.
      ch[c].ocpState = Channel::OCP_FAULT;
      goFault(c, false);                              // output OFF + state FAULT
      setChanMsg(c, "OCP - retry habis. Tekan CLEAR.", 0xF9C6, 5000);
      uiMsg("OCP FAULT - PRESS CLEAR", 0xF9C6);
      backendEmitFault(c, "ocp_fault");
      return;
    }

    char buf[48];
    snprintf(buf, sizeof(buf), "OCP retry %u/%u%s",
             (unsigned)ch[c].ocpRetryCount, (unsigned)OCP_MAX_RETRIES,
             sent ? "" : " (tx err)");
    setChanMsg(c, String(buf), 0xAD97, 1500);
  }
}

// Phase 3 hardening: alarm suhu dini (soft over-temp). TIDAK menggantikan OTP
// hardware XY-12550S — hanya peringatan/stop lebih awal. Dipanggil dari loop poll.
void checkOverTemp(uint8_t c) {
  if (!OTP_SOFT_ENABLE || !chEnabled(c)) return;
  // Hanya sensor internal (t_in) — probe eksternal (t_ex) tidak dipasang di
  // instalasi ini, nilainya mengambang/tidak valid dan akan memicu alarm palsu.
  float tmax = ch[c].r.t_in;
  if (tmax < OTP_WARN_C) return;

  // Peringatan (rate-limited, tahan millis() overflow via selisih signed).
  if ((int32_t)(millis() - otWarnMs[c]) >= 0) {
    otWarnMs[c] = millis() + OTP_WARN_INTERVAL_MS;
    char buf[40];
    snprintf(buf, sizeof(buf), "SUHU TINGGI %.0fC", tmax);
    setChanMsg(c, buf, 0xFCA0, 4000);
    backendEmitFault(c, "overtemp_warn");
  }

  // Soft-stop opsional: hentikan lebih awal sebelum OTP hardware memutus.
  if (OTP_SOFT_STOP && tmax >= OTP_STOP_C && ch[c].state == CHARGING) {
    xySetOutput(c, false);
    tmrStop(c);
    ch[c].done_kWh = sessionKWh(c);
    ch[c].done_rp  = (uint32_t)lroundf(ch[c].done_kWh * PRICE_PER_KWH);
    ch[c].done_sec = tmrSec(c);
    // konsisten dengan transisi DONE lain: reset cabut/OCP & cabut otorisasi.
    cabutCount[c]   = 0;
    cabutArmedMs[c] = 0;
    ch[c].ocpState  = Channel::OCP_NONE;
    ch[c].ocpRetryCount = 0;
    ch[c].authorized = false;
    webMotorName[c]  = "";
    ch[c].limitType  = 0;
    ch[c].state = DONE;
    setChanMsg(c, "STOP: suhu terlalu tinggi", 0xF9C6, 6000);
    backendEmitSession(c, "overtemp_stop");
  }
}

void updateChannelState(uint8_t c) {
  if (!chEnabled(c)) return;

  // Comm fault (Modbus hilang) -> FAULT yang boleh auto-recover saat pulih.
  if (ch[c].modbusFailCount >= MODBUS_FAIL_LIMIT) {
    if (ch[c].state != FAULT) goFault(c, true);
    return;
  }

  uint16_t pr = ch[c].r.protect;

  // OCP (protect==2): JANGAN langsung FAULT. Serahkan ke handleOCPRetry().
  // Baru jadi FAULT bila retry sudah menyerah (ocpState==OCP_FAULT).
  if (pr == 2) {
    if (ch[c].ocpState == Channel::OCP_FAULT && ch[c].state != FAULT) {
      goFault(c, false);
    }
    return; // selama retry, biarkan handleOCPRetry yang mengatur output
  }

  if (pr != 0) {
    if (isChargeCompleteProtect(pr)) {            // pr==13: charging complete
      if (ch[c].state == CHARGING) goChargeComplete(c);
      return;
    } else {                                      // proteksi lain -> FAULT (CLEAR manual)
      goFault(c, false);
      return;
    }
  }

  // ---------------------- pr == 0 (normal) ----------------------

  if (ch[c].state == CHARGING && ch[c].r.onoff == 0) {
    goDone(c);
    return;
  }

  if ((ch[c].state == IDLE || ch[c].state == SELECT || ch[c].state == DONE || ch[c].state == PAUSED) &&
      ch[c].r.onoff == 1) {
    ch[c].state = CHARGING;
  }

  // Auto-recovery comm-fault: jika sebelumnya FAULT karena komunikasi dan
  // sekarang Modbus sehat lagi tanpa proteksi, kembalikan agar bisa dipakai.
  if (ch[c].state == FAULT && ch[c].faultIsComm) {
    ch[c].faultIsComm = false;
    if (ch[c].r.onoff == 1) {
      // Modul ternyata masih charging (perintah OFF saat comm putus tak sampai).
      ch[c].state = CHARGING;
      tmrStart(c);                                   // lanjutkan timer durasi
      cabutCount[c]   = 0;
      cabutArmedMs[c] = millis() + CABUT_ARM_DELAY_MS;
    } else {
      ch[c].state = IDLE;
    }
    setChanMsg(c, "Komunikasi pulih", 0x362B, 2500);
    backendEmitSession(c, "comm_recovered");
  }

  // -------------------------------------------------------
  //  Deteksi kabel dicabut paksa
  //  Hanya aktif setelah CABUT_ARM_DELAY_MS dari START.
  //  Cek: millis() sudah melewati cabutArmedMs[c]
  //  (selisih < 0x80000000 = sudah lewat, >= = belum lewat)
  // -------------------------------------------------------
  if (ch[c].state == CHARGING && ch[c].r.onoff == 1) {
    bool masihGracePeriod = (cabutArmedMs[c] == 0) ||
                            ((millis() - cabutArmedMs[c]) >= 0x80000000UL);
    if (masihGracePeriod) {
      cabutCount[c] = 0;
    } else {
      bool bebanHilang = (ch[c].r.iout < CABUT_IOUT_THRESHOLD_A)
                      && (ch[c].r.iset >= CABUT_ISET_MIN_A);
      if (bebanHilang) {
        cabutCount[c]++;
        if (cabutCount[c] >= CABUT_CONFIRM_SAMPLES) {
          goCabutKabel(c);
        }
      } else {
        cabutCount[c] = 0;
      }
    }

    // Batas sesi berbayar (Phase 2): auto-STOP saat kWh/Rp/durasi tercapai.
    backendCheckSessionLimit(c);
  } else {
    cabutCount[c] = 0;
  }
}


// ===================  Helper Timer  ==========================

static inline void tmrStart(uint8_t c){
  if (!runRunning[c]) { runRunning[c] = true; runStartMs[c] = millis(); }
}
static inline void tmrStop(uint8_t c){
  if (runRunning[c]) {
    runMsAccum[c] += (millis() - runStartMs[c]);
    runRunning[c] = false;
  }
}
static inline void tmrReset(uint8_t c){
  runMsAccum[c] = 0;
  runRunning[c] = false;
  runStartMs[c] = millis();
}
static inline uint32_t tmrSec(uint8_t c){
  uint32_t ms = runMsAccum[c] + (runRunning[c] ? (millis() - runStartMs[c]) : 0);
  return ms / 1000UL;
}


// ===========================================================
//                      UI UPDATE (MINIMAL)
// ===========================================================
String fmt1(float v){ char b[24]; snprintf(b,sizeof(b),"%.1f",v); return String(b); }
String fmt2(float v){ char b[24]; snprintf(b,sizeof(b),"%.2f",v); return String(b); }

String prShort(uint16_t pr) {
  switch(pr){
    case 0:  return "OK";
    case 1:  return "OVP";
    case 2:  return "OCP";
    case 3:  return "OPP";
    case 4:  return "LVP";
    case 5:  return "OAH";
    case 6:  return "OHP";
    case 7:  return "OTP";
    case 8:  return "OEP";
    case 9:  return "OWH";
    case 10: return "ICP";
    case 11: return "ETP";
    case 13: return "CHG DONE";
    default: return "PR=" + String(pr);
  }
}

uint16_t stColor(uint8_t c) {
  if (!chEnabled(c)) return 0x7BEF; // gray
  if (ch[c].modbusFailCount >= MODBUS_FAIL_LIMIT) return 0xF9C6; // red-ish
  if (ch[c].r.protect == 0 || isChargeCompleteProtect(ch[c].r.protect)) return 0x362B; // green
  return 0xFCA0; // orange
}

void uiHighlightMotor(uint8_t motorIdx) {
  for (int i = 0; i < 10; i++) {
    nxSendCmd("b_m" + String(i) + ".bco="  + String(MOTOR_INACTIVE_BCO));
    nxSendCmd("b_m" + String(i) + ".pco="  + String(MOTOR_INACTIVE_PCO));
    nxSendCmd("b_m" + String(i) + ".bco2=" + String(MOTOR_INACTIVE_BCO));
  }

  nxSendCmd("b_m" + String(motorIdx) + ".bco="  + String(MOTOR_ACTIVE_BCO));
  nxSendCmd("b_m" + String(motorIdx) + ".pco="  + String(MOTOR_ACTIVE_PCO));
  nxSendCmd("b_m" + String(motorIdx) + ".bco2=" + String(MOTOR_ACTIVE_BCO));
}

void uiSetMotorLabels(uint8_t c) {
  for(int i=0;i<10;i++){
    // Slot yang sedang aktif pakai nama dari web (webMotorName) kalau ada;
    // 9 slot lain (bukan pilihan aktif) selalu pakai label asli firmware.
    // Override TIDAK berlaku saat halaman Settings teknisi sedang terbuka
    // (ch[c].settingOpen) — teknisi butuh lihat label asli NVS untuk
    // identifikasi profil yang sedang di-adjust, bukan nama sementara web.
    String label = (i == ch[c].motorIdx && !ch[c].settingOpen && webMotorName[c].length())
      ? webMotorName[c] : profiles[c][i].label;
    nxSendCmd("b_m"+String(i)+".txt=\""+label+"\"");
    delay(1);
  }
}

void uiSetChannelDisabledCard(uint8_t idx) {
  // idx: 0..2, components: t1_, t2_, t3_
  // W2 FIX: snprintf menggantikan String concat
  char buf[32];
  const char* p = (idx==0) ? "t1_" : (idx==1) ? "t2_" : "t3_";
  snprintf(buf, sizeof(buf), "%smot.txt=\"-\"",      p); nxSendCmd(buf);
  snprintf(buf, sizeof(buf), "%sst.txt=\"DISABLED\"", p); nxSendCmd(buf);
  snprintf(buf, sizeof(buf), "%sst.pco=0x7BEF",       p); nxSendCmd(buf);
  snprintf(buf, sizeof(buf), "%sv.txt=\"-\"",          p); nxSendCmd(buf);
  snprintf(buf, sizeof(buf), "%si.txt=\"-\"",          p); nxSendCmd(buf);
  snprintf(buf, sizeof(buf), "%sp.txt=\"-\"",          p); nxSendCmd(buf);
  snprintf(buf, sizeof(buf), "%sset.txt=\"-\"",        p); nxSendCmd(buf);
  snprintf(buf, sizeof(buf), "%skwh.txt=\"-\"",        p); nxSendCmd(buf);
  snprintf(buf, sizeof(buf), "%srp.txt=\"-\"",         p); nxSendCmd(buf);
  snprintf(buf, sizeof(buf), "%stm.txt=\"-\"",         p); nxSendCmd(buf);
}

void uiUpdateMonitor() {
  // W2 FIX: gunakan char buf + snprintf untuk menghindari fragmentasi heap
  // dari puluhan String sementara setiap 250ms
  char buf[80];

  for(int c=0;c<3;c++){
    if(!chEnabled(c)) { uiSetChannelDisabledCard(c); continue; }

    float kwh = sessionKWh(c);
    uint32_t rp = (uint32_t)lroundf(kwh * PRICE_PER_KWH);
    uint32_t sec = tmrSec(c);
    char tb[16]; snprintf(tb,sizeof(tb),"%02lu:%02lu:%02lu",sec/3600,(sec%3600)/60,sec%60);

    const char* pref_s = (c==0) ? "t1_" : (c==1) ? "t2_" : "t3_";

    snprintf(buf, sizeof(buf), "%s%s", pref_s, "mot.txt=\"");
    String motLabel = webMotorName[c].length()
      ? webMotorName[c] : profiles[c][ch[c].motorIdx].label;
    String mcmd = String(buf) + motLabel + "\"";
    nxSendCmd(mcmd);

    String st;
    if (isChargeCompleteProtect(ch[c].r.protect)) {
      st = "OFF | Charging Complete";
    } else {
      st = (ch[c].r.onoff ? "ON" : "OFF");
      st += (ch[c].r.cvcc == 0 ? " | CV | " : " | CC | ");
      st += prShort(ch[c].r.protect);
    }

    snprintf(buf, sizeof(buf), "%sst.txt=\"", pref_s);
    nxSendCmd(String(buf) + st + "\"");
    snprintf(buf, sizeof(buf), "%sst.pco=%u", pref_s, stColor(c));
    nxSendCmd(buf);

    char vb[12], ib[12], pb[12], vsetb[12], isetb[12];
    snprintf(vb,    sizeof(vb),    "%.2fV",  ch[c].r.vout);
    snprintf(ib,    sizeof(ib),    "%.2fA",  ch[c].r.iout);
    snprintf(pb,    sizeof(pb),    "%.2fW",  ch[c].r.power);
    snprintf(vsetb, sizeof(vsetb), "%.2fV",  ch[c].r.vset);
    snprintf(isetb, sizeof(isetb), "%.2fA",  ch[c].r.iset);

    snprintf(buf, sizeof(buf), "%sv.txt=\"%s\"",   pref_s, vb);    nxSendCmd(buf);
    snprintf(buf, sizeof(buf), "%si.txt=\"%s\"",   pref_s, ib);    nxSendCmd(buf);
    snprintf(buf, sizeof(buf), "%sp.txt=\"%s\"",   pref_s, pb);    nxSendCmd(buf);
    snprintf(buf, sizeof(buf), "%sset.txt=\"SET %s / %s\"", pref_s, vsetb, isetb); nxSendCmd(buf);

    snprintf(buf, sizeof(buf), "%skwh.txt=\"%.3f kWh\"", pref_s, kwh); nxSendCmd(buf);
    snprintf(buf, sizeof(buf), "%srp.txt=\"Rp %lu\"",    pref_s, (unsigned long)rp); nxSendCmd(buf);
    snprintf(buf, sizeof(buf), "%stm.txt=\"%s\"",        pref_s, tb); nxSendCmd(buf);
  }
}

void uiUpdateChannel(uint8_t c) {
  // W2 FIX: semua UI update pakai char buf + snprintf, bukan String concatenation
  char buf[96];

  if (!chEnabled(c)) {
    snprintf(buf, sizeof(buf), "CH%u DISABLED", (unsigned)(c+1));
    uiMsg(buf, 0xFCA0);
    nxSendCmd("page page_welcome");
    return;
  }

  float kwh = sessionKWh(c);
  uint32_t rp = (uint32_t)lroundf(kwh * PRICE_PER_KWH);
  uint32_t sec = tmrSec(c);
  char tb[16]; snprintf(tb,sizeof(tb),"%02lu:%02lu:%02lu",sec/3600,(sec%3600)/60,sec%60);

  snprintf(buf, sizeof(buf), "t_ch.txt=\"CH%u\"", (unsigned)(c+1)); nxSendCmd(buf);
  nxSendCmd("t_mot.txt=\"" + profiles[c][ch[c].motorIdx].label + "\"");

  String st;
  if (isChargeCompleteProtect(ch[c].r.protect)) {
    st = "OFF | Charging Complete";
  } else {
    st = (ch[c].r.onoff ? "ON" : "OFF");
    st += (ch[c].r.cvcc == 0 ? " | CV | " : " | CC | ");
    st += prShort(ch[c].r.protect);
  }
  nxSendCmd("t_st.txt=\"" + st + "\"");
  snprintf(buf, sizeof(buf), "t_st.pco=%u", stColor(c)); nxSendCmd(buf);

  snprintf(buf, sizeof(buf), "t_v.txt=\"%.2fV\"",  ch[c].r.vout);  nxSendCmd(buf);
  snprintf(buf, sizeof(buf), "t_i.txt=\"%.2fA\"",  ch[c].r.iout);  nxSendCmd(buf);
  snprintf(buf, sizeof(buf), "t_p.txt=\"%.2fW\"",  ch[c].r.power); nxSendCmd(buf);
  snprintf(buf, sizeof(buf), "t_set.txt=\"SET %.2fV / %.2fA\"", ch[c].r.vset, ch[c].r.iset); nxSendCmd(buf);
  snprintf(buf, sizeof(buf), "t_uin.txt=\"UIN %.2fV\"", ch[c].r.uin); nxSendCmd(buf);
  snprintf(buf, sizeof(buf), "t_tmp.txt=\"TIN %.1fC TEX %.1fC\"", ch[c].r.t_in, ch[c].r.t_ex); nxSendCmd(buf);
  nxSendCmd("t_pr.txt=\"PROTECT " + String(ch[c].r.protect) + " (" + prShort(ch[c].r.protect) + ")\"");

  snprintf(buf, sizeof(buf), "t_pay.txt=\"Rp %lu\"",   (unsigned long)rp); nxSendCmd(buf);
  snprintf(buf, sizeof(buf), "t_kwh.txt=\"%.3f kWh\"", kwh);               nxSendCmd(buf);
  snprintf(buf, sizeof(buf), "t_tm.txt=\"%s\"",        tb);                nxSendCmd(buf);

  // optional summary line / transient messages
  // B2 FIX: gunakan chanMsgExpired() yang tahan millis() overflow
  if (!chanMsgExpired(c) && chanMsgText[c].length()) {
    nxSendCmd("g_sum.txt=\"" + chanMsgText[c] + "\"");
    nxSendCmd("g_sum.pco=" + String(chanMsgColor[c]));
  } else if (ch[c].state == DONE || ch[c].state == PAUSED) {
    uint32_t s = ch[c].done_sec;
    char dtb[16];
    snprintf(dtb,sizeof(dtb),"%02lu:%02lu:%02lu", s/3600, (s%3600)/60, s%60);

    String sumText;
    if (ch[c].state == PAUSED) {
      if (isChargeCompleteProtect(ch[c].r.protect)) {
        sumText = "Charging Complete | Last Session | " + String(ch[c].done_kWh,3) +
                  " kWh | Rp " + String(ch[c].done_rp) +
                  " | " + String(dtb);
      } else {
        sumText = "Paused | Last Session | " + String(ch[c].done_kWh,3) +
                  " kWh | Rp " + String(ch[c].done_rp) +
                  " | " + String(dtb);
      }
    } else {
      sumText = "Done: " + String(ch[c].done_kWh,3) +
                " kWh | Rp " + String(ch[c].done_rp) +
                " | " + String(dtb);
    }

    nxSendCmd("g_sum.txt=\"" + sumText + "\"");
    nxSendCmd("g_sum.pco=0x362B");
  }


}


// ===========================================================
//                  SETTINGS PAGE UI HELPERS
//  Expected components on each setting_CHn page (recommended):
//   - t_sch (optional): header text
//   - t_motor: motor label (e.g. "M3 Vario")
//   - t_vset, t_iset, t_lvp, t_ocp, t_otp: value texts
//   - t_msg: status text (shared with uiMsg())
//   - optional motor buttons b_m0..b_m9 for direct selection
// ===========================================================
void goToChannelPage(uint8_t c){
  // expects page names: p1_ch1 / p2_ch2 / p3_ch3
  nxSendCmd("page p"+String(c+1)+"_ch"+String(c+1));
}

void uiUpdateSetting(uint8_t c){
  if (!chEnabled(c)) return;

  uint8_t m = ch[c].editMotorIdx;
  const auto &p = ch[c].editProfile;

  nxSendCmd("t_sch.txt=\"SETTING CH"+String(c+1)+"\""); // optional
  nxSendCmd("t_motor.txt=\"M"+String(m)+" "+profiles[c][m].label+"\"");
  nxSendCmd("t_vset.txt=\""+fmt2(p.vset_V)+" V\"");
  nxSendCmd("t_iset.txt=\""+fmt2(p.iset_A)+" A\"");
  nxSendCmd("t_lvp.txt=\""+fmt2(p.lvp_V)+" V\"");
  nxSendCmd("t_ocp.txt=\""+fmt2(p.ocp_A)+" A\"");
  nxSendCmd("t_otp.txt=\""+String(p.otp_C)+" C\"");
}

void uiEnterPage(uint8_t page) {
  uiUpdateMode(); // selalu refresh indikator mode di header HMI
  if (page == 0) {
    uiUpdateMonitor();
  } else if (page >= 1 && page <= 3) {
    uint8_t c = page - 1;
    if (!chEnabled(c)) {
      uiMsg("CH"+String(c+1)+" DISABLED", 0xFCA0);
      nxSendCmd("page p0_mon");
      return;
    }
    uiSetMotorLabels(c);
    uiHighlightMotor(ch[c].motorIdx);
    uiUpdateChannel(c);
  }
}

// ===========================================================
//                      COMMAND UTIL
// ===========================================================
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

static inline bool parseChannel(const String& s, int startIdx, uint8_t &outC) {
  int chNum = s.substring(startIdx).toInt();
  if (chNum < 1 || chNum > 3) return false;
  outC = (uint8_t)(chNum - 1);
  return true;
}

static inline bool ensureChannelEnabled(uint8_t c) {
  if (!chEnabled(c)) {
    uiMsg("CHANNEL DISABLED", 0xFCA0);
    return false;
  }
  return true;
}

// ===========================================================
//                      COMMAND HANDLER
// ===========================================================
void handleCmd(const String &cmd) {
  if (cmd == "SLEEP") {
  xyPanelSet(false);
  return;
}
if (cmd == "WAKE") {
  xyPanelSet(true);
  return;
}

if (!cmd.length()) return;

if (cmd == "SETONLINE") {
  requireAuth = true;
  saveRequireAuth();
  uiUpdateMode();
  uiMsg("MODE: PAYMENT (ONLINE)", 0x362B);
  return;
}
if (cmd == "SETOFFLINE") {
  requireAuth = false;
  saveRequireAuth();
  uiUpdateMode();
  uiMsg("MODE: FREE (OFFLINE)", 0xAD97);
  return;
}

if (cmd == "PANELALL") {
  uiMsg("Starting...", 0xAD97);

  bool any = false;
  bool allOk = true;

  for (uint8_t c = 0; c < 3; c++) {
    if (!chEnabled(c)) continue;
    any = true;

    // enable stage/panel logic (fungsi yang kemarin kamu pakai dan sudah terbukti bisa)
    bool ok = xyEnableStage(c);

    // safety extra: pastikan output OFF
    xySetOutput(c, false);

    if (!ok) allOk = false;
    delay(30);
  }

  if (!any) {
    uiMsg("NO CHANNEL ENABLED", 0xFCA0);
    nxSendCmd("page p0_mon");
    return;
  }

  if (allOk) uiMsg("PANEL READY", 0x362B);
  else       uiMsg("PANEL READY (PARTIAL)", 0xFCA0);

  // pindah ke monitoring
  delay (30);
  nxSendCmd("page p0_mon");
  return;
}


  // SETOPEN,<ch>
  if (cmd.startsWith("SETOPEN,")) {
    uint8_t c;
    if (!parseChannel(cmd, 8, c)) return;
    if (!ensureChannelEnabled(c)) return;

    // NOTE: We no longer auto-bounce back to channel page.
// If CHARGING/FAULT, we still show current saved values, but editing/saving is blocked.
bool locked = false;
if (ch[c].state == CHARGING) { locked = true; }
if (ch[c].state == FAULT)    { locked = true; }

ch[c].settingOpen = true;
    ch[c].editMotorIdx = ch[c].motorIdx;
    ch[c].editProfile = profiles[c][ch[c].editMotorIdx];
    ch[c].editDirty = false;

    uiSetMotorLabels(c);
    uiHighlightMotor(ch[c].editMotorIdx);
    uiUpdateSetting(c);
    if (locked) {
      if (ch[c].state == CHARGING) uiMsg("STOP dulu (output ON)", 0xFCA0);
      else uiMsg("FAULT - CLEAR dulu", 0xFCA0);
    } else {
      uiMsg("READY", 0xAD97);
    }
    return;
  }

  // SETM,<ch>,<m>
  if (cmd.startsWith("SETM,")) {
    int p1 = cmd.indexOf(',', 5);
    if (p1 < 0) return;
    int chNum = cmd.substring(5, p1).toInt();
    int mIdx  = cmd.substring(p1+1).toInt();
    if (chNum < 1 || chNum > 3 || mIdx < 0 || mIdx > 9) return;

    uint8_t c = (uint8_t)(chNum - 1);
    if (!ensureChannelEnabled(c)) return;

    if (ch[c].state == CHARGING) { uiMsg("STOP dulu (output ON)", 0xFCA0); return; }
    if (ch[c].state == FAULT)    { uiMsg("CLEAR FAULT dulu", 0xFCA0); return; }

    ch[c].settingOpen = true;
    ch[c].editMotorIdx = (uint8_t)mIdx;
    ch[c].editProfile = profiles[c][ch[c].editMotorIdx];
    ch[c].editDirty = false;

    uiHighlightMotor(ch[c].editMotorIdx);
    uiUpdateSetting(c);
    return;
  }

  // ADJ,<ch>,FIELD,delta
  // delta is integer in device-units:
  // - VSET/LVP: centi-volt (0.01V) -> delta=10 means +0.10V
  // - ISET/OCP: centi-amp  (0.01A) -> delta=10 means +0.10A
  // - OTP: degC integer
  if (cmd.startsWith("ADJ,")) {
    int pA = cmd.indexOf(',', 4);
    int pB = (pA>=0) ? cmd.indexOf(',', pA+1) : -1;
    if (pA<0 || pB<0) return;

    int chNum = cmd.substring(4, pA).toInt();
    String field = cmd.substring(pA+1, pB);
    int delta = cmd.substring(pB+1).toInt();
    if (chNum < 1 || chNum > 3) return;
    uint8_t c = (uint8_t)(chNum - 1);

    if (!ensureChannelEnabled(c)) return;
    if (!ch[c].settingOpen) { uiMsg("OPEN setting dulu", 0xFCA0); return; }
    if (ch[c].state == CHARGING) { uiMsg("STOP dulu utk edit", 0xFCA0); return; }
    if (ch[c].state == FAULT)    { uiMsg("CLEAR FAULT dulu", 0xFCA0); return; }

    auto &p = ch[c].editProfile;

    if (field == "VSET")      p.vset_V = constrain(p.vset_V + delta/100.0f, 1.0f, 125.0f);
    else if (field == "ISET") p.iset_A = constrain(p.iset_A + delta/100.0f, 0.0f, 50.0f);
    else if (field == "OCP")  p.ocp_A  = constrain(p.ocp_A  + delta/100.0f, 0.1f, 52.0f);
    else if (field == "OTP")  p.otp_C  = constrain(p.otp_C  + delta, 60, 120);
    else if (field == "LVP")  p.lvp_V  = constrain(p.lvp_V  + delta/100.0f, 10.0f, 145.0f);

    // Safety: keep OCP >= ISET
    if (p.ocp_A < p.iset_A) p.ocp_A = p.iset_A;

    ch[c].editDirty = true;
    uiUpdateSetting(c);
    uiMsg("EDIT", 0xAD97);
    return;
  }

  // SETSAVE,<ch>
  if (cmd.startsWith("SETSAVE,")) {
    uint8_t c;
    if (!parseChannel(cmd, 8, c)) return;
    if (!ensureChannelEnabled(c)) return;

    if (!ch[c].settingOpen) { uiMsg("OPEN setting dulu", 0xFCA0); return; }
    if (ch[c].state == CHARGING) { uiMsg("STOP dulu sebelum save", 0xFCA0); return; }
    if (ch[c].state == FAULT)    { uiMsg("CLEAR FAULT dulu", 0xFCA0); return; }

    uint8_t m = ch[c].editMotorIdx;

    // Preserve label from stored profile
    MotorProfile p = ch[c].editProfile;
    p.label = profiles[c][m].label;

    // Safety: keep OCP >= ISET
    if (p.ocp_A < p.iset_A) p.ocp_A = p.iset_A;

    uiMsg("SAVING...", 0xAD97);

    // Pastikan stage enable/unlock dulu
    xyEnableStage(c);

    // safety: output OFF during write/verify (SW-CLF)
    xySetOutput(c, false);
    delay(SW_CLF_DELAY_MS);

    // Simpan ke NVS dulu supaya tetap persist walau write/verify modul gagal
    profiles[c][m] = p;
    saveProfileToNVS(c, m);

    bool okW = xyWriteGroup15(c, m, p);
    bool okV = okW ? xyVerifyGroup(c, m, p) : false;

    if (okW && okV) {
      // If editing current selected motor, re-apply dataset (forces OFF first)
      if (ch[c].motorIdx == m) {
        xySelectDataSet(c, m);
        xyReadBlock(c);
      }

      ch[c].settingOpen = false;
      ch[c].editDirty = false;

      uiMsg("SAVED", 0x362B);
      goToChannelPage(c);
      return;
    } else {
      ch[c].settingOpen = false;
      ch[c].editDirty = false;

      uiMsg("SAVED (LOCAL)", 0xFCA0);
      goToChannelPage(c);
      return;
    }
  }

  // SETBACK,<ch>
  if (cmd.startsWith("SETBACK,")) {
    uint8_t c;
    if (!parseChannel(cmd, 8, c)) return;
    if (!ensureChannelEnabled(c)) return;

    ch[c].settingOpen = false;
    ch[c].editDirty = false;
    uiMsg("CANCEL", 0xAD97);
    goToChannelPage(c);
    return;
  }

  // CLEAR,<ch>
  if (cmd.startsWith("CLEAR,")) {
  uint8_t c;
  if (!parseChannel(cmd, 6, c)) return;
  if (!ensureChannelEnabled(c)) return;

  // Paksa output OFF (aman)
  xySetOutput(c, false);

  // Ambil data terbaru (cukup sekali)
  if (!xyReadBlock(c)) {
    if (ch[c].modbusFailCount < 255) ch[c].modbusFailCount++;
    uiMsg("CLEAR: READ FAIL", 0xFCA0);
    return;
  }
  ch[c].modbusFailCount = 0;

  // Kalau masih proteksi, jangan reset timer/session
  if (ch[c].r.protect != 0 && !isChargeCompleteProtect(ch[c].r.protect)) {
    ch[c].state = FAULT;
    uiMsg("CANNOT CLEAR: " + prShort(ch[c].r.protect), 0xFCA0);
    return;
  }

  // Benar-benar clear -> reset timer + session base
  tmrReset(c);
  sessArmed[c]    = false;
  cabutCount[c]   = 0;
  cabutArmedMs[c] = 0;

  // ===== Phase 1: Reset OCP retry state =====
  ch[c].ocpState = Channel::OCP_NONE;
  ch[c].ocpRetryCount = 0;
  ch[c].ocpLastProtectCode = 0;
  ch[c].faultIsComm = false;

  // ===== Phase 2: Wipe sesi berbayar (siap untuk $AUTH berikutnya) =====
  ch[c].authorized   = false;
  webMotorName[c]    = "";
  ch[c].sessionId[0] = '\0';
  ch[c].limitType    = 0;
  ch[c].limitKwh     = 0.0f;
  ch[c].limitRp      = 0;
  ch[c].limitSec     = 0;
  ch[c].limitReached = false;

ch[c].done_kWh = 0;
ch[c].done_rp  = 0;
ch[c].done_sec = 0;

  resetSession(c);     // pakai WH yang baru dibaca di atas
  ch[c].state = IDLE;

  uiMsg("CLEARED", 0x362B);
  backendEmitSession(c, "cleared");
  return;
  } // akhir if CLEAR


  // SEL,<ch>,<m>
  // B1 FIX: blok ini sebelumnya berada di LUAR handleCmd() karena brace
  // penutup CLEAR salah menutup seluruh fungsi. Sekarang sudah benar.
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
      if (activePage == (uint8_t)(c+1)) {
        uiHighlightMotor(ch[c].motorIdx);
        // Seleksi dari backend ($SELECT): jangan repaint label di sini —
        // webMotorName[c] masih nilai LAMA (di-set final setelah handleCmd()
        // return ke backendHandleLine()), yang akan repaint lagi dengan nama
        // final. Repaint di sini hanya akan flicker dgn label basi + overhead
        // serial ganda. Seleksi lokal tetap repaint langsung seperti semula.
        if (!selectFromBackend) uiSetMotorLabels(c);
      }
      uiMsg("PROFILE SELECTED", 0xAD97);
    } else {
      uiMsg("SELECT FAILED", 0xF9C6);
    }
    return;
  }

  // START,<ch>
  if (cmd.startsWith("START,")) {
    uint8_t c;
    if (!parseChannel(cmd, 6, c)) return;
    if (!ensureChannelEnabled(c)) return;

    if (ch[c].state == FAULT) { uiMsg("FAULT - CLEAR dulu", 0xFCA0); return; }

    // Mode ONLINE: START dari HMI ditolak sebelum ada $AUTH dari backend
    if (requireAuth && !ch[c].authorized) {
      uiMsg("Scan QR / bayar dulu!", 0xF9C6);
      return;
    }

    xyReadBlock(c);

    if (!sessArmed[c]) {
      resetSession(c);
      sessArmed[c] = true;
    }

    if (xySetOutput(c, true)) {
      ch[c].state       = CHARGING;
      ch[c].limitReached = false;   // aktifkan kembali pemantauan batas sesi
      tmrStart(c);
      cabutCount[c]   = 0;
      cabutArmedMs[c] = millis() + CABUT_ARM_DELAY_MS; // aktif setelah 5 detik
      if (ch[c].done_sec > 0 || ch[c].done_kWh > 0.0f) uiMsg("RESUMED", 0x362B);
      else uiMsg("CHARGING...", 0x362B);
      backendEmitSession(c, "session_start");
    } else {
      uiMsg("START FAILED", 0xF9C6);
    }
    return;
  }

  // STOP,<ch>
  if (cmd.startsWith("STOP,")) {
    uint8_t c;
    if (!parseChannel(cmd, 5, c)) return;
    if (!ensureChannelEnabled(c)) return;

    // BUGFIX (interlock): reset state OCP retry agar handleOCPRetry tidak
    // menyalakan ulang output setelah STOP (mirror blok CLEAR).
    ch[c].ocpState = Channel::OCP_NONE;
    ch[c].ocpRetryCount = 0;
    ch[c].ocpLastProtectCode = 0;

    // Sesi berhenti dari web = final (bukan PAUSED yang bisa resume tanpa
    // otorisasi baru) -> goDone() sudah set output OFF, snapshot, DONE,
    // authorized=false, dan kirim event ke backend.
    goDone(c, "session_stop");
    uiMsg("CHARGING COMPLETE", 0x362B);
    return;
  }
} // akhir handleCmd()


// ===========================================================
//                  BOOT SYNC (DETERMINISTIC)
//  Push only currently selected profile at boot (safe & fast).
// ===========================================================
bool pushSelectedProfileToModule(uint8_t c) {
  if (!chEnabled(c)) return false;

  uint8_t m = ch[c].motorIdx;
  bool okW = xyWriteGroup15(c, m, profiles[c][m]);
  bool okV = okW ? xyVerifyGroup(c, m, profiles[c][m]) : false;
  if (okW && okV) {
    xySelectDataSet(c, m);
    return true;
  }
  return false;
}

// ===========================================================
//                  PUSHBUTTON EMERGENCY STOP
// ===========================================================

// Identik dengan handleCmd("STOP,<c+1>") tapi tampil sebagai "Charging Complete"
void doStopChannel(uint8_t c) {
  if (!chEnabled(c)) return;
  if (ch[c].state != CHARGING) return;

  xySetOutput(c, false);
  tmrStop(c);

  // BUGFIX (interlock): reset state OCP retry agar tidak re-energize setelah e-stop.
  ch[c].ocpState = Channel::OCP_NONE;
  ch[c].ocpRetryCount = 0;
  ch[c].ocpLastProtectCode = 0;

  ch[c].done_kWh = sessionKWh(c);
  ch[c].done_rp  = (uint32_t)lroundf(ch[c].done_kWh * PRICE_PER_KWH);
  ch[c].done_sec = tmrSec(c);

  ch[c].state = DONE;
  // BUGFIX (security/billing): e-stop mengakhiri sesi -> cabut otorisasi berbayar.
  ch[c].authorized = false;
  webMotorName[c]  = "";
  ch[c].limitType  = 0;
  uiMsg("CHARGING COMPLETE", 0x362B);
  if (getActivePage() == (uint8_t)(c + 1))
    setChanMsg(c, "Charging Complete", 0x362B);
  backendEmitSession(c, "session_stop");
}

// Polling debounce pushbutton, dipanggil setiap loop().
// Deteksi FALLING edge (HIGH->LOW) = tombol ditekan = STOP.
void pollButtons() {
  uint32_t now = millis();
  for (uint8_t c = 0; c < 3; c++) {
    if (BTN_PIN[c] < 0) continue;
    if (!chEnabled(c))  continue;

    bool raw = (bool)digitalRead(BTN_PIN[c]);

    if (raw != btnLastRaw[c]) {
      btnLastRaw[c]      = raw;
      btnLastChangeMs[c] = now;
    }

    if ((now - btnLastChangeMs[c]) < BTN_DEBOUNCE_MS) continue;
    if (raw == btnStable[c]) continue;

    bool prev    = btnStable[c];
    btnStable[c] = raw;

    // FALLING edge: HIGH->LOW = tombol ditekan
    if (prev == HIGH && raw == LOW) {
      doStopChannel(c);
    }
  }
}

// ===========================================================
//        BACKEND / PAYMENT PROTOCOL (Phase 2) — IMPLEMENTASI
//
//  Transport: Serial (UART0/USB). Gateway website payment menulis perintah
//  berprefix '$' (diakhiri '\n'); firmware membalas/emit berprefix '#'.
//
//  PERINTAH MASUK (dari backend):
//    $PING                                  -> #PONG
//    $STATUS                                -> #STATE {json semua channel}
//    $AUTH,<ch>,<sid>,<ltype>,<lval>        -> otorisasi sesi berbayar
//          ltype: 0=none 1=kWh 2=Rupiah 3=detik ; lval sesuai ltype
//    $DEAUTH,<ch>                           -> batalkan otorisasi
//    $SELECT,<ch>,<m>                       -> pilih profil motor (0..9)
//    $START,<ch>                            -> mulai charging
//    $STOP,<ch>                             -> pause/stop
//    $CLEAR,<ch>                            -> clear fault + wipe sesi
//    $SLEEP / $WAKE                         -> panel modul sleep/wake
//
//  EVENT KELUAR (ke backend), satu baris JSON:
//    #EVT {"ev":"session_start"|"session_stop"|"session_complete"|
//          "cable_unplug"|"fault"|"cleared", "ch":n, "sid":"..","kwh":..,
//          "rp":..,"sec":..}
//    #STATE {"t":ms,"ch":[ {channel..}, .. ]}   (telemetri periodik)
// ===========================================================
static String   beLineBuf;
static uint32_t beLastTelemetry = 0;

// Salin string ke buffer hanya untuk karakter aman (alfanumerik, '_', '-'),
// supaya tidak merusak JSON dan tidak overflow. Selalu NUL-terminated.
static void beCopySanitized(char* dst, size_t dstSz, const String& src) {
  size_t j = 0;
  for (int i = 0; i < src.length() && j < dstSz - 1; i++) {
    char ch = src[i];
    bool ok = (ch >= '0' && ch <= '9') || (ch >= 'A' && ch <= 'Z') ||
              (ch >= 'a' && ch <= 'z') || ch == '_' || ch == '-';
    if (ok) dst[j++] = ch;
  }
  dst[j] = '\0';
}

void backendEmitSession(uint8_t c, const char* event) {
  if (!ENABLE_BACKEND || c >= 3) return;
  float kwh = chEnabled(c) ? sessionKWh(c) : 0.0f;
  uint32_t rp = (uint32_t)lroundf(kwh * PRICE_PER_KWH);
  char cb[200];
  snprintf(cb, sizeof(cb),
    "#EVT {\"ev\":\"%s\",\"ch\":%u,\"sid\":\"%s\",\"kwh\":%.3f,\"rp\":%lu,\"sec\":%lu,\"st\":%u}",
    event, (unsigned)(c + 1), ch[c].sessionId, kwh, (unsigned long)rp,
    (unsigned long)tmrSec(c), (unsigned)ch[c].state);
  Serial.println(cb);
}

void backendEmitFault(uint8_t c, const char* reason) {
  if (!ENABLE_BACKEND || c >= 3) return;
  char cb[160];
  snprintf(cb, sizeof(cb),
    "#EVT {\"ev\":\"fault\",\"ch\":%u,\"reason\":\"%s\",\"pr\":%u,\"sid\":\"%s\"}",
    (unsigned)(c + 1), reason, (unsigned)ch[c].r.protect, ch[c].sessionId);
  Serial.println(cb);
}

static void backendPrintChannelJson(uint8_t c) {
  float kwh = chEnabled(c) ? sessionKWh(c) : 0.0f;
  uint32_t rp = (uint32_t)lroundf(kwh * PRICE_PER_KWH);
  char cb[300];
  snprintf(cb, sizeof(cb),
    "{\"ch\":%u,\"en\":%u,\"st\":%u,\"on\":%u,\"pr\":%u,\"m\":%u,"
    "\"v\":%.2f,\"i\":%.2f,\"p\":%.1f,\"vset\":%.2f,\"iset\":%.2f,"
    "\"kwh\":%.3f,\"rp\":%lu,\"sec\":%lu,\"tin\":%.1f,"
    "\"auth\":%u,\"sid\":\"%s\",\"lt\":%u}",
    (unsigned)(c + 1), chEnabled(c) ? 1 : 0, (unsigned)ch[c].state,
    (unsigned)ch[c].r.onoff, (unsigned)ch[c].r.protect, (unsigned)ch[c].motorIdx,
    ch[c].r.vout, ch[c].r.iout, ch[c].r.power, ch[c].r.vset, ch[c].r.iset,
    kwh, (unsigned long)rp, (unsigned long)tmrSec(c), ch[c].r.t_in,
    ch[c].authorized ? 1 : 0, ch[c].sessionId, (unsigned)ch[c].limitType);
  Serial.print(cb);
}

static void backendPrintTelemetry() {
  if (!ENABLE_BACKEND) return;
  Serial.print("#STATE {\"t\":");
  Serial.print(millis());
  Serial.print(",\"ch\":[");
  for (uint8_t c = 0; c < 3; c++) {
    backendPrintChannelJson(c);
    if (c < 2) Serial.print(',');
  }
  Serial.println("]}");
}

// Pantau batas sesi berbayar; auto-STOP saat kWh/Rp/durasi tercapai.
// Dipanggil dari updateChannelState() hanya saat state==CHARGING.
void backendCheckSessionLimit(uint8_t c) {
  if (!ENABLE_BACKEND || c >= 3) return;
  if (ch[c].state != CHARGING) return;
  if (ch[c].limitType == 0 || ch[c].limitReached) return;

  bool reached = false;
  switch (ch[c].limitType) {
    // BUGFIX: guard defensif — limit bernilai 0 TIDAK PERNAH dianggap "tercapai"
    // (cegah auto-stop instan bila $AUTH mengirim limit 0/invalid).
    case 1: reached = (ch[c].limitKwh > 0) && (sessionKWh(c) >= ch[c].limitKwh); break; // kWh
    case 2: reached = (ch[c].limitRp  > 0) &&
                      ((uint32_t)lroundf(sessionKWh(c) * PRICE_PER_KWH) >= ch[c].limitRp); break; // Rupiah
    case 3: reached = (ch[c].limitSec > 0) && (tmrSec(c) >= ch[c].limitSec); break;     // detik
    default: break;
  }
  if (!reached) return;

  // Kuota tercapai -> hentikan output, snapshot, lapor backend.
  ch[c].limitReached = true;
  xySetOutput(c, false);
  tmrStop(c);
  ch[c].done_kWh = sessionKWh(c);
  ch[c].done_rp  = (uint32_t)lroundf(ch[c].done_kWh * PRICE_PER_KWH);
  ch[c].done_sec = tmrSec(c);
  ch[c].state    = DONE;
  // BUGFIX (security/billing): kuota habis -> cabut otorisasi (auth sekali pakai).
  ch[c].authorized = false;
  webMotorName[c]  = "";
  ch[c].limitType  = 0;
  setChanMsg(c, "Kuota tercapai - Sesi selesai", 0x362B, 6000);
  backendEmitSession(c, "session_complete");
}

static void backendHandleLine(const String& ln) {
  if (ln == "$PING")   { Serial.println("#PONG"); return; }
  if (ln == "$STATUS")    { backendPrintTelemetry(); return; }
  if (ln == "$SLEEP")     { handleCmd("SLEEP"); Serial.println("#OK sleep"); return; }
  if (ln == "$WAKE")      { handleCmd("WAKE");  Serial.println("#OK wake");  return; }

  // $SETONLINE / $SETOFFLINE — ubah mode operasi + simpan ke NVS
  if (ln == "$SETONLINE") {
    requireAuth = true;
    saveRequireAuth();
    uiUpdateMode();
    Serial.println("#OK mode=ONLINE");
    return;
  }
  if (ln == "$SETOFFLINE") {
    requireAuth = false;
    saveRequireAuth();
    uiUpdateMode();
    Serial.println("#OK mode=OFFLINE");
    return;
  }
  if (ln == "$GETMODE") {
    Serial.printf("#MODE %s\r\n", requireAuth ? "ONLINE" : "OFFLINE");
    return;
  }

  // $AUTH,<ch>,<sid>,<ltype>,<lval>
  if (ln.startsWith("$AUTH,")) {
    int p1 = ln.indexOf(',', 6);
    int p2 = (p1 >= 0) ? ln.indexOf(',', p1 + 1) : -1;
    int p3 = (p2 >= 0) ? ln.indexOf(',', p2 + 1) : -1;
    if (p1 < 0 || p2 < 0 || p3 < 0) { Serial.println("#ERR auth_format"); return; }

    int chNum  = ln.substring(6, p1).toInt();
    String sid = ln.substring(p1 + 1, p2);
    int ltype  = ln.substring(p2 + 1, p3).toInt();
    float lval = ln.substring(p3 + 1).toFloat();
    if (chNum < 1 || chNum > 3) { Serial.println("#ERR bad_ch"); return; }
    uint8_t c = (uint8_t)(chNum - 1);
    if (!chEnabled(c)) { Serial.println("#ERR ch_disabled"); return; }

    // BUGFIX billing: validasi ltype & lval. Tanpa ini, ltype di luar 1..3 (yang
    // sebelumnya di-constrain) atau lval<=0 menghasilkan limitType!=0 dengan nilai
    // limit 0 -> backendCheckSessionLimit menganggap kuota "tercapai" pada poll
    // pertama dan sesi berbayar langsung selesai 0 kWh.
    if (ltype < 0 || ltype > 3)   { Serial.println("#ERR bad_ltype"); return; }
    if (ltype >= 1 && lval <= 0)  { Serial.println("#ERR bad_limit"); return; }

    beCopySanitized(ch[c].sessionId, sizeof(ch[c].sessionId), sid);
    ch[c].limitType = (uint8_t)ltype;
    ch[c].limitKwh = 0.0f; ch[c].limitRp = 0; ch[c].limitSec = 0;
    if      (ltype == 1) ch[c].limitKwh = lval;
    else if (ltype == 2) ch[c].limitRp  = (uint32_t)lval;
    else if (ltype == 3) ch[c].limitSec = (uint32_t)lval;
    ch[c].authorized   = true;
    ch[c].limitReached = false;

    char cb[80];
    snprintf(cb, sizeof(cb), "#OK auth ch%d sid=%s lt=%d", chNum, ch[c].sessionId, ltype);
    Serial.println(cb);
    return;
  }

  // $DEAUTH,<ch>
  if (ln.startsWith("$DEAUTH,")) {
    uint8_t c;
    if (!parseChannel(ln, 8, c)) { Serial.println("#ERR bad_ch"); return; }
    if (!chEnabled(c)) { Serial.println("#ERR ch_disabled"); return; }
    ch[c].authorized = false;
    webMotorName[c]  = "";
    ch[c].sessionId[0] = '\0';
    ch[c].limitType = 0; ch[c].limitReached = false;
    Serial.println("#OK deauth");
    return;
  }

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
    // Kalau slot yang diedit adalah motor yang SEDANG dipilih, reapply dataset
    // ke register operasi live (bukan cuma baca) — mirror jalur SETSAVE lokal.
    // Tanpa xySelectDataSet, register live tetap nilai lama sampai $SELECT
    // berikutnya, sehingga charging bisa pakai parameter lama walau admin sudah
    // sukses menulis. xySelectDataSet memaksa output OFF dulu (aman: output juga
    // sudah OFF sejak awal blok, dan $SETPARAM ditolak saat CHARGING).
    if (ch[c].motorIdx == (uint8_t)slot) { xySelectDataSet(c, (uint8_t)slot); xyReadBlock(c); }

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

  // $START,<ch>
  if (ln.startsWith("$START,")) {
    uint8_t c;
    if (!parseChannel(ln, 7, c)) { Serial.println("#ERR bad_ch"); return; }
    if (!chEnabled(c)) { Serial.println("#ERR ch_disabled"); return; }
    if (requireAuth && !ch[c].authorized) { Serial.println("#ERR not_authorized"); return; }
    handleCmd("START," + String(c + 1));   // session_start di-emit di dalam handler bila sukses
    Serial.println(ch[c].state == CHARGING ? "#OK start" : "#ERR start_failed");
    return;
  }

  // $STOP,<ch>
  if (ln.startsWith("$STOP,")) {
    uint8_t c;
    if (!parseChannel(ln, 6, c)) { Serial.println("#ERR bad_ch"); return; }
    if (!chEnabled(c)) { Serial.println("#ERR ch_disabled"); return; }
    handleCmd("STOP," + String(c + 1));
    Serial.println("#OK stop");
    return;
  }

  // $CLEAR,<ch>
  if (ln.startsWith("$CLEAR,")) {
    uint8_t c;
    if (!parseChannel(ln, 7, c)) { Serial.println("#ERR bad_ch"); return; }
    handleCmd("CLEAR," + String(c + 1));
    Serial.println("#OK clear");
    return;
  }

  Serial.println("#ERR unknown_cmd");
}

// Simpan mode ONLINE/OFFLINE ke NVS
static void saveRequireAuth() {
  prefs.putBool("req_auth", requireAuth);
}

// Terapkan mode ke display HMI — dipanggil saat mode berubah atau page load
void uiUpdateMode() {
  if (requireAuth) {
    nxSendCmd("t_htar.txt=\"MODE: PAYMENT (ONLINE)\"");
    // Sync variabel va_mode di semua setting page agar tombol b_mode tahu state saat ini
    nxSendCmd("setting_CH1.va_mode.val=1");
    nxSendCmd("setting_CH2.va_mode.val=1");
    nxSendCmd("setting_CH3.va_mode.val=1");
  } else {
    nxSendCmd("t_htar.txt=\"MODE: FREE (OFFLINE)\"");
    nxSendCmd("setting_CH1.va_mode.val=0");
    nxSendCmd("setting_CH2.va_mode.val=0");
    nxSendCmd("setting_CH3.va_mode.val=0");
  }
}

void backendInit() {
  if (!ENABLE_BACKEND) return;
  beLineBuf.reserve(96);
  requireAuth = prefs.getBool("req_auth", false); // default OFFLINE
  Serial.println("#BOOT SPKLU XY12550S backend ready");
  Serial.printf("#INFO mode=%s\r\n", requireAuth ? "ONLINE" : "OFFLINE");
}

void backendPoll() {
  if (!ENABLE_BACKEND) return;

  // 1) Baca perintah masuk dari UART0 (non-blocking).
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') {
      String ln = beLineBuf; beLineBuf = "";
      ln.trim();
      if (ln.length()) backendHandleLine(ln);
    } else if (c == '\r') {
      // abaikan CR
    } else {
      beLineBuf += c;
      if (beLineBuf.length() > 180) beLineBuf = "";  // anti-overflow
    }
  }

  // 2) Telemetri periodik ke backend.
  if (millis() - beLastTelemetry >= BACKEND_TELEMETRY_MS) {
    beLastTelemetry = millis();
    backendPrintTelemetry();
  }
}

// ===========================================================
//                          SETUP / LOOP
// ===========================================================
uint32_t lastPoll=0, lastUi=0;
uint8_t pollIdx=0;

static uint8_t firstEnabledChannel() {
  for(uint8_t c=0;c<3;c++) if(chEnabled(c)) return c;
  return 0;
}

void setup() {
  Serial.begin(115200);

  // Pushbutton emergency stop
  for (uint8_t c = 0; c < 3; c++) {
    if (BTN_PIN[c] >= 0) {
      pinMode(BTN_PIN[c], INPUT_PULLUP);
      btnLastRaw[c] = (bool)digitalRead(BTN_PIN[c]);
      btnStable[c]  = btnLastRaw[c];
    }
  }

  // Phase 3 hardening: pin watchdog eksternal
  if (EXT_WDT_PIN >= 0) pinMode(EXT_WDT_PIN, OUTPUT);

  //pinMode(RS485_DE_RE, OUTPUT);
  //rs485TxOff();

  SerialModbus.begin(MODBUS_BAUD, SERIAL_8N1, UART_MODBUS_RX, UART_MODBUS_TX);
  SerialModbus.setTimeout(200);  // reduce blocking time for ModbusMaster readBytes
  SerialNextion.begin(NEXTION_BAUD, SERIAL_8N1, UART_NEXTION_RX, UART_NEXTION_TX);

  for(int i=0;i<3;i++){
    if(!chEnabled(i)) continue;
    nodes[i].begin(SLAVE_ID[i], SerialModbus);
    // nodes[i].preTransmission(preTransmission);
    // nodes[i].postTransmission(postTransmission);
  }

  //prefs.clear(); // <-- UNCOMMENT sekali saja untuk reset semua profile ke default

  loadProfilesFromNVSOrDefault();
  loadPanelPin(); // S1 FIX: sebelumnya tidak dipanggil, PIN selalu default "1234"

  // Phase 3 hardening: catat alasan reset terakhir + hitung reset tak terduga
  // (WDT/panic/brownout) ke NVS untuk diagnosa lapangan. prefs sudah terbuka.
  {
    esp_reset_reason_t rr = esp_reset_reason();
    Serial.printf("#INFO reset_reason=%d\r\n", (int)rr);
    if (rr == ESP_RST_TASK_WDT || rr == ESP_RST_INT_WDT || rr == ESP_RST_WDT ||
        rr == ESP_RST_PANIC    || rr == ESP_RST_BROWNOUT) {
      uint32_t n = prefs.getUInt("rst_unexp", 0) + 1;
      prefs.putUInt("rst_unexp", n);
      Serial.printf("#WARN reset tak terduga, total=%u\r\n", (unsigned)n);
    }
  }

  // Nextion init
  nxSendCmd("bkcmd=0");                 // production mode: no ack/error spam
  nxSendCmd("page page_welcome");
  nxSendCmd("t_htit.txt=\"SPKLU DC CHARGER\"");
  nxSendCmd("t_htar.txt=\"Tarif: Rp 2440/kWh\"");
  nxSendCmd("t_hcon.txt=\"ONLINE\"");
  nxSendCmd("t_hcon.pco=0x362B");

  // Init each channel
  /*for(int c=0;c<3;c++){
    if(!chEnabled(c)){
      ch[c].state = IDLE;
      ch[c].modbusFailCount = 0;
      continue;
    }

    xySetOutput(c, false);

    if (xyReadBlock(c)) {
      ch[c].modbusFailCount = 0;
      ch[c].state = IDLE;
      resetSession(c);

      // optional: sync profile -> module at boot
      // pushSelectedProfileToModule(c);

    } else {
      ch[c].modbusFailCount = MODBUS_FAIL_LIMIT;
      ch[c].state = FAULT;
    }
  }*/
for(int c=0;c<3;c++){
  if(!chEnabled(c)) continue;
    // 1. Paksa enable + OFF (deterministik)
  xyEnableStage(c);

  // 2. Double safety
  xySetOutput(c, false);
  delay(20);
  // 3. Baru baca status
  if (xyReadBlock(c)) {
    ch[c].modbusFailCount = 0;
    ch[c].state = IDLE;
    resetSession(c);
  } else {
    ch[c].modbusFailCount = MODBUS_FAIL_LIMIT;
    ch[c].state = FAULT;
  }
}

  pollIdx = firstEnabledChannel();

  uiEnterPage(activePage);

  // Backend / payment (Phase 2): siapkan parser + telemetri di UART0.
  // requireAuth dimuat dari NVS di dalam backendInit().
  backendInit();
  uiUpdateMode(); // tampilkan mode OFFLINE/ONLINE di HMI segera setelah boot

  // Hardware watchdog dipasang TERAKHIR, setelah semua init blocking selesai,
  // supaya proses boot yang lambat tidak memicu reboot. Selanjutnya di-feed
  // dari loop(). Version-guard untuk Arduino-ESP32 2.x dan 3.x.
  if (ENABLE_TASK_WDT) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    esp_task_wdt_config_t wdtCfg = {
      .timeout_ms = WDT_TIMEOUT_S * 1000,
      .idle_core_mask = 0,
      .trigger_panic = true
    };
    if (esp_task_wdt_init(&wdtCfg) == ESP_ERR_INVALID_STATE) {
      esp_task_wdt_reconfigure(&wdtCfg);   // TWDT sudah aktif -> cukup set ulang
    }
#else
    esp_task_wdt_init(WDT_TIMEOUT_S, true);
#endif
    esp_task_wdt_add(NULL);                 // pantau loopTask
  }
}

void loop() {
  // 0) Feed hardware watchdog (auto-reboot bila loop macet > WDT_TIMEOUT_S)
  if (ENABLE_TASK_WDT) esp_task_wdt_reset();

  // 0a) Phase 3 hardening: kick watchdog eksternal (sabuk-pengaman) bila dipasang.
  if (EXT_WDT_PIN >= 0) digitalWrite(EXT_WDT_PIN, !digitalRead(EXT_WDT_PIN));

  // 0b) Pushbutton emergency stop
  pollButtons();

  // 1) Nextion input
  String line;
  while (nx.hasLine(line)) {
    handleCmd(line);
  }

  // 1b) Backend / payment (Phase 2): perintah & telemetri di UART0
  backendPoll();

  // 2) Page change refresh
  // W4 FIX: baca activePage via getActivePage() untuk dokumentasi intent atomic
  static uint8_t lastPage = 255;
  uint8_t curPage = getActivePage();
  if (curPage != lastPage) {
    lastPage = curPage;
    uiEnterPage(curPage);
  }

  // 3) Modbus polling
  if (millis() - lastPoll >= POLL_INTERVAL_MS) {
    lastPoll = millis();

    // find next enabled channel without breaking loop()
    uint8_t tries = 0;
    while (tries < 3 && !chEnabled(pollIdx)) {
      pollIdx = (pollIdx + 1) % 3;
      tries++;
    }

    if (tries < 3 && chEnabled(pollIdx)) {
      bool ok = xyReadBlockRetry(pollIdx, MODBUS_READ_ATTEMPTS);
      if (ok) ch[pollIdx].modbusFailCount = 0;
      else if (ch[pollIdx].modbusFailCount < 255) ch[pollIdx].modbusFailCount++;

      // BUGFIX billing: akumulasi energi sesi tiap pembacaan sukses (tahan reset modul)
      if (ok) sessionAccumulate(pollIdx);

      updateChannelState(pollIdx);

      // Phase 1: OCP auto-recovery handler
      handleOCPRetry(pollIdx);

      // Phase 3 hardening: alarm suhu dini
      checkOverTemp(pollIdx);

      pollIdx = (pollIdx + 1) % 3;
    }
  }

  // 4) UI update
  if (millis() - lastUi >= UI_INTERVAL_MS) {
    lastUi = millis();

    bool anyOffline = false;
    bool anyEnabled = false;
    for(int c=0;c<3;c++){
      if(!chEnabled(c)) continue;
      anyEnabled = true;
      if(ch[c].modbusFailCount >= MODBUS_FAIL_LIMIT) anyOffline = true;
    }

    if (!anyEnabled || anyOffline) {
      nxSendCmd("t_hcon.txt=\"OFFLINE\"");
      nxSendCmd("t_hcon.pco=0xF9C6");
    } else {
      nxSendCmd("t_hcon.txt=\"ONLINE\"");
      nxSendCmd("t_hcon.pco=0x362B");
    }

    if (activePage == 0) uiUpdateMonitor();
    else if (activePage >= 1 && activePage <= 3) uiUpdateChannel(getActivePage() - 1);
  }
}
