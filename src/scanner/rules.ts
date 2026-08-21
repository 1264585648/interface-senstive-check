import type { ComplianceRule, RuleDefinition } from './types';
import { hasValidCnProvinceCode, isValidCnIdCard, isValidDateParts } from './validators';

const MOBILE_REGEX = /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d(?:[-\s]?\d){8}(?!\d)/g;
const ID_CARD_18_REGEX = /(?<![0-9A-Za-z])\d{17}[0-9Xx](?![0-9A-Za-z])/g;
const ID_CARD_15_REGEX = /(?<!\d)\d{15}(?!\d)/g;
const BIRTH_FIELD_NAMES = new Set([
  'birthday',
  'birthdate',
  'birthmonth',
  'birthym',
  'dateofbirth',
  'dob',
  '出生日期',
  '出生年月',
  '生日'
]);
const MAX_CUSTOM_REGEX_LENGTH = 256;
const MAX_CUSTOM_RULE_MATCHES = 200;

function unique(matches: string[]): string[] {
  return [...new Set(matches)];
}

function normalizeFieldName(fieldName: string): string {
  return fieldName.toLowerCase().replace(/[\s_-]/g, '');
}

function isBirthField(fieldName?: string): boolean {
  return Boolean(fieldName && BIRTH_FIELD_NAMES.has(normalizeFieldName(fieldName)));
}

function isValidLegacyCnIdCard(value: string): boolean {
  if (!/^\d{15}$/.test(value) || !hasValidCnProvinceCode(value) || value.slice(12, 15) === '000') return false;
  const year = Number(`19${value.slice(6, 8)}`);
  const month = Number(value.slice(8, 10));
  const day = Number(value.slice(10, 12));
  return isValidDateParts(year, month, day);
}

function detectBirthDates(value: string): string[] {
  const results: string[] = [];
  const patterns = [
    /(?<!\d)(19\d{2}|20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])(?!\d)/g,
    /(?<!\d)(19\d{2}|20\d{2})年(0?[1-9]|1[0-2])月(0?[1-9]|[12]\d|3[01])日/g,
    /(?<!\d)(19\d{2}|20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/g
  ];

  for (const regex of patterns) {
    for (const match of value.matchAll(regex)) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      if (isValidDateParts(year, month, day)) results.push(match[0]);
    }
  }

  if (results.length > 0) return unique(results);

  const monthPatterns = [
    /(?<!\d)(19\d{2}|20\d{2})[-/.](0?[1-9]|1[0-2])(?![-/.\d])/g,
    /(?<!\d)(19\d{2}|20\d{2})年(0?[1-9]|1[0-2])月(?!\d)/g,
    /(?<!\d)(19\d{2}|20\d{2})(0[1-9]|1[0-2])(?!\d)/g
  ];

  for (const regex of monthPatterns) {
    for (const match of value.matchAll(regex)) results.push(match[0]);
  }

  return unique(results);
}

export const complianceRules: ComplianceRule[] = [
  {
    id: 'CN_MOBILE',
    name: '手机号',
    description: '中国大陆完整手机号',
    expression: '1[3-9]\\d{9}',
    scanRaw: true,
    detect: (value) => unique(value.match(MOBILE_REGEX) ?? [])
  },
  {
    id: 'CN_ID_CARD',
    name: '身份证号',
    description: '中国居民身份证号',
    expression: '\\d{17}[\\dXx] + checksum',
    scanRaw: true,
    detect: (value) => unique([
      ...(value.match(ID_CARD_18_REGEX) ?? []).filter(isValidCnIdCard),
      ...(value.match(ID_CARD_15_REGEX) ?? []).filter(isValidLegacyCnIdCard)
    ])
  },
  {
    id: 'FULL_BIRTH_DATE',
    name: '完整出生日期',
    description: '生日语义字段中的完整年月日',
    expression: '\\d{4}-\\d{2}-\\d{2}',
    scanRaw: false,
    detect: (value, context) => isBirthField(context.fieldName) ? detectBirthDates(value) : []
  }
];

