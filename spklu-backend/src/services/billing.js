// Perhitungan biaya & reservasi saldo.
// Model reserve-refund: saldo dipotong sebesar nilai target saat sesi mulai;
// limit firmware menjamin konsumsi <= target, selisih dikembalikan saat selesai.

export function costFromKwh(kwh, pricePerKwh) {
  if (!(kwh >= 0)) throw new Error(`kwh invalid: ${kwh}`);
  return Math.round(kwh * pricePerKwh);
}

// Nilai Rupiah yang direservasi untuk sebuah target.
// mode 'kwh': target dalam kWh -> reservasi = target * tarif (dibulatkan ke atas
//             supaya reservasi tidak pernah kurang dari biaya maksimal).
// mode 'idr': target dalam Rupiah -> reservasi = target.
export function reservationAmount(mode, target, pricePerKwh) {
  if (!(Number(target) > 0)) throw new Error(`target harus > 0: ${target}`);
  if (mode === 'kwh') return Math.ceil(target * pricePerKwh);
  if (mode === 'idr') return Math.round(target);
  throw new Error(`mode tidak dikenal: ${mode}`);
}

// Map mode UI -> (limitType, limitValue) untuk $AUTH.
export function limitForMode(mode, target) {
  if (!(Number(target) > 0)) throw new Error(`target harus > 0: ${target}`);
  if (mode === 'kwh') return { limitType: 1, limitValue: Number(target) };
  if (mode === 'idr') return { limitType: 2, limitValue: Math.round(target) };
  throw new Error(`mode tidak dikenal: ${mode}`);
}

// Finalisasi: biaya aktual & refund. Biaya tidak boleh melebihi reservasi
// (guard pembulatan — firmware & backend sama-sama membulatkan).
export function settleSession(reservedRp, consumedKwh, pricePerKwh) {
  const rawCost = costFromKwh(consumedKwh, pricePerKwh);
  const cost = Math.min(rawCost, reservedRp);
  return { cost, refund: reservedRp - cost };
}
