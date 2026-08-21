import type { RuleDefinition } from '../../scanner/types';

export function RuleManager({
  rules,
  onCreate,
  onEdit,
  onDelete,
  onToggle
}: {
  rules: RuleDefinition[];
  onCreate: () => void;
  onEdit: (rule: RuleDefinition) => void;
  onDelete: (rule: RuleDefinition) => void;
  onToggle: (rule: RuleDefinition, enabled: boolean) => void;
}) {
  return (
    <section className="v2-rule-manager">
      <header className="v2-section-header">
        <div>
          <h2>规则管理</h2>
          <span>{rules.length} 条规则</span>
        </div>
        <button className="v2-primary-small" onClick={onCreate}>+ 新建规则</button>
      </header>

      <div className="v2-rule-list">
        {rules.map((rule) => (
          <article key={rule.id} className="v2-rule-card">
            <div className="v2-rule-card-top">
              <label className="switch" title={`启用 ${rule.name}`}>
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(event) => onToggle(rule, event.target.checked)}
                />
                <span className="slider" />
              </label>
              <div className="v2-rule-meta">
                <div className="v2-rule-title-line">
                  <strong>{rule.name}</strong>
                  <span className={`v2-rule-origin ${rule.system ? 'system' : 'custom'}`}>
                    {rule.system ? '内置' : '自定义'}
                  </span>
                </div>
                <p>{rule.description || '暂无说明'}</p>
              </div>
            </div>
            <code>{rule.expression}</code>
            <div className="v2-rule-actions">
              <button onClick={() => onEdit(rule)}>编辑</button>
              <button className="danger" onClick={() => onDelete(rule)}>删除</button>
            </div>
          </article>
        ))}

        {rules.length === 0 && (
          <div className="v2-rule-empty">
            <strong>暂无规则</strong>
            <span>创建第一条检测规则后即可参与后续响应扫描。</span>
            <button className="v2-primary-small" onClick={onCreate}>创建规则</button>
          </div>
        )}
      </div>
    </section>
  );
}
