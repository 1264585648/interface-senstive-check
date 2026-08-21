import { scanResponseBody } from './scanner/scan';
import { complianceRules } from './scanner/rules';
import type { Finding, RuleId, RuleSettings, ScanState } from './scanner/types';
import type { ExtensionEvent, ExtensionMessage, ExtensionResponse } from './shared/messages';
import { FINDINGS_ADDED, SCAN_STATE_UPDATED } from './shared/messages';

type ResponseMeta = {
  requestId: string;
  url: string;
  method: string;
  status: number;
  mimeType: string;
};

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const STATE_KEY_PREFIX = 'scan-state:';
const METHOD_KEY_PREFIX = 'pending-method:';
const RESPONSE_KEY_PREFIX = 'pending-response:';
const RULE_SETTINGS_KEY = 'rule-settings';

const states = new Map<number, ScanState>();
const responseMemory = new Map<number, Map<string, ResponseMeta>>();
const methodMemory = new Map<number, Map<string, string>>();
const intentionalDetach = new Set<number>();

const debuggee = (tabId: number): chrome.debugger.Debuggee => ({ tabId });
const stateKey = (tabId: number) => `${STATE_KEY_PREFIX}${tabId}`;
const methodKey = (tabId: number, requestId: string) => `${METHOD_KEY_PREFIX}${tabId}:${requestId}`;
const responseKey = (tabId: number, requestId: string) => `${RESPONSE_KEY_PREFIX}${tabId}:${requestId}`;

function defaultState(tabId: number): ScanState {
  return { tabId, attached: false, scannedResponses: 0 };
}

function defaultRuleSettings(): RuleSettings {
  return Object.fromEntries(complianceRules.map((rule) => [rule.id, true])) as RuleSettings;
}

function emit(event: ExtensionEvent): void {
  chrome.runtime.sendMessage(event).catch(() => undefined);
}

async function loadState(tabId: number): Promise<ScanState> {
  const memory = states.get(tabId);
  if (memory) return memory;

  const key = stateKey(tabId);
  const stored = await chrome.storage.session.get(key);
  const state = (stored[key] as ScanState | undefined) ?? defaultState(tabId);
  states.set(tabId, state);
  return state;
}

async function saveState(state: ScanState): Promise<void> {
  states.set(state.tabId, state);
  await chrome.storage.session.set({ [stateKey(state.tabId)]: state });
  emit({ type: SCAN_STATE_UPDATED, state });
}

async function loadRuleSettings(): Promise<RuleSettings> {
  const stored = await chrome.storage.local.get(RULE_SETTINGS_KEY);
  return {
    ...defaultRuleSettings(),
    ...((stored[RULE_SETTINGS_KEY] as Partial<RuleSettings> | undefined) ?? {})
  };
}

async function setRuleEnabled(ruleId: RuleId, enabled: boolean): Promise<RuleSettings> {
  const settings = await loadRuleSettings();
  settings[ruleId] = enabled;
  await chrome.storage.local.set({ [RULE_SETTINGS_KEY]: settings });
  return settings;
}

function sendCommand<T = unknown>(tabId: number, method: string, commandParams?: object): Promise<T> {
  return chrome.debugger.sendCommand(debuggee(tabId), method, commandParams) as Promise<T>;
}

