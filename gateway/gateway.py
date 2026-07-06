#!/usr/bin/env python3
"""SPKLU Gateway — Raspberry Pi Zero 2W.

Translator tipis dua arah, TANPA logika bisnis:
  UART (ESP32, 115200)  <->  WebSocket persisten ke backend cloud.

Backend mengirim {"type":"cmd","line":"$..."}  -> tulis line+"\n" ke serial.
Setiap baris "#..." dari serial               -> kirim {"type":"line","line":...}.

Konfigurasi via environment (atau file /etc/spklu-gateway.env di systemd):
  SPKLU_WS_URL     ws://<backend>:3001/api/ws/device (via Nginx: ws://host/api/ws/device)
  SPKLU_DEVICE_KEY device_key dari tabel devices
  SPKLU_SERIAL     /dev/serial0 (UART GPIO) | /dev/ttyUSB0
  SPKLU_BAUD       115200
"""
import asyncio
import json
import os
import sys

import serial  # pyserial
import websockets

WS_URL = os.environ.get("SPKLU_WS_URL", "ws://127.0.0.1:3001/api/ws/device")
DEVICE_KEY = os.environ.get("SPKLU_DEVICE_KEY", "CHANGE_ME_DEVICE_KEY")
SERIAL_PORT = os.environ.get("SPKLU_SERIAL", "/dev/serial0")
BAUD = int(os.environ.get("SPKLU_BAUD", "115200"))

RECONNECT_MIN, RECONNECT_MAX = 2, 30


def open_serial() -> serial.Serial:
    return serial.Serial(SERIAL_PORT, BAUD, timeout=0.1)


async def serial_reader(ser: serial.Serial, ws) -> None:
    """Baca baris dari ESP32; teruskan hanya baris protokol '#' ke backend."""
    buf = b""
    while True:
        chunk = await asyncio.to_thread(ser.read, 256)
        if chunk:
            buf += chunk
            while b"\n" in buf:
                raw, buf = buf.split(b"\n", 1)
                line = raw.decode("utf-8", "replace").strip()
                if line.startswith("#"):
                    await ws.send(json.dumps({"type": "line", "line": line}))
        else:
            await asyncio.sleep(0.02)


async def ws_reader(ser: serial.Serial, ws) -> None:
    """Terima perintah dari backend; tulis ke serial apa adanya."""
    async for raw in ws:
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if msg.get("type") == "cmd" and isinstance(msg.get("line"), str):
            line = msg["line"].strip()
            if line.startswith("$"):  # hanya perintah protokol yang diteruskan
                ser.write((line + "\n").encode())


async def run_once() -> None:
    ser = open_serial()
    try:
        async with websockets.connect(WS_URL, ping_interval=20, ping_timeout=10) as ws:
            await ws.send(json.dumps({
                "type": "hello", "deviceKey": DEVICE_KEY, "fw": "gateway-py/1.0",
            }))
            hello = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
            if hello.get("type") != "hello_ok":
                raise RuntimeError(f"handshake ditolak: {hello}")
            print(f"[gateway] terhubung, deviceId={hello.get('deviceId')}", flush=True)
            await asyncio.gather(serial_reader(ser, ws), ws_reader(ser, ws))
    finally:
        ser.close()


async def main() -> None:
    delay = RECONNECT_MIN
    while True:
        try:
            await run_once()
            delay = RECONNECT_MIN
        except Exception as exc:  # koneksi putus / serial error -> reconnect backoff
            print(f"[gateway] {exc!r} — reconnect dalam {delay}s", file=sys.stderr, flush=True)
            await asyncio.sleep(delay)
            delay = min(delay * 2, RECONNECT_MAX)


if __name__ == "__main__":
    asyncio.run(main())
