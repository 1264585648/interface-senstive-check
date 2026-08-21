import { useEffect, useMemo, useState } from 'react';
import type { Finding, RuleDefinition, RuleInput, ScanState } from '../scanner/types';
import type { ExtensionEvent, ExtensionMessage, ExtensionResponse } from '../shared/messages';
import { FINDINGS_ADDED, RULES_UPDATED, SCAN_STATE_UPDATED } from '../shared/messages';
import { ExportDialog } from './v2/ExportDialog';
import { ResultToolbar } from './v2/ResultToolbar';
import { RuleManager } from './v2/RuleManager';
import { exportFindingGroupsCsv } from './v2/exportCsv';
import { groupFindings } from './v2/groupFindings';
import type { FindingGroup } from './v2/types';

type ActiveTab = {
  tabId: number;
  windowId: number;
};

type RuleEditorState = {
  mode: 'create' | 'edit';
  rule?: RuleDefinition;
};

const emptyRuleInput = (): RuleInput => ({
  name: '',
  description: '',
  expression: '',
  enabled: true
});

async function currentTab(): Promise<ActiveTab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (typeof tab?.id !== 'number' || typeof tab.windowId !== 'number') {
    throw new Error('无法获取当前标签页。');
  }
  return { tabId: tab.id, windowId: tab.windowId };
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

