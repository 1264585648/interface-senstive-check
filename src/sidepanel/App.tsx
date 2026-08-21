import { useEffect, useMemo, useState } from 'react';
import type { Finding, ScanState } from '../scanner/types';
import type { ExtensionMessage, ExtensionResponse } from '../shared/messages';
import { STATE_UPDATED } from '../shared/messages';

async function currentTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (typeof tab?.id !== 'number') throw new Error('无法获取当前标签页。');
  return tab.id;
}

async function send(message: ExtensionMessage): Promise<ScanState> {
  const response = (await chrome.runtime.sendMessage(message)) as ExtensionResponse;
  if (!response.ok) throw new Error(response.error);
  return response.state;
}

function FindingCard({ finding }: { finding: Finding }) {
  return (
    <article className="finding-card">
      <div className="finding-head">
        <span className="fail-pill">FAIL</span>
        <strong>{finding.ruleName}</strong>
      </div>
      <div className="url" title={finding.url}>{finding.method} {finding.url}</div>
      <dl>
        <div><dt>位置</dt><dd>{finding.path}</dd></div>
        <div><dt>证据</dt><dd><code>{finding.maskedValue}</code></dd></div>
        <div><dt>状态</dt><dd>{finding.status} · {finding.mimeType || 'unknown'}</dd></div>
      </dl>
    </article>
  );
}

export function App() {
  const [tabId, setTabId] = useState<number>();
  const [state, setState] = useState<ScanState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let disposed = false;

    const loadTab = async (id?: number) => {
      try {
        const activeId = id ?? await currentTabId();
        if (disposed) return;
        setTabId(activeId);
        setState(await send({ type: 'GET_STATE', tabId: activeId }));
        setError(undefined);
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : String(e));
      }
    };

    void loadTab();
    const onActivated = (activeInfo: chrome.tabs.TabActiveInfo) => { void loadTab(activeInfo.tabId); };
    chrome.tabs.onActivated.addListener(onActivated);

    return () => {
      disposed = true;
      chrome.tabs.onActivated.removeListener(onActivated);
    };
  }, []);

  useEffect(() => {
    const listener = (message: { type?: string; state?: ScanState }) => {
      if (message.type === STATE_UPDATED && message.state?.tabId === tabId) setState(message.state);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [tabId]);

  const grouped = useMemo(() => {
    const map = new Map<string, number>();
    for (const finding of state?.findings ?? []) map.set(finding.ruleId, (map.get(finding.ruleId) ?? 0) + 1);
    return [...map.entries()];
  }, [state]);

  async function run(type: 'START_SCAN' | 'STOP_SCAN' | 'CLEAR_FINDINGS') {
    if (typeof tabId !== 'number') return;
    setBusy(true);
    setError(undefined);
    try {
      setState(await send({ type, tabId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">LOCAL COMPLIANCE SCANNER</p>
          <h1>接口敏感信息检查</h1>
        </div>
        <span className={state?.attached ? 'status on' : 'status'}>{state?.attached ? '扫描中' : '未启动'}</span>
      </header>

      <section className="summary">
        <div><span>已扫描响应</span><strong>{state?.scannedResponses ?? 0}</strong></div>
        <div><span>违规项</span><strong className={(state?.findings.length ?? 0) > 0 ? 'danger' : ''}>{state?.findings.length ?? 0}</strong></div>
      </section>

      <div className="actions">
        <button className="primary" disabled={busy || state?.attached} onClick={() => void run('START_SCAN')}>开始扫描</button>
        <button disabled={busy || !state?.attached} onClick={() => void run('STOP_SCAN')}>停止</button>
        <button disabled={busy || !(state?.findings.length)} onClick={() => void run('CLEAR_FINDINGS')}>清空</button>
      </div>

      <p className="hint">仅检查当前标签页的 Fetch / XHR 响应；扫描在本机完成，结果只保留脱敏证据。</p>
      {(error || state?.error) && <div className="error">{error || state?.error}</div>}

      {grouped.length > 0 && (
        <section className="rule-summary">
          {grouped.map(([ruleId, count]) => <span key={ruleId}>{ruleId} <b>{count}</b></span>)}
        </section>
      )}

      <section className="findings">
        {(state?.findings ?? []).map((finding) => <FindingCard key={finding.id} finding={finding} />)}
        {state && state.findings.length === 0 && <div className="empty">暂无违规项。启动扫描后正常浏览页面即可。</div>}
      </section>
    </main>
  );
}
