export type RuleId = string;

export type RuleType = 'builtin' | 'regex';

export interface DetectionContext {
  path: string;
}

export interface Detection {
  ruleId: RuleId;
  ruleName: string;
  path: string;
  rawValue: string;
}

export interface ComplianceRule {
  id: RuleId;
  name: string;
  description: string;
  expression: string;
  scanRaw?: boolean;
  detect(value: string, context: DetectionContext): string[];
}

export interface RuleDefinition {
  id: RuleId;
  name: string;
  description: string;
  type: RuleType;
  expression: string;
  enabled: boolean;
  system: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface RuleInput {
  name: string;
  description: string;
  expression: string;
  enabled: boolean;
}

export type ScanLimitReason = 'max-depth' | 'max-nodes';

export interface ResponseScanResult {
  detections: Detection[];
  truncated: boolean;
  reasons: ScanLimitReason[];
}

export interface Finding extends Detection {
  id: string;
  tabId: number;
  requestId: string;
  url: string;
  method: string;
  status: number;
  mimeType: string;
  detectedAt: number;
}

export interface ScanState {
  tabId: number;
  attached: boolean;
  pageUrl?: string;
  scannedResponses: number;
  incompleteResponses: number;
  warning?: string;
  error?: string;
}

export type RuleSettings = Record<RuleId, boolean>;
