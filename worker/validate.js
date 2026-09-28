// National ID format validation (Israeli or Chinese) — mirrors the
// client-side checksum checks in public/index.html exactly. This exists
// server-side so the format requirement can't be bypassed by a request
// built by hand that skips the frontend's own validation.

function isValidIsraeliId(v) {
  let t = String(v ?? '').trim();
  if (!/^\d{1,9}$/.test(t)) return false;
  t = t.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let val = Number(t[i]) * (i % 2 === 0 ? 1 : 2);
    if (val > 9) val -= 9;
    sum += val;
  }
  return sum % 10 === 0;
}

function isValidChineseId(v) {
  const t = String(v ?? '').trim().toUpperCase();
  if (!/^\d{17}[\dX]$/.test(t)) return false;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checkMap = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(t[i]) * weights[i];
  return checkMap[sum % 11] === t[17];
}

export function isValidNationalId(v) {
  return isValidIsraeliId(v) || isValidChineseId(v);
}
