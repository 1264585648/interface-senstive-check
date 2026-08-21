import type { ComplianceRule } from './types';
import { isValidCnIdCard, isValidDateParts } from './validators';

const MOBILE_REGEX = /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d(?:[-\s]?\d){8}(?!\d)/g;
const ID_CARD_18_REGEX = /(?<![0-9A-Za-z])\d{17}[0-9Xx](?![0-9A-Za-z])/g;
const ID_CARD_15_REGEX = /(?<!\d)\d{15}(?!\d)/g;
const BIRTH_PATH_REGEX = /(birthday|birth[_-]?date|date[_-]?of[_-]?birth|dob|出生日期|出生年月|生日)/i;

function unique(matches: string[]): string[] {
  return [...new Set(matches)];
}

function normalizeMobile(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length > 11 && digits.startsWith('86') ? digits.slice(-11) : digits;
}

function isValidLegacyCnIdCard(value: string): boolean {
  if (!/^\d{15}$/.test(value)) return false;
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

  return unique(results);
}

export const complianceRules: ComplianceRule[] = [
  {
    id: 'CN_MOBILE',
    name: '中国大陆手机号明文',
    detect: (value) => unique(value.match(MOBILE_REGEX) ?? []),
    mask: (value) => {
      const mobile = normalizeMobile(value);
      return mobile.length === 11 ? `${mobile.slice(0, 3)}****${mobile.slice(-4)}` : '***********';
    }
  },
  {
    id: 'CN_ID_CARD',
    name: '中国居民身份证号明文',
    detect: (value) => unique([
      ...(value.match(ID_CARD_18_REGEX) ?? []).filter(isValidCnIdCard),
      ...(value.match(ID_CARD_15_REGEX) ?? []).filter(isValidLegacyCnIdCard)
    ]),
    mask: (value) => `${value.slice(0, 6)}${'*'.repeat(Math.max(5, value.length - 10))}${value.slice(-4)}`
  },
  {
    id: 'FULL_BIRTH_DATE',
    name: '完整出生年月日明文',
    detect: (value, context) => BIRTH_PATH_REGEX.test(context.path) ? detectBirthDates(value) : [],
    mask: (value) => {
      const year = value.match(/(?:19|20)\d{2}/)?.[0] ?? '****';
      return `${year}-**-**`;
    }
  }
];
