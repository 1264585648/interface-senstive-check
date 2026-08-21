export type RuleId = 'CN_MOBILE' | 'CN_ID_CARD' | 'FULL_BIRTH_DATE';

export interface DetectionContext {
  path: string;
}

export interface Detection {
  ruleId: RuleId;
  ruleName: string;
  path: string;
  maskedValue: string;
}

export interface ComplianceRule {
  id: RuleId;
  name: string;
  detect(value: string, context: DetectionContext): string[];
  mask(value: string): string;
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
  findings: Finding[];
  error?: string;
}
