import type { FindingGroup } from './types';

export function exportFindingGroupsCsv(groups: FindingGroup[]): string {
  const rows = [['接口', '位置']];

  for (const group of groups) {
    for (const location of group.locations) {
      rows.push([`${group.method} ${group.url}`, location]);
    }
  }

  return rows.map((row) => row.map((item) => `"${item.replaceAll('"', '""')}"`).join(',')).join('\n');
}
