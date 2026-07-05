export interface User {
  id: number;
  email: string;
  phone: string | null;
  fullName?: string;
  full_name?: string;
  balance: number;
  role: 'USER' | 'ADMIN' | 'SUPERADMIN';
  status: string;
}

export interface Location {
  id: number;
  name: string;
  address: string;
  city: string;
  status: 'ONLINE' | 'BUSY' | 'OFFLINE';
  power_kw: number;
  type: string;
  hours: string;
  total_chargers: number;
  available_chargers: number;
}

export interface Charger {
  id: number;
  label: string;
  available: boolean;
  status: 'READY' | 'CHARGING' | 'OFFLINE' | 'FAULT' | 'PAUSED' | 'MAINTENANCE';
}

export interface MotorProfile {
  id: number;
  brand: string;
  model: string;
  category: string | null;
  max_power_kw: number | null;
  batt_cap_kwh: number | null;
}

export interface SessionTick {
  energy: number;
  voltage: number;
  current: number;
  power: number;
  cost: number;
  elapsed: number;
  status: string;
}

export interface SessionFinal {
  final: true;
  status: 'COMPLETED' | 'STOPPED' | 'FAULT';
  endReason: string;
  kwh: number;
  cost: number;
  refund: number;
  durationSec: number;
}

export interface SessionRecord {
  id: string;
  status: string;
  end_reason: string | null;
  start_mode: string;
  consumed_kwh: number;
  total_cost: number | null;
  target_rp: number;
  start_time: string;
  end_time: string | null;
  station_name: string | null;
  brand: string | null;
  model: string | null;
}

export interface Paged<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
