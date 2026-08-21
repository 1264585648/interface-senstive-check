import { describe, expect, it } from 'vitest';
import { scanResponseBodyDetailed } from '../src/scanner/scan';

describe('scanner limits', () => {
  it('reports when JSON depth budget prevents a complete scan', () => {
    let value: unknown = { value: 'leaf' };
    for (let index = 0; index < 32; index += 1) value = { child: value };

    const result = scanResponseBodyDetailed(JSON.stringify(value));
    expect(result.truncated).toBe(true);
    expect(result.reasons).toContain('max-depth');
  });
});