function decodeBase64Utf8(input: string): string {
  const binary = atob(input);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const safePath = url.pathname
      .split('/')
      .map((segment) => {
        const decoded = (() => {
          try {
            return decodeURIComponent(segment);
          } catch {
            return segment;
          }
        })();
        const digitCount = (decoded.match(/\d/g) ?? []).length;
        return digitCount >= 8 || decoded.length > 32 ? ':redacted' : decoded;
      })
      .join('/');
    return `${url.origin}${safePath}`;
  } catch {
    return rawUrl.split(/[?#]/, 1)[0];
  }
}

async function findPageTarget(tabId: number): Promise<chrome.debugger.TargetInfo | undefined> {
  const targets = await chrome.debugger.getTargets();
  return targets.find((target) => target.tabId === tabId && target.type === 'page');
}

async function validateTarget(tabId: number): Promise<chrome.debugger.TargetInfo> {
  const target = await findPageTarget(tabId);
  if (!target || !/^https?:\/\//i.test(target.url)) {
    throw new Error('当前页面不支持采集，请打开普通 HTTP/HTTPS 页面后重试。');
  }
  return target;
}

async function clearPendingForTab(tabId: number): Promise<void> {
  responseMemory.delete(tabId);
  methodMemory.delete(tabId);

  const all = await chrome.storage.session.get(null);
  const methodPrefix = `${METHOD_KEY_PREFIX}${tabId}:`;
  const responsePrefix = `${RESPONSE_KEY_PREFIX}${tabId}:`;
  const keys = Object.keys(all).filter((key) => key.startsWith(methodPrefix) || key.startsWith(responsePrefix));
  if (keys.length > 0) await chrome.storage.session.remove(keys);
}

async function rememberMethod(tabId: number, requestId: string, method: string): Promise<void> {
  const methods = methodMemory.get(tabId) ?? new Map<string, string>();
  methods.set(requestId, method);
  methodMemory.set(tabId, methods);
  await chrome.storage.session.set({ [methodKey(tabId, requestId)]: method });
}

async function readMethod(tabId: number, requestId: string): Promise<string> {
  const memory = methodMemory.get(tabId)?.get(requestId);
  if (memory) return memory;

  const key = methodKey(tabId, requestId);
  const stored = await chrome.storage.session.get(key);
  return (stored[key] as string | undefined) ?? 'UNKNOWN';
}

async function rememberResponse(tabId: number, meta: ResponseMeta): Promise<void> {
  const responses = responseMemory.get(tabId) ?? new Map<string, ResponseMeta>();
  responses.set(meta.requestId, meta);
  responseMemory.set(tabId, responses);
  await chrome.storage.session.set({ [responseKey(tabId, meta.requestId)]: meta });
}

async function readResponse(tabId: number, requestId: string): Promise<ResponseMeta | undefined> {
  const memory = responseMemory.get(tabId)?.get(requestId);
  if (memory) return memory;

  const key = responseKey(tabId, requestId);
  const stored = await chrome.storage.session.get(key);
  return stored[key] as ResponseMeta | undefined;
}

async function forgetRequest(tabId: number, requestId: string): Promise<void> {
  methodMemory.get(tabId)?.delete(requestId);
  responseMemory.get(tabId)?.delete(requestId);
  await chrome.storage.session.remove([methodKey(tabId, requestId), responseKey(tabId, requestId)]);
}

async function startScan(tabId: number): Promise<ScanState> {
  const target = await validateTarget(tabId);
  const current = await loadState(tabId);

  await clearPendingForTab(tabId);

  if (!current.attached) {
    if (target.attached) {
      throw new Error('当前页面已被 DevTools 或其他调试工具占用，请关闭后重试。');
    }
    await chrome.debugger.attach(debuggee(tabId), '1.3');
    await sendCommand(tabId, 'Network.enable');
  } else {
    // A Chrome 114–117 service worker may have restarted while the debugger
    // session remained attached. Re-enabling Network is safe and verifies it.
    await sendCommand(tabId, 'Network.enable');
  }

  const next: ScanState = {
    tabId,
    attached: true,
    pageUrl: sanitizeUrl(target.url),
    scannedResponses: 0
  };
  await saveState(next);
  return next;
}

async function stopScan(tabId: number): Promise<ScanState> {
  const state = await loadState(tabId);
  if (state.attached) {
    try {
      intentionalDetach.add(tabId);
      await chrome.debugger.detach(debuggee(tabId));
    } catch {
      intentionalDetach.delete(tabId);
    }
  }

  await clearPendingForTab(tabId);
  const next = { ...state, attached: false };
  await saveState(next);
  return next;
}

async function processFinishedRequest(tabId: number, requestId: string, encodedDataLength?: number): Promise<void> {
  const meta = await readResponse(tabId, requestId);
  if (!meta) {
    await forgetRequest(tabId, requestId);
    return;
  }

  try {
    if (typeof encodedDataLength === 'number' && encodedDataLength > MAX_RESPONSE_BYTES) return;

    const result = await sendCommand<{ body: string; base64Encoded: boolean }>(
      tabId,
      'Network.getResponseBody',
      { requestId }
    );
    const body = result.base64Encoded ? decodeBase64Utf8(result.body) : result.body;
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) return;

    const settings = await loadRuleSettings();
    const enabledRuleIds = new Set<RuleId>(
      complianceRules.filter((rule) => settings[rule.id]).map((rule) => rule.id)
    );
    const detections = scanResponseBody(body, enabledRuleIds);
    const now = Date.now();
    const findings: Finding[] = detections.map((detection, index) => ({
      ...detection,
      id: `${requestId}:${detection.ruleId}:${detection.path}:${index}`,
      tabId,
      requestId,
      url: meta.url,
      method: meta.method,
      status: meta.status,
      mimeType: meta.mimeType,
      detectedAt: now
    }));

    if (findings.length > 0) emit({ type: FINDINGS_ADDED, tabId, findings });

    const state = await loadState(tabId);
    if (state.attached) {
      await saveState({ ...state, scannedResponses: state.scannedResponses + 1, error: undefined });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('No resource with given identifier found')) {
      const state = await loadState(tabId);
      await saveState({ ...state, error: `读取响应失败：${message}` });
    }
  } finally {
    await forgetRequest(tabId, requestId);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  states.delete(tabId);
  intentionalDetach.delete(tabId);
  void (async () => {
    await clearPendingForTab(tabId);
    await chrome.storage.session.remove(stateKey(tabId));
  })();
});

