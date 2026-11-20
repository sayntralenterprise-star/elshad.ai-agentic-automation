import { useEffect, useState } from 'react';
import type { MemoryItemDto } from '@elshad/sdk-ts';
import { StatusChip } from '@elshad/ui-kit';
import { Pin, Save, Trash2, X } from 'lucide-react';

export interface MemoryDetailDrawerProps {
  item: MemoryItemDto | null;
  saving: boolean;
  onSaveContent: (id: string, nextContent: string) => Promise<void> | void;
  onTogglePin: (item: MemoryItemDto) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
  onClose: () => void;
}

export function MemoryDetailDrawer({
  item,
  saving,
  onSaveContent,
  onTogglePin,
  onDelete,
  onClose,
}: MemoryDetailDrawerProps) {
  const [draftContent, setDraftContent] = useState(item?.content ?? '');

  useEffect(() => {
    setDraftContent(item?.content ?? '');
  }, [item?.id, item?.content]);

  if (!item) return null;

  return (
    <aside
      aria-label="Memory item detail drawer"
      style={{
        backgroundColor: 'var(--surface)',
        border: '1.5px solid var(--brand)',
        borderRadius: 'var(--radius-md)',
        padding: '14px',
        boxShadow: 'var(--shadow-card)',
        display: 'grid',
        gap: '10px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: '14px' }}>Memory Item Detail ({item.id})</strong>
        <button
          type="button"
          aria-label="Close memory detail drawer"
          onClick={onClose}
          style={{
            padding: '4px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--surface-raised)',
            cursor: 'pointer',
          }}
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        <StatusChip label={`${item.scope}:${item.scopeId ?? '*'}`} tone="info" />
        <StatusChip label={item.kind} tone="neutral" />
        <StatusChip label={item.sensitivity} tone="warning" />
      </div>

      <div>
        <label htmlFor="mem-detail-content" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
          Editable Content
        </label>
        <textarea
          id="mem-detail-content"
          rows={3}
          value={draftContent}
          onChange={(e) => setDraftContent(e.target.value)}
          style={{
            width: '100%',
            padding: '6px 8px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '12.5px',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={saving || !draftContent.trim()}
          onClick={() => void onSaveContent(item.id, draftContent.trim())}
          style={{
            padding: '5px 12px',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            backgroundColor: 'var(--brand)',
            color: '#fff',
            fontWeight: 600,
            fontSize: '12px',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <Save size={12} aria-hidden="true" />
          <span>Save Changes</span>
        </button>
        <button
          type="button"
          onClick={() => void onTogglePin(item)}
          style={{
            padding: '5px 10px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)',
            backgroundColor: item.pinned ? 'var(--warning-bg)' : 'var(--surface-raised)',
            fontSize: '12px',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <Pin size={12} aria-hidden="true" />
          <span>{item.pinned ? 'Unpin' : 'Pin Item'}</span>
        </button>
        <button
          type="button"
          onClick={() => void onDelete(item.id)}
          style={{
            padding: '5px 10px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--danger)',
            backgroundColor: 'var(--danger-bg)',
            color: 'var(--danger)',
            fontSize: '12px',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <Trash2 size={12} aria-hidden="true" />
          <span>Remove Item</span>
        </button>
      </div>

      {/* Provenance & Usage History */}
      <div
        style={{
          padding: '8px 10px',
          borderRadius: 'var(--radius-sm)',
          backgroundColor: 'var(--surface-raised)',
          border: '1px solid var(--border)',
          fontSize: '11.5px',
          display: 'grid',
          gap: '4px',
        }}
      >
        <strong>Provenance &amp; Usage History</strong>
        <div>
          Origin: <code>{item.provenance?.createdVia ?? 'explicit_tool'}</code> · Importance:{' '}
          <strong>{Math.round((item.importance ?? 0.5) * 100)}%</strong>
        </div>
        <div>
          Subject: <code>{item.subjectId ?? item.scopeId ?? 'workspace'}</code> · Vector Dim:{' '}
          <code>{item.embeddingDim}</code>
        </div>
        <div>
          Created: {item.createdAt} {item.ttlAt ? `· Expires: ${item.ttlAt}` : '· No TTL expiry'}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px', color: 'var(--text-muted)' }}>
          Hash: {item.contentHash.slice(0, 16)}…
        </div>
      </div>
    </aside>
  );
}
