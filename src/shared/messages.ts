import type { ScanState } from '../scanner/types';

export type ExtensionMessage =
  | { type: 'START_SCAN'; tabId: number }
  | { type: 'STOP_SCAN'; tabId: number }
  | { type: 'CLEAR_FINDINGS'; tabId: number }
  | { type: 'GET_STATE'; tabId: number };

export type ExtensionResponse =
  | { ok: true; state: ScanState }
  | { ok: false; error: string };

export const STATE_UPDATED = 'STATE_UPDATED';
