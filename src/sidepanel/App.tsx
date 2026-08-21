import { useEffect, useMemo, useState } from 'react';
import { complianceRules } from '../scanner/rules';
import type { Finding, RuleId, RuleSettings, ScanState } from '../scanner/types';
import type { ExtensionEvent, ExtensionMessage, ExtensionResponse } from '../shared/messages';
import { FINDINGS_ADDED, SCAN_STATE_UPDATED } from '../shared/messages';

async function currentTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (typeof tab?.id !== 'number') throw new Error('无法获取当前标签页。');
  return tab.id;
}

async function send(message: ExtensionMessage): Promise<ExtensionResponse> {
  return chrome.runtime.sendMessage(message) as Promise<ExtensionResponse>;
}

async function getScanState(tabId: number): Promise<ScanState> {
  const response = await send({ type: 'GET_STATE', tabId });
  if (!response.ok) throw new Error(response.error);
  if (response.kind !== 'SCAN_STATE') throw new Error('后台返回了错误的数据类型。');
  return response.state;
}

async function getRuleSettings(): Promise<RuleSettings> {
  const response = await send({ type: 'GET_RULE_SETTINGS' });
  if (!response.ok) throw new Error(response.error);
  if (response.kind !== 'RULE_SETTINGS') throw new Error('后台返回了错误的数据类型。');
  return response.settings;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatApi(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname || '/';
  } catch {
    return url;
  }
}

function ruleClass(ruleId: RuleId): string {
  if (ruleId === 'CN_MOBILE') return 'phone';
  if (ruleId === 'CN_ID_CARD') return 'id-card';
  return 'birth-date';
}

function RuleIcon({ ruleId }: { ruleId: RuleId }) {
  if (ruleId === 'CN_MOBILE') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="7" y="3" width="10" height="18" rx="2" />
        <path d="M10 6h4M10 18h4" />
      </svg>
    );
  }
  if (ruleId === 'CN_ID_CARD') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="8" cy="11" r="2" />
        <path d="M5.5 16c.7-1.7 1.6-2.5 2.5-2.5s1.8.8 2.5 2.5M13 10h5M13 14h5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M4 9h16" />
    </svg>
  );
}

