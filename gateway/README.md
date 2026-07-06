# SPKLU Gateway — Raspberry Pi Zero 2W

Bridge tipis UART (ESP32) ⇄ WebSocket (backend). Tanpa logika bisnis — semua
keputusan di backend, firmware tetap source of truth untuk charging.

## Setup di Pi (Raspberry Pi OS Lite)

```bash
sudo raspi-config          # Interface Options -> Serial: login shell OFF, serial port ON
sudo apt install -y python3-pip
pip3 install -r requirements.txt
```

Wiring UART ESP32 (lihat firmware): GPIO4/5 ESP32 ↔ TX/RX Pi (`/dev/serial0`), GND bersama, 115200 baud.

## Konfigurasi

```bash
export SPKLU_WS_URL=ws://<ip-backend>:3001/api/ws/device
# Lewat Nginx produksi (proxy /api/ ke backend): ws://<domain-atau-ip>/api/ws/device
export SPKLU_DEVICE_KEY=<device_key dari tabel devices>
export SPKLU_SERIAL=/dev/serial0
python3 gateway.py
```

## Jalankan sebagai service (systemd)

`/etc/systemd/system/spklu-gateway.service`:

```ini
[Unit]
Description=SPKLU Gateway
After=network-online.target

[Service]
EnvironmentFile=/etc/spklu-gateway.env
ExecStart=/usr/bin/python3 /home/pi/spklu/gateway.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now spklu-gateway
journalctl -u spklu-gateway -f
```
