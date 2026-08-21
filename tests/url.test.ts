import { describe, expect, it } from 'vitest';
import { sanitizeUrl } from '../src/shared/url';

describe('sanitizeUrl', () => {
  it('drops query strings and fragments', () => {
    expect(sanitizeUrl('https://example.com/api/list?token=secret#part')).toBe('https://example.com/api/list');
  });

  it('redacts common sensitive or opaque path identifiers', () => {
    expect(sanitizeUrl('https://example.com/users/alice@example.com')).toBe('https://example.com/users/:redacted');
    expect(sanitizeUrl('https://example.com/order/12345678')).toBe('https://example.com/order/:redacted');
    expect(sanitizeUrl('https://example.com/api/550e8400-e29b-41d4-a716-446655440000')).toBe('https://example.com/api/:redacted');
  });

  it('keeps ordinary route segments readable', () => {
    expect(sanitizeUrl('https://example.com/api/user/detail')).toBe('https://example.com/api/user/detail');
  });
});
