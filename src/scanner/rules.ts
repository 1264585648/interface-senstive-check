import type { ComplianceRule } from './types';
import { isValidCnIdCard, isValidDateParts } from './validators';

const MOBILE_REGEX = /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d(?:[-\s]?\d){8}(?!\d)/g;
const ID_CARD_18_REGEX = /(?<![0-9A-Za-z])\d{17}[0-9Xx](?![0-9A-Za-z])/g;
const ID_CARD_15_REGEX = /(?<!\d)\d{15}(?!\d)/g;
const BIRTH_PATH_REGEX = /(birthday|birth[_-]?(?:day|date|month|ym)|date[_-]?of[_-]?birth|dob|出生日期|出生年月|生日)/i;
const CN_PROVINCE_CODES = new Set(['11','12','13','14','15','21','22','23','31','32','33','34','35','36','37','41','42','43','44','45','46','50','51','52','53','54','61','62','63','64','65','71','81','82']);

function unique(matches: string[]): string[] {
  return [...new Set(matches)];
}

function isValidLegacyCnIdCard(value: string): boolean {
  if (!/^\d{15}$/.test(value) || !CN_PROVINCE_CODES.has(value.slice(0, 2))) return false;
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
    detect: (value) => unique(value.match(MOBILE_REGEX) ?? [])
  },
  {
    id: 'CN_ID_CARD',
    name: '身份证号',
    description: '中国居民身份证号',
    expression: '\\d{17}[\\dXx] + checksum',
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
    detect: (value, context) => BIRTH_PATH_REGEX.test(context.path) ? detectBirthDates(value) : []
  }
];
