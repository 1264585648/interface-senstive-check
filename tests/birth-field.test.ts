import { describe, expect, it } from 'vitest';
import { scanResponseBody } from '../src/scanner/scan';

describe('birth field semantics', () => {
  it('matches supported birth field names exactly after normalization', () => {
    const result = scanResponseBody(JSON.stringify({ birth_date: '1990-05-18' }));
    expect(result.some((item) => item.ruleId === 'FULL_BIRTH_DATE')).toBe(true);
  });

  it('does not treat unrelated fields containing dob as birth fields', () => {
    const result = scanResponseBody(JSON.stringify({ adobeVersion: '1990-05-18' }));
    expect(result.some((item) => item.ruleId === 'FULL_BIRTH_DATE')).toBe(false);
  });
});
