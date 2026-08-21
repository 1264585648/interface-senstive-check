import type { ReactNode } from 'react';

export type ManagedRule = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  expression: string;
};

export function RuleManager({
  rules,
  onCreate,
  onEdit,
  onDelete,
  onToggle
}: {
  rules: ManagedRule[];
  onCreate: () => void;
  onEdit: (rule: ManagedRule) => void;
  onDelete: (rule: ManagedRule) => void;
  onToggle: (rule: ManagedRule) => void;
}) {
  return (
    <section className="v2-rule-manager">
      <header>
        <h2>规则管理</h2>
        <button onClick={onCreate}>+ 新建规则</button>
      </header>
      {rules.map((rule) => (
        <article key={rule.id} className="v2-rule-card">
          <label>
            <input type="checkbox" checked={rule.enabled} onChange={() => onToggle(rule)} />
            {rule.name}
          </label>
          <p>{rule.description}</p>
          <code>{rule.expression}</code>
          <div>
            <button onClick={() => onEdit(rule)}>编辑</button>
            <button onClick={() => onDelete(rule)}>删除</button>
          </div>
        </article>
      ))}
    </section>
  );
}