async function getRules(): Promise<RuleDefinition[]> {
  const response = await send({ type: 'GET_RULES' });
  if (!response.ok) throw new Error(response.error);
  if (response.kind !== 'RULES') throw new Error('后台返回了错误的数据类型。');
  return response.rules;
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

function ruleClass(ruleId: string): string {
  if (ruleId === 'CN_MOBILE') return 'phone';
  if (ruleId === 'CN_ID_CARD') return 'id-card';
  if (ruleId === 'FULL_BIRTH_DATE') return 'birth-date';
  return 'custom';
}

function downloadCsv(findings: Finding[]): void {
  const csv = exportFindingGroupsCsv(groupFindings(findings));
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = `interface-sensitive-findings-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

export function App() {
  const [tabId, setTabId] = useState<number>();
  const [state, setState] = useState<ScanState>();
  const [rules, setRules] = useState<RuleDefinition[]>([]);
  const [findingsByTab, setFindingsByTab] = useState<Record<number, Finding[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [dedupe, setDedupe] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<FindingGroup>();
  const [editor, setEditor] = useState<RuleEditorState>();
  const [ruleForm, setRuleForm] = useState<RuleInput>(emptyRuleInput());
  const [deleteCandidate, setDeleteCandidate] = useState<RuleDefinition>();

  const findings = useMemo(
    () => (typeof tabId === 'number' ? findingsByTab[tabId] ?? [] : []),
    [findingsByTab, tabId]
  );

  const groups = useMemo(() => groupFindings(findings), [findings]);

  useEffect(() => {
    let disposed = false;
    let panelWindowId: number | undefined;
    let loadGeneration = 0;

    const loadTab = async (activeId: number) => {
      const generation = ++loadGeneration;
      try {
        const nextState = await getScanState(activeId);
        if (disposed || generation !== loadGeneration) return;
        setTabId(activeId);
        setState(nextState);
        setError(undefined);
      } catch (cause) {
        if (!disposed && generation === loadGeneration) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    };

    void (async () => {
      try {
        const active = await currentTab();
        if (disposed) return;
        panelWindowId = active.windowId;
        const [nextRules] = await Promise.all([
          getRules(),
          loadTab(active.tabId)
        ]);
        if (!disposed) setRules(nextRules);
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    const onActivated = (activeInfo: { tabId: number; windowId: number }) => {
      if (activeInfo.windowId !== panelWindowId) return;
      void loadTab(activeInfo.tabId);
    };
    chrome.tabs.onActivated.addListener(onActivated);

    return () => {
      disposed = true;
      loadGeneration += 1;
      chrome.tabs.onActivated.removeListener(onActivated);
    };
  }, []);

  useEffect(() => {
    const listener = (message: ExtensionEvent) => {
      if (message.type === SCAN_STATE_UPDATED) {
        if (message.state.tabId === tabId) setState(message.state);
        return;
      }

      if (message.type === RULES_UPDATED) {
        setRules(message.rules);
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
        setSelectedGroup(undefined);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function toggleRule(rule: RuleDefinition, enabled: boolean) {
    setError(undefined);
    try {
      const response = await send({ type: 'SET_RULE_ENABLED', ruleId: rule.id, enabled });
      if (!response.ok) throw new Error(response.error);
      if (response.kind !== 'RULES') throw new Error('后台返回了错误的数据类型。');
      setRules(response.rules);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function openCreateRule() {
    setRuleForm(emptyRuleInput());
    setEditor({ mode: 'create' });
  }

  function openEditRule(rule: RuleDefinition) {
    setRuleForm({
      name: rule.name,
      description: rule.description,
      expression: rule.expression,
      enabled: rule.enabled
    });
    setEditor({ mode: 'edit', rule });
  }

  async function saveRule() {
    if (!editor) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = editor.mode === 'create'
        ? await send({ type: 'CREATE_RULE', rule: ruleForm })
        : await send({ type: 'UPDATE_RULE', ruleId: editor.rule!.id, rule: ruleForm });
      if (!response.ok) throw new Error(response.error);
      if (response.kind !== 'RULES') throw new Error('后台返回了错误的数据类型。');
      setRules(response.rules);
      setEditor(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteRule() {
    if (!deleteCandidate) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await send({ type: 'DELETE_RULE', ruleId: deleteCandidate.id });
      if (!response.ok) throw new Error(response.error);
      if (response.kind !== 'RULES') throw new Error('后台返回了错误的数据类型。');
      setRules(response.rules);
      setDeleteCandidate(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
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
            <p>V2 · 自定义规则、接口去重与安全导出</p>
          </div>
        </div>
        <div className={`status-chip ${state?.attached ? 'collecting' : ''}`}>
          <span className="status-dot" />
          {statusText}
        </div>
      </header>

      <main className="layout">
        <aside className="left-panel">
          <RuleManager
            rules={rules}
            onCreate={openCreateRule}
            onEdit={openEditRule}
            onDelete={setDeleteCandidate}
            onToggle={(rule, enabled) => void toggleRule(rule, enabled)}
          />

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
            <p>命中结果可在当前会话展示明文用于确认；导出文件只包含接口和位置，不包含敏感明文。</p>
          </div>

          {(error || state?.error) && <div className="error-message">{error || state?.error}</div>}
        </aside>

        <section className="results-panel v2-results-panel">
          <ResultToolbar
            dedupe={dedupe}
            count={findings.length}
            onDedupeChange={setDedupe}
            onExport={() => setExportOpen(true)}
          />

          <div className="results-card">
            {!dedupe && (
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
            )}

            {dedupe && groups.length > 0 && (
              <table className="v2-group-table">
                <thead>
                  <tr>
                    <th>接口</th>
                    <th>命中规则</th>
                    <th>位置</th>
                    <th className="v2-count-column">次数</th>
                    <th className="v2-action-column">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <tr key={group.key}>
                      <td className="api-cell">
                        <span className={`method ${group.method.toLowerCase()}`}>{group.method}</span>
                        <span>{group.url}</span>
                      </td>
                      <td>
                        <div className="v2-badge-stack">
                          {group.rules.slice(0, 3).map((rule) => <span key={rule} className="v2-neutral-badge">{rule}</span>)}
                          {group.rules.length > 3 && <span className="v2-neutral-badge">+{group.rules.length - 3}</span>}
                        </div>
                      </td>
                      <td><code className="json-path">{group.locations[0]}{group.locations.length > 1 ? ` 等 ${group.locations.length} 处` : ''}</code></td>
                      <td><span className="v2-count-badge">{group.count}</span></td>
                      <td><button className="v2-link-button" onClick={() => setSelectedGroup(group)}>查看详情</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

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

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        onExport={() => {
          downloadCsv(findings);
          setExportOpen(false);
        }}
      />

      {editor && (
        <div className="v2-dialog-mask" onMouseDown={(event) => event.target === event.currentTarget && setEditor(undefined)}>
          <div className="v2-dialog v2-rule-dialog">
            <div className="v2-dialog-heading">
              <div>
                <h3>{editor.mode === 'create' ? '新建规则' : '编辑规则'}</h3>
                <p>{editor.rule?.system ? '内置规则可修改名称、说明和启停状态，检测逻辑保持内置校验。' : '使用 JavaScript 正则表达式匹配响应字段值。'}</p>
              </div>
              <button className="v2-icon-button" onClick={() => setEditor(undefined)}>×</button>
            </div>

            <label className="v2-field">
              <span>规则名称 *</span>
              <input
                value={ruleForm.name}
                maxLength={60}
                onChange={(event) => setRuleForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="例如：银行卡号"
              />
            </label>

            <label className="v2-field">
              <span>规则说明</span>
              <textarea
                value={ruleForm.description}
                onChange={(event) => setRuleForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="说明这条规则检测什么内容"
              />
            </label>

            <label className="v2-field">
              <span>正则表达式 *</span>
              <textarea
                className="v2-code-input"
                value={ruleForm.expression}
                disabled={Boolean(editor.rule?.system)}
                onChange={(event) => setRuleForm((current) => ({ ...current, expression: event.target.value }))}
                placeholder="例如：\\b\\d{16,19}\\b"
              />
              {editor.rule?.system && <small>内置规则包含额外格式/语义校验，因此表达式只用于展示。</small>}
            </label>

            <label className="v2-enable-row">
              <input
                type="checkbox"
                checked={ruleForm.enabled}
                onChange={(event) => setRuleForm((current) => ({ ...current, enabled: event.target.checked }))}
              />
              保存后立即启用
            </label>

            <div className="v2-dialog-actions">
              <button onClick={() => setEditor(undefined)}>取消</button>
              <button className="primary" disabled={busy} onClick={() => void saveRule()}>{busy ? '保存中…' : '保存规则'}</button>
            </div>
          </div>
        </div>
      )}

      {deleteCandidate && (
        <div className="v2-dialog-mask">
          <div className="v2-dialog v2-confirm-dialog">
            <div className="v2-danger-icon">!</div>
            <h3>删除规则？</h3>
            <p>“{deleteCandidate.name}” 删除后不会参与后续检测；当前会话已经产生的结果不会被删除。</p>
            <div className="v2-dialog-actions">
              <button onClick={() => setDeleteCandidate(undefined)}>取消</button>
              <button className="danger" disabled={busy} onClick={() => void confirmDeleteRule()}>{busy ? '删除中…' : '确认删除'}</button>
            </div>
          </div>
        </div>
      )}

      {selectedGroup && (
        <div className="v2-drawer-mask" onMouseDown={(event) => event.target === event.currentTarget && setSelectedGroup(undefined)}>
          <aside className="v2-detail-drawer">
            <div className="v2-dialog-heading">
              <div>
                <h3>接口命中详情</h3>
                <p>{selectedGroup.method} {selectedGroup.url}</p>
              </div>
              <button className="v2-icon-button" onClick={() => setSelectedGroup(undefined)}>×</button>
            </div>
            <div className="v2-detail-stat">
              <span>累计命中</span>
              <strong>{selectedGroup.count}</strong>
            </div>
            <section>
              <h4>命中规则</h4>
              <div className="v2-badge-stack">
                {selectedGroup.rules.map((rule) => <span key={rule} className="v2-neutral-badge">{rule}</span>)}
              </div>
            </section>
            <section>
              <h4>命中位置</h4>
              <div className="v2-location-list">
                {selectedGroup.locations.map((location) => <code key={location}>{location}</code>)}
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
