import { complianceRules } from './rules';
import type { ComplianceRule, Detection, RuleId } from './types';

const MAX_DEPTH = 30;
const MAX_NODES = 50_000;

function scanString(
  value: string,
  path: string,
  detections: Detection[],
  enabledRuleIds: ReadonlySet<RuleId>,
  rules: ComplianceRule[],
  rawOnly = false
): void {
  for (const rule of rules) {
    if (!enabledRuleIds.has(rule.id)) continue;
    if (rawOnly && rule.scanRaw === false) continue;

    for (const match of rule.detect(value, { path })) {
      detections.push({
        ruleId: rule.id,
        ruleName: rule.name,
        path,
        rawValue: match
      });
    }
  }
}

function visit(
  node: unknown,
  path: string,
  detections: Detection[],
  enabledRuleIds: ReadonlySet<RuleId>,
  rules: ComplianceRule[],
  depth: number,
  budget: { count: number }
): void {
  if (depth > MAX_DEPTH || budget.count >= MAX_NODES) return;
  budget.count += 1;

  if (typeof node === 'string') {
    scanString(node, path, detections, enabledRuleIds, rules);
    return;
  }

  if (typeof node === 'number') {
    scanString(String(node), path, detections, enabledRuleIds, rules);
    return;
  }

  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      if (budget.count >= MAX_NODES) break;
      visit(node[index], `${path}[${index}]`, detections, enabledRuleIds, rules, depth + 1, budget);
    }
    return;
  }

  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (budget.count >= MAX_NODES) break;
      const childPath = /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
      visit(value, childPath, detections, enabledRuleIds, rules, depth + 1, budget);
    }
  }
}

function dedupe(detections: Detection[]): Detection[] {
  const seen = new Set<string>();
  return detections.filter((item) => {
    const key = `${item.ruleId}|${item.path}|${item.rawValue}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function appendRawFallback(
  body: string,
  detections: Detection[],
  enabledRuleIds: ReadonlySet<RuleId>,
  rules: ComplianceRule[]
): void {
  const raw: Detection[] = [];
  scanString(body, '$raw', raw, enabledRuleIds, rules, true);
  const alreadyFound = new Set(detections.map((item) => `${item.ruleId}|${item.rawValue}`));

  for (const detection of raw) {
    if (!alreadyFound.has(`${detection.ruleId}|${detection.rawValue}`)) detections.push(detection);
  }
}

export function scanResponseBody(
  body: string,
  enabledRuleIds: ReadonlySet<RuleId> = new Set(complianceRules.map((rule) => rule.id)),
  rules: ComplianceRule[] = complianceRules
): Detection[] {
  if (!body.trim()) return [];

  const detections: Detection[] = [];
  try {
    const parsed = JSON.parse(body) as unknown;
    visit(parsed, '$', detections, enabledRuleIds, rules, 0, { count: 0 });
    appendRawFallback(body, detections, enabledRuleIds, rules);
  } catch {
    scanString(body, '$', detections, enabledRuleIds, rules);
  }

  return dedupe(detections);
}
