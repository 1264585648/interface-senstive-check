import { complianceRules } from './rules';
import type { Detection } from './types';

const MAX_DEPTH = 30;
const MAX_NODES = 50_000;

function scanString(value: string, path: string, detections: Detection[], rawOnly = false): void {
  for (const rule of complianceRules) {
    if (rawOnly && rule.id === 'FULL_BIRTH_DATE') continue;
    for (const match of rule.detect(value, { path })) {
      detections.push({
        ruleId: rule.id,
        ruleName: rule.name,
        path,
        maskedValue: rule.mask(match)
      });
    }
  }
}

function visit(node: unknown, path: string, detections: Detection[], depth: number, budget: { count: number }): void {
  if (depth > MAX_DEPTH || budget.count++ > MAX_NODES) return;

  if (typeof node === 'string') {
    scanString(node, path, detections);
    return;
  }

  if (typeof node === 'number') {
    scanString(String(node), path, detections);
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((item, index) => visit(item, `${path}[${index}]`, detections, depth + 1, budget));
    return;
  }

  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const childPath = /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
      visit(value, childPath, detections, depth + 1, budget);
    }
  }
}

function dedupe(detections: Detection[]): Detection[] {
  const seen = new Set<string>();
  return detections.filter((item) => {
    const key = `${item.ruleId}|${item.path}|${item.maskedValue}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function appendRawFallback(body: string, detections: Detection[]): void {
  const raw: Detection[] = [];
  scanString(body, '$raw', raw, true);
  const alreadyFound = new Set(detections.map((item) => `${item.ruleId}|${item.maskedValue}`));
  for (const detection of raw) {
    if (!alreadyFound.has(`${detection.ruleId}|${detection.maskedValue}`)) detections.push(detection);
  }
}

export function scanResponseBody(body: string): Detection[] {
  if (!body.trim()) return [];

  const detections: Detection[] = [];
  try {
    const parsed = JSON.parse(body) as unknown;
    visit(parsed, '$', detections, 0, { count: 0 });
    // Also scan raw JSON text for universal numeric identifiers. This catches values
    // such as an unquoted 18-digit ID card that JSON.parse would round as a Number.
    appendRawFallback(body, detections);
  } catch {
    scanString(body, '$', detections);
  }

  return dedupe(detections);
}
