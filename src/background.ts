import { isTextLikeMime } from './scanner/content';
import { compileRuleDefinitions, defaultRuleDefinitions } from './scanner/rules';
import { scanResponseBody } from './scanner/scan';
import type { Finding, RuleDefinition, RuleId, RuleInput, RuleSettings, ScanState } from './scanner/types';
import type { ExtensionEvent, ExtensionMessage, ExtensionResponse } from './shared/messages';
import { FINDINGS_ADDED, RULES_UPDATED, SCAN_STATE_UPDATED } from './shared/messages';

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
const RULES_KEY = 'rules-v2';

const states = new Map<number, ScanState>();
const responseMemory = new Map<number, Map<string, ResponseMeta>>();
const methodMemory = new Map<number, Map<string, string>>();
const intentionalDetach = new Set<number>();
let rulesCache: RuleDefinition[] | undefined;
let rulesMutation: Promise<void> = Promise.resolve();

const debuggee = (tabId: number): chrome.debugger.Debuggee => ({ tabId });
const stateKey = (tabId: number) => `${STATE_KEY_PREFIX}${tabId}`;
const methodKey = (tabId: number, requestId: string) => `${METHOD_KEY_PREFIX}${tabId}:${requestId}`;
const responseKey = (tabId: number, requestId: string) => `${RESPONSE_KEY_PREFIX}${tabId}:${requestId}`;

