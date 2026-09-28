// Generates a random national ID that passes the real Israeli ID
// checksum (worker/validate.js) — needed anywhere a test calls the real
// HTTP endpoints (/api/employee/verify, /api/submit), which now reject
// any ID that isn't checksum-valid, regardless of whether it belongs to
// a registered employee.

function checkDigit(prefix8) {
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    let val = Number(prefix8[i]) * (i % 2 === 0 ? 1 : 2);
    if (val > 9) val -= 9;
    sum += val;
  }
  return String((10 - (sum % 10)) % 10);
}

// leadDigit lets different test suites keep visually distinct/non-colliding
// ID ranges, matching the pattern already used before this helper existed.
export function randomValidIsraeliId(leadDigit = '8') {
  const rest = String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
  const prefix8 = String(leadDigit) + rest;
  return prefix8 + checkDigit(prefix8);
}
