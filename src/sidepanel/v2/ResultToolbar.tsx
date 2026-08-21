export function ResultToolbar({
  dedupe,
  onDedupeChange,
  onExport
}: {
  dedupe: boolean;
  onDedupeChange: (value: boolean) => void;
  onExport: () => void;
}) {
  return (
    <div className="v2-result-toolbar">
      <label>
        <input
          type="checkbox"
          checked={dedupe}
          onChange={(event) => onDedupeChange(event.target.checked)}
        />
        接口去重
      </label>
      <button onClick={onExport}>导出结果</button>
    </div>
  );
}
