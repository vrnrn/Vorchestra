import type { RunHistoryRecord } from '../../shared/contracts';
import { Clock3, Trash2 } from 'lucide-react';

export function RunHistoryPanel({
  records,
  selectedRunId,
  onSelect,
  onClear,
}: {
  records: readonly RunHistoryRecord[];
  selectedRunId?: string;
  onSelect: (record: RunHistoryRecord) => void;
  onClear: () => void;
}) {
  return (
    <section className="run-history-panel" aria-label="Local run history">
      <header>
        <div>
          <small>LOCAL HISTORY</small>
          <strong>Previous runs</strong>
        </div>
        <button
          className="icon-button"
          aria-label="Clear workflow run history"
          disabled={records.length === 0}
          onClick={onClear}
        >
          <Trash2 size={13} />
        </button>
      </header>
      <p>
        Retained locally for up to 30 days within the 100 MiB application limit.
        Output and paths may be sensitive.
      </p>
      <div className="run-history-list">
        {records.map((record) => (
          <button
            key={record.runId}
            className={record.runId === selectedRunId ? 'selected' : ''}
            aria-pressed={record.runId === selectedRunId}
            onClick={() => onSelect(record)}
          >
            <Clock3 size={13} />
            <span>
              <strong>{record.outcome}</strong>
              <small>{new Date(record.completedAt).toLocaleString()}</small>
            </span>
            <em>
              {record.blocks.filter((block) => block.state === 'failed').length}{' '}
              failed
            </em>
          </button>
        ))}
        {records.length === 0 && (
          <div className="empty-line">No retained runs for this workflow</div>
        )}
      </div>
    </section>
  );
}
