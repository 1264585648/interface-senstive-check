import { describe, expect, it } from 'vitest';
import { isTextLikeMime } from '../src/scanner/content';
import { scanResponseBody } from '../src/scanner/scan';
import type { RuleId } from '../src/scanner/types';
import { isValidCnIdCard } from '../src/scanner/validators';

describe('scanner', () => {
  it('detects mainland China mobile numbers and keeps raw evidence', () => {
    const result = scanResponseBody(JSON.stringify({ phone: '13800138000' }));
    expect(result).toContainEqual(expect.objectContaining({
      ruleId: 'CN_MOBILE',
      path: '$.phone',
      rawValue: '13800138000'
    }));
  });

  it('detects formatted mobile numbers as plaintext', () => {
    const result = scanResponseBody(JSON.stringify({ phone: '+86 138-0013-8000' }));
    expect(result).toContainEqual(expect.objectContaining({
      ruleId: 'CN_MOBILE',
      rawValue: '+86 138-0013-8000'
    }));
  });

  it('detects complete birth dates and year-month values only on birth-like fields', () => {
    const result = scanResponseBody(JSON.stringify({
      birthday: '1990-05-18',
      birthDate: '1990年05月18日',
      birth_day: '19900518',
      birthMonth: '1990-05',
      createdAt: '2026-08-21'
    }));
    const birthDates = result.filter((item) => item.ruleId === 'FULL_BIRTH_DATE');
    expect(birthDates).toHaveLength(4);
    expect(birthDates.some((item) => item.path === '$.createdAt')).toBe(false);
    expect(birthDates).toContainEqual(expect.objectContaining({ rawValue: '1990-05-18' }));
  });

  it('does not report masked mobile numbers', () => {
    expect(scanResponseBody(JSON.stringify({ phone: '138****8000' }))).toEqual([]);
  });

  it('validates Chinese ID card checksum before reporting', () => {
    const valid = '11010519491231002X';
    expect(isValidCnIdCard(valid)).toBe(true);
    expect(isValidCnIdCard('110105194912310021')).toBe(false);
    const result = scanResponseBody(JSON.stringify({ idCard: valid }));
    expect(result).toContainEqual(expect.objectContaining({
      ruleId: 'CN_ID_CARD',
      path: '$.idCard',
      rawValue: valid
    }));
  });

  it('rejects ID cards with invalid province address codes', () => {
    const invalidProvince = '990105194912310023';
    expect(isValidCnIdCard(invalidProvince)).toBe(false);
    const result = scanResponseBody(JSON.stringify({ idCard: invalidProvince }));
    expect(result.some((item) => item.ruleId === 'CN_ID_CARD')).toBe(false);
  });

  it('raw-scans universal identifiers so unsafe JSON numbers are not silently missed', () => {
    const result = scanResponseBody('{"idCard":110105194912310011}');
    expect(result).toContainEqual(expect.objectContaining({
      ruleId: 'CN_ID_CARD',
      rawValue: '110105194912310011'
    }));
  });

  it('skips disabled rules', () => {
    const enabled = new Set<RuleId>(['CN_ID_CARD', 'FULL_BIRTH_DATE']);
    const result = scanResponseBody(JSON.stringify({ phone: '13800138000' }), enabled);
    expect(result.some((item) => item.ruleId === 'CN_MOBILE')).toBe(false);
  });

  it('only scans text-like response MIME types', () => {
    expect(isTextLikeMime('application/json')).toBe(true);
    expect(isTextLikeMime('application/problem+json; charset=utf-8')).toBe(true);
    expect(isTextLikeMime('text/plain; charset=utf-8')).toBe(true);
    expect(isTextLikeMime('application/pdf')).toBe(false);
    expect(isTextLikeMime('application/octet-stream')).toBe(false);
    expect(isTextLikeMime('image/png')).toBe(false);
  });
});
