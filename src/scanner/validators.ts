const CN_ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const CN_ID_CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
const CN_PROVINCE_CODES = new Set([
  '11', '12', '13', '14', '15', '21', '22', '23', '31', '32', '33', '34', '35', '36', '37',
  '41', '42', '43', '44', '45', '46', '50', '51', '52', '53', '54', '61', '62', '63', '64', '65',
  '71', '81', '82'
]);

export function hasValidCnProvinceCode(value: string): boolean {
  return CN_PROVINCE_CODES.has(value.slice(0, 2));
}

export function isValidDateParts(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > new Date().getFullYear()) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isValidCnIdCard(value: string): boolean {
  const normalized = value.toUpperCase();
  if (!/^\d{17}[0-9X]$/.test(normalized)) return false;
  if (!hasValidCnProvinceCode(normalized) || normalized.slice(14, 17) === '000') return false;

  const year = Number(normalized.slice(6, 10));
  const month = Number(normalized.slice(10, 12));
  const day = Number(normalized.slice(12, 14));
  if (!isValidDateParts(year, month, day)) return false;

  const sum = CN_ID_WEIGHTS.reduce((total, weight, index) => total + Number(normalized[index]) * weight, 0);
  return CN_ID_CHECK_CODES[sum % 11] === normalized[17];
}
