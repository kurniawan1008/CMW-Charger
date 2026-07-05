// Klien REST tipis dengan token JWT dari localStorage.
const BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');

// Guard produksi (audit M4): build tanpa VITE_API_URL akan menembak localhost
// di HP pelanggan — lebih baik gagal keras saat build/boot.
if (import.meta.env.PROD && !import.meta.env.VITE_API_URL) {
  throw new Error('VITE_API_URL wajib di-set untuk build produksi');
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const tokenStore = {
  get: () => localStorage.getItem('cmw_token'),
  set: (t: string) => localStorage.setItem('cmw_token', t),
  clear: () => localStorage.removeItem('cmw_token'),
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(tokenStore.get() ? { authorization: `Bearer ${tokenStore.get()}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  // 401 global (audit H2): token kedaluwarsa -> bersihkan & kembali ke login,
  // jangan biarkan app tampak hidup tapi semua request diam-diam gagal.
  if (res.status === 401 && tokenStore.get() && !path.startsWith('/auth')) {
    tokenStore.clear();
    window.location.href = '/auth';
  }
  if (!res.ok) throw new ApiError(res.status, json.error || `HTTP ${res.status}`);
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  wsUrl: (token: string) => `${BASE.replace(/^http/, 'ws')}/ws/client?token=${token}`,
};
