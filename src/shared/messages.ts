import type { Finding, RuleDefinition, RuleId, RuleInput, RuleSettings, ScanState } from '../scanner/types';

export type ExtensionMessage =
  | { type: 'START_SCAN'; tabId: number }
  | { type: 'STOP_SCAN'; tabId: number }
  | { type: 'GET_STATE'; tabId: number }
  | { type: 'GET_RULES' }
  | { type: 'CREATE_RULE'; rule: RuleInput }
  | { type: 'UPDATE_RULE'; ruleId: RuleId; rule: RuleInput }
  | { type: 'DELETE_RULE'; ruleId: RuleId }
  | { type: 'GET_RULE_SETTINGS' }
  | { type: 'SET_RULE_ENABLED'; ruleId: RuleId; enabled: boolean };

export type ExtensionResponse =
  | { ok: true; kind: 'SCAN_STATE'; state: ScanState }
  | { ok: true; kind: 'RULES'; rules: RuleDefinition[] }
  | { ok: true; kind: 'RULE_SETTINGS'; settings: RuleSettings }
  | { ok: false; error: string };

export const SCAN_STATE_UPDATED = 'SCAN_STATE_UPDATED';
export const FINDINGS_ADDED = 'FINDINGS_ADDED';
export const RULES_UPDATED = 'RULES_UPDATED';

export type ExtensionEvent =
  | { type: typeof SCAN_STATE_UPDATED; state: ScanState }
  | { type: typeof FINDINGS_ADDED; tabId: number; findings: Finding[] }
  | { type: typeof RULES_UPDATED; rules: RuleDefinition[] };