export function defaultRuleDefinitions(now = Date.now()): RuleDefinition[] {
  return complianceRules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    description: rule.description,
    type: 'builtin',
    expression: rule.expression,
    enabled: true,
    system: true,
    createdAt: now,
    updatedAt: now
  }));
}

function nextTokenIsQuantifier(expression: string, index: number): boolean {
  const next = expression[index];
  return next === '*' || next === '+' || next === '?' || next === '{';
}

export function validateCustomRegexExpression(expression: string): void {
  if (!expression) throw new Error('正则表达式不能为空');
  if (expression.length > MAX_CUSTOM_REGEX_LENGTH) {
    throw new Error(`正则表达式不能超过 ${MAX_CUSTOM_REGEX_LENGTH} 个字符`);
  }

  try {
    new RegExp(expression, 'g');
  } catch (error) {
    throw new Error(`正则表达式无效：${error instanceof Error ? error.message : String(error)}`);
  }

  const groups: Array<{ hasQuantifier: boolean; hasAlternation: boolean }> = [];
  let inClass = false;

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];

    if (char === '\\') {
      const escaped = expression[index + 1];
      if (escaped && /[1-9]/.test(escaped)) {
        throw new Error('自定义规则不支持反向引用，请改用无回溯的表达式');
      }
      if (escaped === 'k' && expression[index + 2] === '<') {
        throw new Error('自定义规则不支持命名反向引用，请改用无回溯的表达式');
      }
      index += 1;
      continue;
    }

    if (char === '[') {
      inClass = true;
      continue;
    }
    if (char === ']' && inClass) {
      inClass = false;
      continue;
    }
    if (inClass) continue;

    if (char === '(') {
      groups.push({ hasQuantifier: false, hasAlternation: false });
      continue;
    }

    if (char === '|') {
      const current = groups.at(-1);
      if (current) current.hasAlternation = true;
      continue;
    }

    if (char === '*' || char === '+' || char === '{') {
      const current = groups.at(-1);
      if (current) current.hasQuantifier = true;
      continue;
    }

    if (char === '?' && expression[index - 1] !== '(') {
      const current = groups.at(-1);
      if (current) current.hasQuantifier = true;
      continue;
    }

    if (char === ')') {
      const current = groups.pop();
      if (!current) continue;
      if (nextTokenIsQuantifier(expression, index + 1) && (current.hasQuantifier || current.hasAlternation)) {
        throw new Error('正则表达式包含高风险嵌套量词或重复分支，请简化后重试');
      }
      if (nextTokenIsQuantifier(expression, index + 1)) {
        const parent = groups.at(-1);
        if (parent) parent.hasQuantifier = true;
      }
    }
  }
}

function compileRegexRule(definition: RuleDefinition): ComplianceRule {
  const regex = new RegExp(definition.expression, 'g');
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    expression: definition.expression,
    scanRaw: true,
    detect: (value) => {
      regex.lastIndex = 0;
      const matches: string[] = [];
      let match: RegExpExecArray | null;

      while (matches.length < MAX_CUSTOM_RULE_MATCHES && (match = regex.exec(value)) !== null) {
        if (match[0]) matches.push(match[0]);
        if (match[0] === '') regex.lastIndex += 1;
      }

      return unique(matches);
    }
  };
}

export function compileRuleDefinitions(definitions: RuleDefinition[]): ComplianceRule[] {
  const builtins = new Map(complianceRules.map((rule) => [rule.id, rule]));
  const compiled: ComplianceRule[] = [];

  for (const definition of definitions) {
    if (!definition.enabled) continue;

    if (definition.type === 'builtin') {
      const builtin = builtins.get(definition.id);
      if (!builtin) continue;
      compiled.push({
        ...builtin,
        name: definition.name,
        description: definition.description,
        expression: definition.expression
      });
      continue;
    }

    try {
      validateCustomRegexExpression(definition.expression);
      compiled.push(compileRegexRule(definition));
    } catch {
      // Older persisted rules may predate the safety checks. Keep them visible in settings,
      // but never execute an unsafe expression in the service worker.
    }
  }

  return compiled;
}