chrome.debugger.onDetach.addListener((source) => {
  if (typeof source.tabId !== 'number') return;
  const tabId = source.tabId;
  if (intentionalDetach.delete(tabId)) return;

  void (async () => {
    await clearPendingForTab(tabId);
    const state = await loadState(tabId);
    await saveState({
      ...state,
      attached: false,
      error: '采集已中断。当前页面可能打开了 DevTools，关闭后可重新开始采集。'
    });
  })();
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (typeof source.tabId !== 'number') return;
  const tabId = source.tabId;

  if (method === 'Network.requestWillBeSent') {
    const event = params as {
      requestId: string;
      type?: string;
      request: { method: string };
    };
    if (event.type && !['XHR', 'Fetch'].includes(event.type)) return;
    void rememberMethod(tabId, event.requestId, event.request.method);
    return;
  }

  if (method === 'Network.responseReceived') {
    const event = params as {
      requestId: string;
      type: string;
      response: { url: string; status: number; mimeType: string };
    };
    if (!['XHR', 'Fetch'].includes(event.type)) return;

    void (async () => {
      const requestMethod = await readMethod(tabId, event.requestId);
      await rememberResponse(tabId, {
        requestId: event.requestId,
        url: sanitizeUrl(event.response.url),
        method: requestMethod,
        status: event.response.status,
        mimeType: event.response.mimeType
      });
    })();
    return;
  }

  if (method === 'Network.loadingFailed') {
    const event = params as { requestId: string };
    void forgetRequest(tabId, event.requestId);
    return;
  }

  if (method === 'Network.loadingFinished') {
    const event = params as { requestId: string; encodedDataLength?: number };
    void processFinishedRequest(tabId, event.requestId, event.encodedDataLength);
  }
});

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse: (response: ExtensionResponse) => void) => {
    if (sender.id && sender.id !== chrome.runtime.id) return false;

    void (async () => {
      try {
        switch (message.type) {
          case 'START_SCAN': {
            if (!Number.isInteger(message.tabId)) throw new Error('无效的 tabId');
            const state = await startScan(message.tabId);
            sendResponse({ ok: true, kind: 'SCAN_STATE', state });
            return;
          }
          case 'STOP_SCAN': {
            if (!Number.isInteger(message.tabId)) throw new Error('无效的 tabId');
            const state = await stopScan(message.tabId);
            sendResponse({ ok: true, kind: 'SCAN_STATE', state });
            return;
          }
          case 'GET_STATE': {
            if (!Number.isInteger(message.tabId)) throw new Error('无效的 tabId');
            const state = await loadState(message.tabId);
            sendResponse({ ok: true, kind: 'SCAN_STATE', state });
            return;
          }
          case 'GET_RULE_SETTINGS': {
            const settings = await loadRuleSettings();
            sendResponse({ ok: true, kind: 'RULE_SETTINGS', settings });
            return;
          }
          case 'SET_RULE_ENABLED': {
            if (!complianceRules.some((rule) => rule.id === message.ruleId)) throw new Error('未知规则');
            const settings = await setRuleEnabled(message.ruleId, message.enabled);
            sendResponse({ ok: true, kind: 'RULE_SETTINGS', settings });
            return;
          }
          default:
            throw new Error('不支持的消息类型');
        }
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  }
);
