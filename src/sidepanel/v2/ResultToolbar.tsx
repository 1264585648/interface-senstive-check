export function ResultToolbar({
  dedupe,
  count,
  onDedupeChange,
  onExport
}: {
  dedupe: boolean;
  count: number;
  onDedupeChange: (value: boolean) => void;
  onExport: () => void;
}) {
  return (
    <div className="v2-result-toolbar">
      <div className="v2-result-summary">
        <strong>检测结果</strong>
        <span>{count} 条命中</span>
      </div>
      <div className="v2-result-actions">
        <label className="v2-inline-switch">
          <span>接口去重</span>
          <input
            type="checkbox"
            checked={dedupe}
            onChange={(event) => onDedupeChange(event.target.checked)}
          />
        </label>
        <button disabled={count === 0} onClick={onExport}>导出结果</button>
      </div>
    </div>
  );
}
