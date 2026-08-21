export function ExportDialog({
  open,
  onClose,
  onExport
}: {
  open: boolean;
  onClose: () => void;
  onExport: () => void;
}) {
  if (!open) return null;

  return (
    <div className="v2-dialog-mask">
      <div className="v2-dialog">
        <h3>导出检测结果</h3>
        <p>仅导出接口和位置，不包含敏感明文。</p>
        <div className="actions">
          <button onClick={onClose}>取消</button>
          <button onClick={onExport}>导出 CSV</button>
        </div>
      </div>
    </div>
  );
}
