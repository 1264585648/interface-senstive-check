import type { FindingGroup } from './types';
import type { Finding } from '../../scanner/types';

export function groupFindings(findings: Finding[]): FindingGroup[] {
  const map = new Map<string, FindingGroup>();

  for (const finding of findings) {
    const parsed = new URL(finding.url);
    const url = `${parsed.origin}${parsed.pathname}`;
    const key = `${finding.method}:${url}`;
    const current = map.get(key) ?? {
      key,
      method: finding.method,
      url,
      rules: [],
      locations: [],
      count: 0
    };

    current.count += 1;
    if (!current.rules.includes(finding.ruleName)) current.rules.push(finding.ruleName);
    if (!current.locations.includes(finding.path)) current.locations.push(finding.path);
    map.set(key, current);
  }

  return [...map.values()];
}
