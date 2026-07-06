#pragma once
#include <Arduino.h>

// NOTE:
// - XY12550S current scaling is 0.01A (15.00A => 1500).
// - Voltage scaling is 0.01V.
// - Temperature scaling is assumed 0.1°C.

struct MotorProfile {
  String label;   // motor label/name (not edited in settings page)
  float vset_V;
  float iset_A;   // 0.01A resolution
  float ocp_A;    // 0.01A resolution
  int   otp_C;    // °C
  float lvp_V;    // input undervoltage protection threshold
};

enum ChState : uint8_t { IDLE=0, SELECT=1, CHARGING=2, DONE=3, FAULT=4, PAUSED=5 };

struct XYReadings {
  float vset=0, iset=0, vout=0, iout=0, power=0, uin=0;
  uint32_t wh_mWh=0;        // 32-bit mWh total
  uint32_t out_seconds=0;

  // Temperature (assumed 0.1°C scaling from device registers)
  float t_in=0; // °C
  float t_ex=0; // °C

  uint16_t protect=0, cvcc=0, onoff=0;
};

struct Channel {
  ChState state = IDLE;

  uint8_t motorIdx = 0;       // selected motor type (M0..M9)

  // Session baseline
  uint32_t sessionWhStart_mWh = 0;
  uint32_t sessionStartMillis = 0;
  // BUGFIX billing: akumulator energi sesi (mWh) + nilai counter terakhir, supaya
  // energi tidak hilang saat counter modul XY ter-reset di tengah sesi.
  uint32_t sessionWhAccum_mWh = 0;
  uint32_t sessionWhLast_mWh  = 0;

  // DONE snapshot
  float done_kWh = 0;
  uint32_t done_rp = 0;
  uint32_t done_sec = 0;

  uint8_t modbusFailCount = 0;
  XYReadings r;

  // Alasan FAULT terakhir: true bila dipicu komunikasi (Modbus) hilang.
  // Dipakai untuk auto-recovery: comm-fault boleh pulih otomatis saat
  // komunikasi kembali, sedangkan proteksi modul tetap butuh CLEAR manual.
  bool faultIsComm = false;

  // Settings-page edit buffer (no overlay / no password)
  bool settingOpen = false;
  uint8_t editMotorIdx = 0;   // motor being edited in settings page (M0..M9)
  MotorProfile editProfile;   // edited values (label follows profiles[c][editMotorIdx].label)
  bool editDirty = false;

  // ============ OCP AUTO-RECOVERY (Phase 1) ============
  // OCP retry state machine
  enum OCPState : uint8_t { 
    OCP_NONE = 0,      // normal, no OCP
    OCP_RETRY = 1,     // detected OCP, trying auto-recovery
    OCP_FAULT = 2      // max retries exceeded, waiting manual CLEAR
  };
  
  OCPState ocpState = OCP_NONE;
  uint8_t ocpRetryCount = 0;        // current attempt number
  uint32_t ocpRetryUntilMs = 0;     // when to attempt next retry
  uint8_t ocpLastProtectCode = 0;   // track if protect changed

  // ============ BACKEND / PAYMENT SESSION (Phase 2) ============
  // Diisi oleh perintah $AUTH dari backend (website payment) lewat Serial.
  // Saat charging, firmware memantau batas ini dan otomatis STOP +
  // mengirim event "session_complete" bila tercapai.
  bool     authorized   = false;       // backend sudah mengotorisasi sesi berbayar
  char     sessionId[24]= {0};         // id transaksi dari backend (untuk rekonsiliasi)
  uint8_t  limitType    = 0;           // 0=none, 1=kWh, 2=Rupiah, 3=detik
  float    limitKwh     = 0.0f;        // batas energi (kWh) bila limitType==1
  uint32_t limitRp      = 0;           // batas rupiah     bila limitType==2
  uint32_t limitSec     = 0;           // batas durasi (s) bila limitType==3
  bool     limitReached = false;       // sudah dilaporkan tercapai (anti-spam event)
};
