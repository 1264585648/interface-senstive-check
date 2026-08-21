import { describe, expect, it } from 'vitest';
import { compileRuleDefinitions } from '../src/scanner/rules';
import { scanResponseBody } from '../src/scanner/scan';
import type { Finding, RuleDefinition } from '../src/scanner/types';
import { exportFindingGroupsCsv } from '../src/sidepanel/v2/exportCsv';
import { groupFindings } from '../src/sidepanel/v2/groupFindings';

describe('v2 capabilities', () => {
  it('runs persisted custom regex rules in the scanner', () => {
    const definition: RuleDefinition = {
      id: 'CUSTOM_BANK_CARD',
      name: '银行卡号',
      description: '16-19 位银行卡号示例规则',
      type: 'regex',
      expression: '\\b\\d{16,19}\\b',
      enabled: true,
      system: false,
      createdAt: 1,
      updatedAt: 1
    };
    const rules = compileRuleDefinitions([definition]);
    const result = scanResponseBody(
      JSON.stringify({ bankCard: '6222021234567890' }),
      new Set(rules.map((rule) => rule.id)),
      rules
    );

    expect(result).toContainEqual(expect.objectContaining({
      ruleId: 'CUSTOM_BANK_CARD',
      ruleName: '银行卡号',
      path: '$.bankCard',
      rawValue: '6222021234567890'
    }));
  });

  it('groups findings by method and sanitized interface path', () => {
    const base: Omit<Finding, 'id' | 'ruleId' | 'ruleName' | 'path' | 'rawValue'> = {
      tabId: 1,
      requestId: 'r1',
      url: 'https://example.com/api/user/detail',
      method: 'GET',
      status: 200,
      mimeType: 'application/json',
      detectedAt: 1
    };
    const findings: Finding[] = [
      { ...base, id: '1', ruleId: 'CN_MOBILE', ruleName: '手机号', path: '$.phone', rawValue: '13800138000' },
      { ...base, id: '2', ruleId: 'CN_ID_CARD', ruleName: '身份证号', path: '$.idCard', rawValue: '11010519491231002X' }
    ];

    const groups = groupFindings(findings);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ method: 'GET', url: '/api/user/detail', count: 2 });
    expect(groups[0].rules).toEqual(['手机号', '身份证号']);
  });

  it('exports only interface and location without raw sensitive values', () => {
    const csv = exportFindingGroupsCsv([{
      key: 'GET:/api/user/detail',
      method: 'GET',
      url: '/api/user/detail',
      rules: ['手机号'],
      locations: ['$.phone'],
      count: 1
    }]);

    expect(csv).toContain('GET /api/user/detail');
    expect(csv).toContain('$.phone');
    expect(csv).not.toContain('13800138000');
  });
});