export function App() {
  const [tabId, setTabId] = useState<number>();
  const [state, setState] = useState<ScanState>();
  const [rules, setRules] = useState<RuleSettings>();
  const [findingsByTab, setFindingsByTab] = useState<Record<number, Finding[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const findings = useMemo(
    () => (typeof tabId === 'number' ? findingsByTab[tabId] ?? [] : []),
    [findingsByTab, tabId]
  );

  useEffect(() => {
    let disposed = false;

    const loadTab = async (id?: number) => {
      try {
        const activeId = id ?? await currentTabId();
        const nextState = await getScanState(activeId);
        if (disposed) return;
        setTabId(activeId);
        setState(nextState);
        setError(undefined);
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };

    void Promise.all([
      loadTab(),
      getRuleSettings().then((settings) => {
        if (!disposed) setRules(settings);
      })
    ]).catch((cause) => {
      if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
    });

    const onActivated = (activeInfo: { tabId: number }) => {
      void loadTab(activeInfo.tabId);
    };
    chrome.tabs.onActivated.addListener(onActivated);

    return () => {
      disposed = true;
      chrome.tabs.onActivated.removeListener(onActivated);
    };
  }, []);

  useEffect(() => {
    const listener = (message: ExtensionEvent) => {
      if (message.type === SCAN_STATE_UPDATED) {
        if (message.state.tabId === tabId) setState(message.state);
        return;
      }

      if (message.type === FINDINGS_ADDED) {
        setFindingsByTab((current) => ({
          ...current,
          [message.tabId]: [
            ...message.findings,
            ...(current[message.tabId] ?? [])
          ].slice(0, 1000)
        }));
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [tabId]);

  async function run(type: 'START_SCAN' | 'STOP_SCAN') {
    if (typeof tabId !== 'number') return;
    setBusy(true);
    setError(undefined);

    try {
      const response = await send({ type, tabId });
      if (!response.ok) throw new Error(response.error);
      if (response.kind !== 'SCAN_STATE') throw new Error('后台返回了错误的数据类型。');
      setState(response.state);

      if (type === 'START_SCAN') {
        setFindingsByTab((current) => ({ ...current, [tabId]: [] }));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function toggleRule(ruleId: RuleId, enabled: boolean) {
    setError(undefined);
    try {
      const response = await send({ type: 'SET_RULE_ENABLED', ruleId, enabled });
      if (!response.ok) throw new Error(response.error);
      if (response.kind !== 'RULE_SETTINGS') throw new Error('后台返回了错误的数据类型。');
      setRules(response.settings);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const statusText = state?.attached
    ? '采集中'
    : (state?.scannedResponses ?? 0) > 0
      ? '已结束'
      : '未采集';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M12 2.5 19 5v5.6c0 4.7-2.8 8.8-7 10.9-4.2-2.1-7-6.2-7-10.9V5l7-2.5Z" fill="currentColor" />
              <path d="m9.2 12 1.7 1.7 4-4" stroke="#2F6DF6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <h1>接口敏感信息检测</h1>
            <p>采集当前页面接口响应，检查是否存在敏感信息</p>
          </div>
        </div>
        <div className={`status-chip ${state?.attached ? 'collecting' : ''}`}>
          <span className="status-dot" />
          {statusText}
        </div>
      </header>

      <main className="layout">
        <aside className="left-panel">
          <section className="rules-section">
            <h2>规则列表</h2>
            <div className="rule-list">
              {complianceRules.map((rule) => (
                <div className="rule-card" key={rule.id}>
                  <label className="switch" title={`启用 ${rule.name}`}>
                    <input
                      type="checkbox"
                      checked={rules?.[rule.id] ?? true}
                      onChange={(event) => void toggleRule(rule.id, event.target.checked)}
                    />
                    <span className="slider" />
                  </label>
                  <span className="rule-icon"><RuleIcon ruleId={rule.id} /></span>
                  <div className="rule-content">
                    <strong>{rule.name}</strong>
                    <span>{rule.description}</span>
                    <code>{rule.expression}</code>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="control-card">
            <h2>采集控制</h2>
            <div className="control-buttons">
              <button
                className="start-button"
                disabled={busy || state?.attached}
                onClick={() => void run('START_SCAN')}
              >
                <span className="play-icon">▶</span>
                开始采集
              </button>
              <button
                className="stop-button"
                disabled={busy || !state?.attached}
                onClick={() => void run('STOP_SCAN')}
              >
                <span className="stop-icon">■</span>
                结束采集
              </button>
            </div>
          </section>

          <div className="privacy-note">
            <span className="info-icon">i</span>
            <p>命中结果直接展示接口返回明文，仅用于当前采集会话确认；不会持久化保存或上传。</p>
          </div>

          {(error || state?.error) && <div className="error-message">{error || state?.error}</div>}
        </aside>

        <section className="results-panel">
          <h2>检测结果</h2>
          <div className="results-card">
            <table>
              <thead>
                <tr>
                  <th className="time-column">时间</th>
                  <th className="api-column">接口</th>
                  <th className="type-column">类型</th>
                  <th className="value-column">敏感信息（明文）</th>
                  <th>位置</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((finding) => (
                  <tr key={finding.id}>
                    <td>{formatTime(finding.detectedAt)}</td>
                    <td className="api-cell">
                      <span className={`method ${finding.method.toLowerCase()}`}>{finding.method}</span>
                      <span>{formatApi(finding.url)}</span>
                    </td>
                    <td>
                      <span className={`rule-badge ${ruleClass(finding.ruleId)}`}>{finding.ruleName}</span>
                    </td>
                    <td><code className="raw-value">{finding.rawValue}</code></td>
                    <td><code className="json-path">{finding.path}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>

            {findings.length === 0 && (
              <div className="empty-state">
                <div className="empty-icon">✓</div>
                <strong>暂无敏感信息</strong>
                <span>{state?.attached ? '正在采集当前页面的 Fetch / XHR 响应' : '点击开始采集后，正常操作目标网页即可'}</span>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