function defaultState(tabId: number): ScanState {
  return { tabId, attached: false, scannedResponses: 0 };
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

function normalizeInput(rule: RuleInput): RuleInput {
  return {
    name: rule.name.trim(),
    description: rule.description.trim(),
    expression: rule.expression.trim(),
    enabled: Boolean(rule.enabled)
  };
}

function validateRuleInput(rule: RuleInput, system = false): RuleInput {
  const normalized = normalizeInput(rule);
  if (!normalized.name) throw new Error('规则名称不能为空');
  if (normalized.name.length > 60) throw new Error('规则名称不能超过 60 个字符');
  if (!system) {
    if (!normalized.expression) throw new Error('正则表达式不能为空');
    try {
      new RegExp(normalized.expression, 'g');
    } catch (error) {
      throw new Error(`正则表达式无效：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return normalized;
}

async function loadRules(): Promise<RuleDefinition[]> {
  if (rulesCache) return rulesCache.map((rule) => ({ ...rule }));

  const stored = await chrome.storage.local.get([RULES_KEY, RULE_SETTINGS_KEY]);
  const persisted = stored[RULES_KEY];
  if (Array.isArray(persisted)) {
    rulesCache = (persisted as RuleDefinition[]).map((rule) => ({ ...rule }));
    return rulesCache.map((rule) => ({ ...rule }));
  }

  const legacySettings = (stored[RULE_SETTINGS_KEY] as Partial<RuleSettings> | undefined) ?? {};
  const defaults = defaultRuleDefinitions().map((rule) => ({
    ...rule,
    enabled: legacySettings[rule.id] ?? rule.enabled
  }));
  rulesCache = defaults;
  await chrome.storage.local.set({ [RULES_KEY]: defaults });
  return defaults.map((rule) => ({ ...rule }));
}

async function saveRules(rules: RuleDefinition[]): Promise<RuleDefinition[]> {
  rulesCache = rules.map((rule) => ({ ...rule }));
  await chrome.storage.local.set({ [RULES_KEY]: rulesCache });
  emit({ type: RULES_UPDATED, rules: rulesCache });
  return rulesCache.map((rule) => ({ ...rule }));
}

async function mutateRules(mutator: (rules: RuleDefinition[]) => RuleDefinition[]): Promise<RuleDefinition[]> {
  let result: RuleDefinition[] = [];
  const operation = rulesMutation.then(async () => {
    const current = await loadRules();
    result = await saveRules(mutator(current));
  });
  rulesMutation = operation.then(() => undefined, () => undefined);
  await operation;
  return result;
}

async function createRule(input: RuleInput): Promise<RuleDefinition[]> {
  const rule = validateRuleInput(input);
  const now = Date.now();
  return mutateRules((rules) => [
    ...rules,
    {
      id: `CUSTOM_${crypto.randomUUID()}`,
      name: rule.name,
      description: rule.description,
      type: 'regex',
      expression: rule.expression,
      enabled: rule.enabled,
      system: false,
      createdAt: now,
      updatedAt: now
    }
  ]);
}

async function updateRule(ruleId: RuleId, input: RuleInput): Promise<RuleDefinition[]> {
  return mutateRules((rules) => {
    const existing = rules.find((rule) => rule.id === ruleId);
    if (!existing) throw new Error('规则不存在');
    const nextInput = validateRuleInput(input, existing.system);
    return rules.map((rule) => rule.id !== ruleId ? rule : {
      ...rule,
      name: nextInput.name,
      description: nextInput.description,
      expression: existing.system ? rule.expression : nextInput.expression,
      enabled: nextInput.enabled,
      updatedAt: Date.now()
    });
  });
}

async function deleteRule(ruleId: RuleId): Promise<RuleDefinition[]> {
  return mutateRules((rules) => {
    if (!rules.some((rule) => rule.id === ruleId)) throw new Error('规则不存在');
    return rules.filter((rule) => rule.id !== ruleId);
  });
}

async function setRuleEnabled(ruleId: RuleId, enabled: boolean): Promise<RuleDefinition[]> {
  return mutateRules((rules) => {
    if (!rules.some((rule) => rule.id === ruleId)) throw new Error('规则不存在');
    return rules.map((rule) => rule.id === ruleId ? { ...rule, enabled, updatedAt: Date.now() } : rule);
  });
}

async function loadRuleSettings(): Promise<RuleSettings> {
  return Object.fromEntries((await loadRules()).map((rule) => [rule.id, rule.enabled]));
}

function sendCommand<T = unknown>(
  tabId: number,
  method: string,
  commandParams?: Record<string, unknown>
): Promise<T> {
  return chrome.debugger
    .sendCommand(debuggee(tabId), method, commandParams)
    .then((result) => result as T);
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
    if (!isTextLikeMime(meta.mimeType)) return;
    if (typeof encodedDataLength === 'number' && encodedDataLength > MAX_RESPONSE_BYTES) return;

    const result = await sendCommand<{ body: string; base64Encoded: boolean }>(
      tabId,
      'Network.getResponseBody',
      { requestId }
    );
    const body = result.base64Encoded ? decodeBase64Utf8(result.body) : result.body;
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) return;

    const runtimeRules = compileRuleDefinitions(await loadRules());
    const enabledRuleIds = new Set<RuleId>(runtimeRules.map((rule) => rule.id));
    const detections = scanResponseBody(body, enabledRuleIds, runtimeRules);
    const state = await loadState(tabId);
    if (!state.attached) return;

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
    await saveState({ ...state, scannedResponses: state.scannedResponses + 1, error: undefined });
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
    if (!isTextLikeMime(event.response.mimeType)) {
      void forgetRequest(tabId, event.requestId);
      return;
    }

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
          case 'GET_RULES': {
            sendResponse({ ok: true, kind: 'RULES', rules: await loadRules() });
            return;
          }
          case 'CREATE_RULE': {
            sendResponse({ ok: true, kind: 'RULES', rules: await createRule(message.rule) });
            return;
          }
          case 'UPDATE_RULE': {
            sendResponse({ ok: true, kind: 'RULES', rules: await updateRule(message.ruleId, message.rule) });
            return;
          }
          case 'DELETE_RULE': {
            sendResponse({ ok: true, kind: 'RULES', rules: await deleteRule(message.ruleId) });
            return;
          }
          case 'GET_RULE_SETTINGS': {
            sendResponse({ ok: true, kind: 'RULE_SETTINGS', settings: await loadRuleSettings() });
            return;
          }
          case 'SET_RULE_ENABLED': {
            sendResponse({ ok: true, kind: 'RULES', rules: await setRuleEnabled(message.ruleId, message.enabled) });
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
