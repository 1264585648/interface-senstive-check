import { scanResponseBody } from './scanner/scan';
import type { Finding, ScanState } from './scanner/types';
import type { ExtensionMessage, ExtensionResponse } from './shared/messages';
import { STATE_UPDATED } from './shared/messages';

type ResponseMeta = {
  requestId: string;
  url: string;
  method: string;
  status: number;
  mimeType: string;
};

const states = new Map<number, ScanState>();
const responses = new Map<number, Map<string, ResponseMeta>>();
const requestMethods = new Map<number, Map<string, string>>();
const debuggee = (tabId: number): chrome.debugger.Debuggee => ({ tabId });

function defaultState(tabId: number): ScanState {
  return { tabId, attached: false, scannedResponses: 0, findings: [] };
}

async function loadState(tabId: number): Promise<ScanState> {
  const memory = states.get(tabId);
  if (memory) return memory;
  const key = `scan-state:${tabId}`;
  const stored = await chrome.storage.session.get(key);
  const state = (stored[key] as ScanState | undefined) ?? defaultState(tabId);
  states.set(tabId, state);
  return state;
}

async function saveState(state: ScanState): Promise<void> {
  states.set(state.tabId, state);
  await chrome.storage.session.set({ [`scan-state:${state.tabId}`]: state });
  chrome.runtime.sendMessage({ type: STATE_UPDATED, state }).catch(() => undefined);
}

function sendCommand<T = unknown>(tabId: number, method: string, commandParams?: object): Promise<T> {
  return chrome.debugger.sendCommand(debuggee(tabId), method, commandParams) as Promise<T>;
}

function decodeBase64Utf8(input: string): string {
  const binary = atob(input);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function startScan(tabId: number): Promise<ScanState> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
    throw new Error('当前页面不支持调试，请打开普通 http/https 网页后重试。');
  }

  const state = await loadState(tabId);
  if (!state.attached) {
    await chrome.debugger.attach(debuggee(tabId), '1.3');
    await sendCommand(tabId, 'Network.enable', {
      maxTotalBufferSize: 100_000_000,
      maxResourceBufferSize: 10_000_000
    });
  }

  const next = { ...state, attached: true, pageUrl: tab.url, error: undefined };
  responses.set(tabId, responses.get(tabId) ?? new Map());
  requestMethods.set(tabId, requestMethods.get(tabId) ?? new Map());
  await saveState(next);
  return next;
}

async function stopScan(tabId: number): Promise<ScanState> {
  const state = await loadState(tabId);
  if (state.attached) {
    try {
      await chrome.debugger.detach(debuggee(tabId));
    } catch {
      // Already detached by Chrome/DevTools.
    }
  }
  responses.delete(tabId);
  requestMethods.delete(tabId);
  const next = { ...state, attached: false };
  await saveState(next);
  return next;
}

async function clearFindings(tabId: number): Promise<ScanState> {
  const state = await loadState(tabId);
  const next = { ...state, scannedResponses: 0, findings: [] };
  await saveState(next);
  return next;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

chrome.debugger.onDetach.addListener((source) => {
  if (typeof source.tabId !== 'number') return;
  void (async () => {
    const state = await loadState(source.tabId!);
    await saveState({
      ...state,
      attached: false,
      error: '调试会话已断开；如果打开了 DevTools，请关闭后重新开始扫描。'
    });
  })();
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (typeof source.tabId !== 'number') return;
  const tabId = source.tabId;

  if (method === 'Network.requestWillBeSent') {
    const event = params as { requestId: string; request: { method: string } };
    const methods = requestMethods.get(tabId) ?? new Map<string, string>();
    methods.set(event.requestId, event.request.method);
    requestMethods.set(tabId, methods);
    return;
  }

  if (method === 'Network.responseReceived') {
    const event = params as {
      requestId: string;
      type: string;
      response: { url: string; status: number; mimeType: string };
    };
    if (!['XHR', 'Fetch'].includes(event.type)) return;

    const map = responses.get(tabId) ?? new Map<string, ResponseMeta>();
    map.set(event.requestId, {
      requestId: event.requestId,
      url: event.response.url,
      method: requestMethods.get(tabId)?.get(event.requestId) ?? 'UNKNOWN',
      status: event.response.status,
      mimeType: event.response.mimeType
    });
    responses.set(tabId, map);
    return;
  }

  if (method === 'Network.loadingFinished') {
    const event = params as { requestId: string };
    const meta = responses.get(tabId)?.get(event.requestId);
    if (!meta) return;

    void (async () => {
      try {
        const result = await sendCommand<{ body: string; base64Encoded: boolean }>(
          tabId,
          'Network.getResponseBody',
          { requestId: event.requestId }
        );
        const body = result.base64Encoded ? decodeBase64Utf8(result.body) : result.body;
        const detections = scanResponseBody(body);
        const state = await loadState(tabId);
        const now = Date.now();
        const additions: Finding[] = detections.map((detection, index) => ({
          ...detection,
          id: `${event.requestId}:${detection.ruleId}:${detection.path}:${index}`,
          tabId,
          requestId: event.requestId,
          url: meta.url,
          method: meta.method,
          status: meta.status,
          mimeType: meta.mimeType,
          detectedAt: now
        }));

        await saveState({
          ...state,
          scannedResponses: state.scannedResponses + 1,
          findings: [...additions, ...state.findings].slice(0, 1000),
          error: undefined
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('No resource with given identifier found')) {
          const state = await loadState(tabId);
          await saveState({ ...state, error: `读取响应失败：${message}` });
        }
      } finally {
        responses.get(tabId)?.delete(event.requestId);
        requestMethods.get(tabId)?.delete(event.requestId);
      }
    })();
  }
});

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse: (response: ExtensionResponse) => void) => {
    void (async () => {
      try {
        let state: ScanState;
        switch (message.type) {
          case 'START_SCAN':
            state = await startScan(message.tabId);
            break;
          case 'STOP_SCAN':
            state = await stopScan(message.tabId);
            break;
          case 'CLEAR_FINDINGS':
            state = await clearFindings(message.tabId);
            break;
          case 'GET_STATE':
            state = await loadState(message.tabId);
            break;
          default:
            throw new Error('不支持的消息类型');
        }
        sendResponse({ ok: true, state });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  }
);
