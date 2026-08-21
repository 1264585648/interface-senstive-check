import { describe, expect, it } from 'vitest';
import { scanResponseBody } from '../src/scanner/scan';
import { isValidCnIdCard } from '../src/scanner/validators';

describe('scanner', () => {
  it('detects and masks mainland China mobile numbers', () => {
    const result = scanResponseBody(JSON.stringify({ phone: '13800138000' }));
    expect(result).toContainEqual(expect.objectContaining({
      ruleId: 'CN_MOBILE',
      path: '$.phone',
      maskedValue: '138****8000'
    }));
  });

  it('detects complete birth dates only on birthday-like fields', () => {
    const result = scanResponseBody(JSON.stringify({
      birthday: '1990-05-18',
      birthDate: '1990年05月18日',
      dob: '19900518',
      createdAt: '2026-08-21'
    }));
    const birthDates = result.filter((item) => item.ruleId === 'FULL_BIRTH_DATE');
    expect(birthDates).toHaveLength(3);
    expect(birthDates.some((item) => item.path === '$.createdAt')).toBe(false);
  });

  it('does not report masked mobile numbers', () => {
    expect(scanResponseBody(JSON.stringify({ phone: '138****8000' }))).toEqual([]);
  });

  it('validates Chinese ID card checksum before reporting', () => {
    const valid = '11010519491231002X';
    expect(isValidCnIdCard(valid)).toBe(true);
    expect(isValidCnIdCard('110105194912310021')).toBe(false);
    const result = scanResponseBody(JSON.stringify({ idCard: valid }));
    expect(result).toContainEqual(expect.objectContaining({ ruleId: 'CN_ID_CARD', path: '$.idCard' }));
  });
});
