import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AgentDto, AuditEventDto, PlatformClient, RunDto } from '@elshad/sdk-ts';
import { StatusChip } from '@elshad/ui-kit';
import { Activity, MessageSquare, Search } from 'lucide-react';

export interface AgentActivityTabProps {
  client: PlatformClient;
  workspaceId?: string;
  agent: AgentDto;
  actorName: string;
}

type ActivityCategory = 'all' | 'execution' | 'config' | 'deployment' | 'comment' | 'error';

interface ActivityEntry {
  id: string;
  category: Exclude<ActivityCategory, 'all'>;
  title: string;
  actor: string;
  ts: string;
  detail: string;
}

export function AgentActivityTab({
  client,
  workspaceId,
  agent,
  actorName,
}: AgentActivityTabProps) {
  const [filter, setFilter] = useState<ActivityCategory>('all');
  const [search, setSearch] = useState('');
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState<ActivityEntry[]>([]);
  const [runs, setRuns] = useState<RunDto[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [runsRes, auditRes] = await Promise.allSettled([
      client.runs.list({ workspaceId }),
      client.auditEvents.list({ limit: 15 }),
    ]);
    if (runsRes.status === 'fulfilled') setRuns(runsRes.value);
    if (auditRes.status === 'fulfilled') setAuditEvents(auditRes.value.data);
  }, [client, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const entries = useMemo(() => {
    const list: ActivityEntry[] = [];
    for (const v of agent.versions) {
      list.push({
        id: `ver_${v.id}`,
        category: v.state === 'published' ? 'deployment' : 'config',
        title: `Version v${v.semver} (${v.state})`,
        actor: v.createdBy,
        ts: v.createdAt,
        detail: v.message ?? 'Updated agent definition snapshot.',
      });
    }
    for (const r of runs.slice(0, 10)) {
      list.push({
        id: `run_${r.id}`,
        category: r.status === 'failed' ? 'error' : 'execution',
        title: `Run ${r.id} — ${r.status}`,
        actor: r.initiatorId,
        ts: r.createdAt,
        detail: `${r.usage.steps} steps, ${r.costMicroUsd} micro-USD`,
      });
    }
    for (const evt of auditEvents.slice(0, 5)) {
      list.push({
        id: `aud_${evt.id}`,
        category: 'config',
        title: `Audit: ${evt.action}`,
        actor: String((evt.actor as Record<string, unknown>).id ?? 'system'),
        ts: evt.ts,
        detail: `Decision: ${evt.decision ?? 'allow'}`,
      });
    }
    return [...comments, ...list];
  }, [agent.versions, runs, auditEvents, comments]);

  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (filter !== 'all' && e.category !== filter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!`${e.title} ${e.detail} ${e.actor}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [entries, filter, search]);

  const selectedEntry =
    filteredEntries.find((e) => e.id === selectedId) ?? filteredEntries[0] ?? null;

  function handleAddComment(e: FormEvent) {
    e.preventDefault();
    if (!commentText.trim()) return;
    const entry: ActivityEntry = {
      id: `cmt_${Date.now()}`,
      category: 'comment',
      title: `Comment by ${actorName}`,
      actor: actorName,
      ts: new Date().toISOString(),
      detail: commentText.trim(),
    };
    setComments((prev) => [entry, ...prev]);
    setSelectedId(entry.id);
    setCommentText('');
  }

  return (
    <div
      role="tabpanel"
      aria-label="Agent Activity"
      style={{
        padding: '18px 20px',
        display: 'grid',
        gridTemplateColumns: '1fr 310px',
        gap: '16px',
        alignItems: 'start',
      }}
    >
      {/* Left: Filters + Timeline */}
      <div style={{ display: 'grid', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {(['all', 'execution', 'config', 'deployment', 'comment', 'error'] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setFilter(cat)}
                style={{
                  padding: '4px 10px',
                  borderRadius: '9999px',
                  border: filter === cat ? '1px solid var(--lavender-border)' : '1px solid var(--border)',
                  backgroundColor: filter === cat ? 'var(--lavender)' : 'var(--surface)',
                  color: filter === cat ? 'var(--brand)' : 'var(--text-secondary)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {cat === 'all' ? 'All Events' : cat}
              </button>
            ))}
          </div>

          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <Search size={13} aria-hidden="true" style={{ position: 'absolute', left: '8px', color: 'var(--text-muted)' }} />
            <input
              type="search"
              aria-label="Search activity"
              placeholder="Search activity..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                padding: '5px 8px 5px 26px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                fontSize: '12.5px',
              }}
            />
          </div>
        </div>

        {/* Add Comment Form */}
        <form onSubmit={handleAddComment} style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            aria-label="Activity comment"
            placeholder="Add a comment or review note..."
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            style={{
              flex: 1,
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              fontSize: '12.5px',
            }}
          />
          <button
            type="submit"
            style={{
              minHeight: '32px',
              padding: '4px 12px',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--brand)',
              color: 'var(--brand-contrast)',
              fontWeight: 600,
              fontSize: '12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              cursor: 'pointer',
            }}
          >
            <MessageSquare size={12} aria-hidden="true" />
            <span>Add Comment</span>
          </button>
        </form>

        <div style={{ display: 'grid', gap: '8px' }}>
          {filteredEntries.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedId(item.id)}
              style={{
                textAlign: 'left',
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                border: selectedEntry?.id === item.id ? '1.5px solid var(--brand)' : '1px solid var(--border)',
                backgroundColor: selectedEntry?.id === item.id ? 'var(--lavender-soft)' : 'var(--surface)',
                cursor: 'pointer',
                display: 'grid',
                gap: '4px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '13px' }}>{item.title}</strong>
                <StatusChip
                  label={item.category}
                  tone={item.category === 'error' ? 'danger' : item.category === 'comment' ? 'human' : 'info'}
                />
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{item.detail}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {item.actor} · {item.ts.slice(0, 19).replace('T', ' ')}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: Contextual Detail Drawer */}
      <aside
        aria-label="Activity Detail Drawer"
        style={{
          backgroundColor: 'var(--lavender-soft)',
          border: '1px solid var(--lavender-border)',
          borderRadius: 'var(--radius-md)',
          padding: '14px',
          display: 'grid',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '13.5px' }}>
          <Activity size={14} style={{ color: 'var(--brand)' }} aria-hidden="true" />
          <span>Event Detail</span>
        </div>
        {!selectedEntry ? (
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Select an event to inspect details.</div>
        ) : (
          <div style={{ fontSize: '12px', display: 'grid', gap: '6px' }}>
            <div>
              <strong>{selectedEntry.title}</strong>
            </div>
            <div>Actor: {selectedEntry.actor}</div>
            <div>Timestamp: {selectedEntry.ts}</div>
            <div style={{ padding: '8px', borderRadius: '6px', backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              {selectedEntry.detail}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
