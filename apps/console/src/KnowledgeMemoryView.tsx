import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { PlatformError, type EnvironmentKind } from '@elshad/domain';
import {
  type CitationChipDto,
  type ConversationSessionDto,
  type KbQueryResponseDto,
  type KnowledgeBaseDetailDto,
  type KnowledgeBaseDto,
  type MemoryItemDto,
  type MemoryKindDto,
  type MemoryScopeDto,
  type PlatformClient,
  type ScoredMemoryItemDto,
  type SensitivityLevelDto,
} from '@elshad/sdk-ts';
import { StateView, StatusChip, SuccessNotice } from '@elshad/ui-kit';
import {
  BookOpen,
  Database,
  Eraser,
  FileText,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';

export interface KnowledgeMemoryViewProps {
  client: PlatformClient;
  workspaceId?: string;
  projectId?: string;
  environment: EnvironmentKind;
}

type KmTab = 'kb' | 'memory';

export function KnowledgeMemoryView({
  client,
  workspaceId,
  projectId,
  environment,
}: KnowledgeMemoryViewProps) {
  const [activeTab, setActiveTab] = useState<KmTab>('kb');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Knowledge Bases state
  const [kbs, setKbs] = useState<KnowledgeBaseDto[]>([]);
  const [selectedKbId, setSelectedKbId] = useState<string | null>(null);
  const [kbDetail, setKbDetail] = useState<KnowledgeBaseDetailDto | null>(null);

  const [createKbOpen, setCreateKbOpen] = useState(false);
  const [newKbName, setNewKbName] = useState('Operations Runbook KB');
  const [newKbDesc, setNewKbDesc] = useState(
    'Verified troubleshooting guides, SLAs, and webhook runbooks.',
  );
  const [newKbDim, setNewKbDim] = useState(1536);

  // Document ingestion & incremental re-sync state
  const [ingestTitle, setIngestTitle] = useState('Support SLA Handbook');
  const [ingestKind, setIngestKind] = useState<'file' | 'url' | 'manual'>('file');
  const [ingestMime, setIngestMime] = useState('text/markdown');
  const [ingestUri, setIngestUri] = useState('');
  const [ingestContent, setIngestContent] = useState(
    [
      '# Refund SLA',
      '',
      'Standard refunds complete within 5 business days with finance signoff.',
      '',
      '# Webhook Replay Guard',
      '',
      'All inbound webhooks require HMAC-SHA256 signatures and 5-minute replay windows.',
    ].join('\n'),
  );
  const [syncDocId, setSyncDocId] = useState<string>('');
  const [syncContent, setSyncContent] = useState('');

  // Ask-this-KB state
  const [kbQueryText, setKbQueryText] = useState('How fast do standard refunds complete?');
  const [kbQueryRes, setKbQueryRes] = useState<KbQueryResponseDto | null>(null);
  const [activeCitation, setActiveCitation] = useState<CitationChipDto | null>(null);

  // Memory Explorer state
  const [memoryItems, setMemoryItems] = useState<MemoryItemDto[]>([]);
  const [scoredResults, setScoredResults] = useState<ScoredMemoryItemDto[] | null>(null);
  const [filterScope, setFilterScope] = useState<'all' | MemoryScopeDto>('all');
  const [filterKind, setFilterKind] = useState<'all' | MemoryKindDto>('all');
  const [filterSensitivity, setFilterSensitivity] = useState<'all' | SensitivityLevelDto>('all');
  const [memorySearchQuery, setMemorySearchQuery] = useState('');

  const [newMemScope, setNewMemScope] = useState<MemoryScopeDto>('user');
  const [newMemScopeId, setNewMemScopeId] = useState('user_alice');
  const [newMemKind, setNewMemKind] = useState<MemoryKindDto>('semantic');
  const [newMemSensitivity, setNewMemSensitivity] = useState<SensitivityLevelDto>('internal');
  const [newMemContent, setNewMemContent] = useState(
    'Customer alice@elshad.local prefers Slack outage alerts.',
  );

  const [eraseSubjectId, setEraseSubjectId] = useState('user_alice');

  // Session rolling summary tester state
  const [sessionSubjectId, setSessionSubjectId] = useState('user_alice');
  const [sessionTurnText, setSessionTurnText] = useState(
    'Investigating ticket T-10492 and invoice INV-9981 for $149.95 refund.',
  );
  const [activeSession, setActiveSession] = useState<ConversationSessionDto | null>(null);

  const selectedKb = useMemo(
    () => kbs.find((k) => k.id === selectedKbId) ?? kbs[0] ?? null,
    [kbs, selectedKbId],
  );

  const loadKbDetail = useCallback(
    async (kbId: string) => {
      try {
        const detail = await client.knowledgeBases.get(kbId);
        setKbDetail(detail);
        if (detail.documents[0] && !syncDocId) {
          setSyncDocId(detail.documents[0].id);
        }
      } catch (err) {
        setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
      }
    },
    [client, syncDocId],
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [kbList, memPage] = await Promise.all([
        client.knowledgeBases.list(),
        client.memory.list({ limit: 50 }),
      ]);
      setKbs(kbList);
      setMemoryItems(memPage.items);
      const targetKbId = selectedKbId ?? kbList[0]?.id ?? null;
      if (targetKbId) {
        setSelectedKbId(targetKbId);
        const detail = await client.knowledgeBases.get(targetKbId);
        setKbDetail(detail);
        if (detail.documents[0]) {
          setSyncDocId(detail.documents[0].id);
        }
      } else {
        setKbDetail(null);
      }
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setLoading(false);
    }
  }, [client, selectedKbId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function handleCreateKb(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const created = await client.knowledgeBases.create(
        {
          workspaceId,
          projectId,
          name: newKbName.trim() || 'Operations Runbook KB',
          description: newKbDesc.trim(),
          embeddingDim: Number(newKbDim) || 1536,
        },
        `ui-kb-create-${Date.now()}`,
      );
      setKbs((prev) => [created, ...prev]);
      setSelectedKbId(created.id);
      await loadKbDetail(created.id);
      setCreateKbOpen(false);
      setNotice(`Created Knowledge Base "${created.name}" (${created.embeddingDim}-dim HNSW).`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleIngestDocument(e: FormEvent) {
    e.preventDefault();
    if (!selectedKb) return;
    setError(null);
    setNotice(null);
    try {
      const res = await client.knowledgeBases.ingestDocument(
        selectedKb.id,
        {
          sourceName: ingestTitle.trim(),
          kind: ingestKind,
          uri: ingestKind === 'url' ? ingestUri.trim() : undefined,
          title: ingestTitle.trim(),
          mimeType: ingestMime,
          content: ingestKind === 'url' && !ingestContent.trim() ? undefined : ingestContent,
        },
        `ui-kb-ingest-${Date.now()}`,
      );
      await loadKbDetail(selectedKb.id);
      setSyncDocId(res.document.id);
      setSyncContent(ingestContent);
      setNotice(
        `Ingested "${res.document.title}" (${res.syncReport.addedChunks} chunks embedded).`,
      );
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleIncrementalSync(e: FormEvent) {
    e.preventDefault();
    if (!selectedKb || !syncDocId) return;
    setError(null);
    setNotice(null);
    const nextText = syncContent.trim() || `${ingestContent}\n\nUpdated SLA addendum.`;
    try {
      const report = await client.knowledgeBases.syncDocument(
        selectedKb.id,
        {
          docId: syncDocId,
          content: nextText,
        },
        `ui-kb-sync-${Date.now()}`,
      );
      await loadKbDetail(selectedKb.id);
      setNotice(
        `Incremental re-sync: ${report.reEmbeddedChunks} re-embedded, ${report.unchangedChunks} unchanged, ${report.deletedChunks} deleted.`,
      );
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleAskKb(e: FormEvent) {
    e.preventDefault();
    if (!selectedKb || !kbQueryText.trim()) return;
    setError(null);
    setNotice(null);
    try {
      const res = await client.knowledgeBases.query(
        selectedKb.id,
        { query: kbQueryText.trim(), topK: 5 },
        `ui-kb-query-${Date.now()}`,
      );
      setKbQueryRes(res);
      setActiveCitation(res.citations[0] ?? null);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleAddMemoryItem(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const item = await client.memory.put(
        {
          workspaceId,
          projectId,
          scope: newMemScope,
          scopeId: newMemScopeId.trim() || null,
          subjectId: newMemScope === 'user' ? newMemScopeId.trim() || null : null,
          kind: newMemKind,
          sensitivity: newMemSensitivity,
          content: newMemContent.trim(),
          importance: 0.8,
        },
        `ui-mem-put-${Date.now()}`,
      );
      setMemoryItems((prev) => [item, ...prev]);
      setScoredResults(null);
      setNotice(`Stored ${item.scope} memory item ${item.id}.`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleSearchMemory(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (!memorySearchQuery.trim()) {
        setScoredResults(null);
        const page = await client.memory.list({
          scope: filterScope === 'all' ? undefined : filterScope,
          kind: filterKind === 'all' ? undefined : filterKind,
          sensitivity: filterSensitivity === 'all' ? undefined : filterSensitivity,
        });
        setMemoryItems(page.items);
        return;
      }
      const res = await client.memory.search(
        {
          workspaceId,
          query: memorySearchQuery.trim(),
          scope: filterScope === 'all' ? undefined : filterScope,
          kind: filterKind === 'all' ? undefined : filterKind,
          maxSensitivity: filterSensitivity === 'all' ? undefined : filterSensitivity,
          topK: 10,
        },
        `ui-mem-search-${Date.now()}`,
      );
      setScoredResults(res);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleTogglePin(item: MemoryItemDto) {
    setError(null);
    try {
      const updated = await client.memory.update(item.id, { pinned: !item.pinned });
      setMemoryItems((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      setScoredResults((prev) =>
        prev ? prev.map((s) => (s.item.id === updated.id ? { ...s, item: updated } : s)) : null,
      );
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleDeleteMemoryItem(id: string) {
    setError(null);
    try {
      await client.memory.delete(id);
      setMemoryItems((prev) => prev.filter((m) => m.id !== id));
      setScoredResults((prev) => (prev ? prev.filter((s) => s.item.id !== id) : null));
      setNotice(`Deleted memory item ${id}.`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleEraseSubject(e: FormEvent) {
    e.preventDefault();
    if (!eraseSubjectId.trim()) return;
    setError(null);
    setNotice(null);
    try {
      const report = await client.memory.eraseSubject(
        eraseSubjectId.trim(),
        `ui-mem-erase-${Date.now()}`,
      );
      setMemoryItems((prev) =>
        prev.filter(
          (m) => m.subjectId !== report.subjectId && m.scopeId !== report.subjectId,
        ),
      );
      setScoredResults(null);
      if (activeSession?.subjectId === report.subjectId) {
        setActiveSession(null);
      }
      setNotice(
        `Right-to-erasure completed for "${report.subjectId}": ${report.deletedMemoryItems} memory items and ${report.deletedSessions} session summaries purged.`,
      );
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function handleAppendSessionTurn(e: FormEvent) {
    e.preventDefault();
    if (!sessionTurnText.trim()) return;
    setError(null);
    try {
      const updated = await client.memory.appendSession(
        {
          workspaceId,
          sessionId: activeSession?.id,
          subjectId: sessionSubjectId.trim() || null,
          title: 'Interactive Session Memory',
          messages: [{ role: 'user', content: sessionTurnText.trim() }],
          compactThresholdTokens: 30,
          keepRecentMessages: 1,
        },
        `ui-ses-append-${Date.now()}`,
      );
      setActiveSession(updated);
      setNotice(`Session ${updated.id} compacted (${updated.preservedIdentifiers.length} IDs preserved).`);
    } catch (err) {
      setError(err instanceof PlatformError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  if (loading && kbs.length === 0 && memoryItems.length === 0) {
    return (
      <StateView
        state="loading"
        title="Loading Knowledge & Memory"
        description="Fetching workspace knowledge bases and scoped memory records..."
      />
    );
  }

  const displayedMemoryRows: Array<{ item: MemoryItemDto; score?: number }> = scoredResults
    ? scoredResults.map((s) => ({ item: s.item, score: s.score }))
    : memoryItems
        .filter((m) => filterScope === 'all' || m.scope === filterScope)
        .filter((m) => filterKind === 'all' || m.kind === filterKind)
        .filter((m) => filterSensitivity === 'all' || m.sensitivity === filterSensitivity)
        .map((item) => ({ item }));

  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      {/* Header + Mode Tabs */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
          padding: '12px 14px',
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <Database size={18} aria-hidden="true" />
            <span>Knowledge &amp; Memory</span>
          </h1>
          <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
            Manage pgvector Knowledge Bases, N.2.11 structural chunking, inline citations, and scoped memory in{' '}
            <strong>{environment.toUpperCase()}</strong>.
          </p>
        </div>

        <div role="tablist" aria-label="Knowledge and Memory sections" style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            role="tab"
            id="tab-kb"
            aria-selected={activeTab === 'kb'}
            onClick={() => setActiveTab('kb')}
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--radius-sm)',
              border: activeTab === 'kb' ? '2px solid var(--brand)' : '1px solid var(--border)',
              backgroundColor: activeTab === 'kb' ? 'var(--brand)' : 'var(--surface-raised)',
              color: activeTab === 'kb' ? '#fff' : 'inherit',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <BookOpen size={14} aria-hidden="true" />
            <span>Knowledge Bases</span>
          </button>
          <button
            type="button"
            role="tab"
            id="tab-memory"
            aria-selected={activeTab === 'memory'}
            onClick={() => setActiveTab('memory')}
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--radius-sm)',
              border: activeTab === 'memory' ? '2px solid var(--brand)' : '1px solid var(--border)',
              backgroundColor: activeTab === 'memory' ? 'var(--brand)' : 'var(--surface-raised)',
              color: activeTab === 'memory' ? '#fff' : 'inherit',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Sparkles size={14} aria-hidden="true" />
            <span>Memory Explorer</span>
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: '10px 12px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--danger-bg)',
            color: 'var(--danger)',
            border: '1px solid var(--danger)',
          }}
        >
          {error}
        </div>
      )}

      {notice && <SuccessNotice message={notice} />}

      {/* TAB 1: KNOWLEDGE BASES */}
      {activeTab === 'kb' && (
        <div role="tabpanel" aria-labelledby="tab-kb" style={{ display: 'grid', gap: '12px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px',
              padding: '10px 12px',
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {kbs.length > 0 && (
                <>
                  <label htmlFor="kb-selector" style={{ fontSize: '12px', fontWeight: 600 }}>
                    Active KB:
                  </label>
                  <select
                    id="kb-selector"
                    value={selectedKb?.id ?? ''}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setSelectedKbId(nextId);
                      setKbQueryRes(null);
                      setActiveCitation(null);
                      void loadKbDetail(nextId);
                    }}
                    style={{
                      padding: '6px 8px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    {kbs.map((kb) => (
                      <option key={kb.id} value={kb.id}>
                        {kb.name} ({kb.embeddingDim}d)
                      </option>
                    ))}
                  </select>
                </>
              )}
              {selectedKb && (
                <StatusChip
                  label={`HNSW vector(${selectedKb.embeddingDim})`}
                  tone="info"
                />
              )}
            </div>

            <button
              type="button"
              onClick={() => setCreateKbOpen(true)}
              style={{
                padding: '6px 12px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                backgroundColor: 'var(--brand)',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <Plus size={14} aria-hidden="true" />
              <span>+ New Knowledge Base</span>
            </button>
          </div>

          {createKbOpen && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-kb-heading"
              style={{
                padding: '16px',
                backgroundColor: 'var(--surface)',
                border: '2px solid var(--brand)',
                borderRadius: 'var(--radius-md)',
                display: 'grid',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 id="create-kb-heading" style={{ margin: 0, fontSize: '17px' }}>
                  Create Knowledge Base
                </h2>
                <button
                  type="button"
                  onClick={() => setCreateKbOpen(false)}
                  style={{
                    padding: '4px 10px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--surface-raised)',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
              <form onSubmit={(e) => void handleCreateKb(e)} style={{ display: 'grid', gap: '10px' }}>
                <div>
                  <label htmlFor="new-kb-name" style={{ display: 'block', fontWeight: 600 }}>
                    Knowledge Base Name
                  </label>
                  <input
                    id="new-kb-name"
                    type="text"
                    required
                    value={newKbName}
                    onChange={(e) => setNewKbName(e.target.value)}
                    style={{ width: '100%', padding: '8px', border: '1px solid var(--border)' }}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
                  <div>
                    <label htmlFor="new-kb-desc" style={{ display: 'block', fontWeight: 600 }}>
                      Description
                    </label>
                    <input
                      id="new-kb-desc"
                      type="text"
                      value={newKbDesc}
                      onChange={(e) => setNewKbDesc(e.target.value)}
                      style={{ width: '100%', padding: '8px', border: '1px solid var(--border)' }}
                    />
                  </div>
                  <div>
                    <label htmlFor="new-kb-dim" style={{ display: 'block', fontWeight: 600 }}>
                      Embedding Dim (DOC-Q-008)
                    </label>
                    <input
                      id="new-kb-dim"
                      type="number"
                      min={64}
                      max={3072}
                      value={newKbDim}
                      onChange={(e) => setNewKbDim(Number(e.target.value))}
                      style={{ width: '100%', padding: '8px', border: '1px solid var(--border)' }}
                    />
                  </div>
                </div>
                <div>
                  <button
                    type="submit"
                    style={{
                      padding: '7px 14px',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--brand)',
                      color: '#fff',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Create Knowledge Base
                  </button>
                </div>
              </form>
            </div>
          )}

          {!selectedKb && !createKbOpen && (
            <StateView
              state="empty"
              title="No Knowledge Bases yet"
              description="Create a pgvector Knowledge Base to ingest documents with N.2.11 structural chunking and inline citations."
              actionLabel="+ New Knowledge Base"
              onAction={() => setCreateKbOpen(true)}
            />
          )}

          {selectedKb && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'start' }}>
              {/* Left Column: Ingestion + Re-sync + Documents */}
              <div style={{ display: 'grid', gap: '12px' }}>
                <form
                  onSubmit={(e) => void handleIngestDocument(e)}
                  style={{
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px',
                    display: 'grid',
                    gap: '8px',
                  }}
                >
                  <h2 style={{ margin: 0, fontSize: '15px' }}>Ingest Document / Source</h2>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '8px' }}>
                    <div>
                      <label htmlFor="ingest-title" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                        Document Title
                      </label>
                      <input
                        id="ingest-title"
                        type="text"
                        required
                        value={ingestTitle}
                        onChange={(e) => setIngestTitle(e.target.value)}
                        style={{ width: '100%', padding: '6px', border: '1px solid var(--border)' }}
                      />
                    </div>
                    <div>
                      <label htmlFor="ingest-kind" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                        Source Kind
                      </label>
                      <select
                        id="ingest-kind"
                        value={ingestKind}
                        onChange={(e) => setIngestKind(e.target.value as 'file' | 'url' | 'manual')}
                        style={{ width: '100%', padding: '6px', border: '1px solid var(--border)' }}
                      >
                        <option value="file">File</option>
                        <option value="url">URL</option>
                        <option value="manual">Manual</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="ingest-mime" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                        Format
                      </label>
                      <select
                        id="ingest-mime"
                        value={ingestMime}
                        onChange={(e) => setIngestMime(e.target.value)}
                        style={{ width: '100%', padding: '6px', border: '1px solid var(--border)' }}
                      >
                        <option value="text/markdown">Markdown</option>
                        <option value="text/html">HTML</option>
                        <option value="text/plain">TXT</option>
                      </select>
                    </div>
                  </div>
                  {ingestKind === 'url' && (
                    <div>
                      <label htmlFor="ingest-uri" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                        Source URL (SSRF-checked)
                      </label>
                      <input
                        id="ingest-uri"
                        type="url"
                        placeholder="https://docs.example.com/runbook"
                        value={ingestUri}
                        onChange={(e) => setIngestUri(e.target.value)}
                        style={{ width: '100%', padding: '6px', border: '1px solid var(--border)' }}
                      />
                    </div>
                  )}
                  <div>
                    <label htmlFor="ingest-content" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                      Document Content
                    </label>
                    <textarea
                      id="ingest-content"
                      rows={5}
                      value={ingestContent}
                      onChange={(e) => setIngestContent(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px',
                        fontFamily: 'var(--font-mono, monospace)',
                        fontSize: '12px',
                        border: '1px solid var(--border)',
                      }}
                    />
                  </div>
                  <div>
                    <button
                      type="submit"
                      style={{
                        padding: '6px 12px',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--brand)',
                        color: '#fff',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Ingest Document
                    </button>
                  </div>
                </form>

                {/* Documents & Incremental Re-sync */}
                <div
                  style={{
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px',
                    display: 'grid',
                    gap: '8px',
                  }}
                >
                  <h2 style={{ margin: 0, fontSize: '15px' }}>
                    Sources &amp; Documents ({kbDetail?.documents.length ?? 0})
                  </h2>
                  {(kbDetail?.documents.length ?? 0) === 0 ? (
                    <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>
                      No documents ingested into this Knowledge Base yet.
                    </p>
                  ) : (
                    <>
                      <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', display: 'grid', gap: '4px' }}>
                        {kbDetail?.documents.map((doc) => (
                          <li key={doc.id}>
                            <FileText size={12} aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                            <strong>{doc.title}</strong> — {doc.chunkCount} chunks ·{' '}
                            <code>{doc.contentHash.slice(0, 10)}</code>
                          </li>
                        ))}
                      </ul>
                      <form onSubmit={(e) => void handleIncrementalSync(e)} style={{ display: 'grid', gap: '6px', borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                        <label htmlFor="kb-sync-content" style={{ fontSize: '12px', fontWeight: 600 }}>
                          Updated Content for Incremental Re-sync
                        </label>
                        <textarea
                          id="kb-sync-content"
                          rows={3}
                          value={syncContent}
                          onChange={(e) => setSyncContent(e.target.value)}
                          placeholder="Paste updated document text to re-embed only modified chunks..."
                          style={{
                            width: '100%',
                            padding: '6px',
                            fontFamily: 'var(--font-mono, monospace)',
                            fontSize: '12px',
                            border: '1px solid var(--border)',
                          }}
                        />
                        <button
                          type="submit"
                          style={{
                            padding: '6px 12px',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            backgroundColor: 'var(--surface-raised)',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            width: 'fit-content',
                          }}
                        >
                          <RefreshCw size={13} aria-hidden="true" />
                          <span>Re-sync Document</span>
                        </button>
                      </form>
                    </>
                  )}
                </div>
              </div>

              {/* Right Column: Ask this KB + Citation Chips + Passage Drawer */}
              <div
                style={{
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px',
                  display: 'grid',
                  gap: '10px',
                }}
              >
                <h2 style={{ margin: 0, fontSize: '15px' }}>Ask this KB (Hybrid N.2.10 + Citations)</h2>
                <form onSubmit={(e) => void handleAskKb(e)} style={{ display: 'flex', gap: '8px' }}>
                  <label htmlFor="kb-ask-input" style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden' }}>
                    Ask Knowledge Base Question
                  </label>
                  <input
                    id="kb-ask-input"
                    type="text"
                    value={kbQueryText}
                    onChange={(e) => setKbQueryText(e.target.value)}
                    placeholder="Ask a question..."
                    style={{ flex: 1, padding: '8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
                  />
                  <button
                    type="submit"
                    style={{
                      padding: '8px 14px',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--brand)',
                      color: '#fff',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Ask KB
                  </button>
                </form>

                {kbQueryRes && (
                  <div style={{ display: 'grid', gap: '10px' }}>
                    <div
                      data-testid="kb-query-answer"
                      style={{
                        padding: '10px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--surface-raised)',
                        border: '1px solid var(--border)',
                        fontSize: '13px',
                        lineHeight: 1.5,
                      }}
                    >
                      {kbQueryRes.answer}
                    </div>

                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '6px' }}>
                        Citation Chips ({kbQueryRes.citations.length})
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {kbQueryRes.citations.map((cit) => {
                          const isSelected = activeCitation?.citationId === cit.citationId;
                          return (
                            <button
                              key={cit.citationId}
                              type="button"
                              data-testid="citation-chip"
                              aria-pressed={isSelected}
                              onClick={() => setActiveCitation(cit)}
                              style={{
                                padding: '5px 10px',
                                borderRadius: '999px',
                                border: isSelected
                                  ? '2px solid var(--brand)'
                                  : '1px solid var(--border)',
                                backgroundColor: isSelected ? 'var(--info-bg)' : 'var(--surface-raised)',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              [cit:{cit.chunkId}] · {cit.docTitle} ({cit.score.toFixed(2)})
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {activeCitation && (
                      <div
                        data-testid="cited-passage-panel"
                        style={{
                          padding: '10px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--brand)',
                          backgroundColor: 'var(--surface-raised)',
                          display: 'grid',
                          gap: '4px',
                          fontSize: '12px',
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>
                          Cited Passage: {activeCitation.docTitle} (<code>{activeCitation.chunkId}</code>)
                        </div>
                        <div style={{ color: 'var(--text-secondary)' }}>
                          Section: {activeCitation.sectionPath.join(' > ') || 'Root'} · Chars:{' '}
                          {activeCitation.charRange.start}–{activeCitation.charRange.end} · Hybrid Score:{' '}
                          {activeCitation.score.toFixed(3)}
                        </div>
                        <pre
                          style={{
                            margin: '4px 0 0 0',
                            whiteSpace: 'pre-wrap',
                            fontFamily: 'var(--font-mono, monospace)',
                            fontSize: '12px',
                          }}
                        >
                          {activeCitation.content}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: MEMORY EXPLORER & SESSION ROLLING SUMMARY */}
      {activeTab === 'memory' && (
        <div role="tabpanel" aria-labelledby="tab-memory" style={{ display: 'grid', gap: '12px' }}>
          {/* Filter + Search Bar */}
          <form
            onSubmit={(e) => void handleSearchMemory(e)}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              alignItems: 'end',
              padding: '12px',
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div style={{ flex: 2, minWidth: '180px' }}>
              <label htmlFor="mem-search-input" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                Hybrid Memory Search
              </label>
              <div style={{ position: 'relative' }}>
                <Search
                  size={13}
                  aria-hidden="true"
                  style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }}
                />
                <input
                  id="mem-search-input"
                  type="search"
                  placeholder="Search semantic/episodic memories..."
                  value={memorySearchQuery}
                  onChange={(e) => setMemorySearchQuery(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px 6px 26px', border: '1px solid var(--border)' }}
                />
              </div>
            </div>
            <div>
              <label htmlFor="mem-filter-scope" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                Scope
              </label>
              <select
                id="mem-filter-scope"
                value={filterScope}
                onChange={(e) => setFilterScope(e.target.value as 'all' | MemoryScopeDto)}
                style={{ padding: '6px', border: '1px solid var(--border)' }}
              >
                <option value="all">All scopes</option>
                <option value="user">user</option>
                <option value="session">session</option>
                <option value="agent">agent</option>
                <option value="project">project</option>
                <option value="org">org</option>
                <option value="run">run</option>
              </select>
            </div>
            <div>
              <label htmlFor="mem-filter-kind" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                Kind
              </label>
              <select
                id="mem-filter-kind"
                value={filterKind}
                onChange={(e) => setFilterKind(e.target.value as 'all' | MemoryKindDto)}
                style={{ padding: '6px', border: '1px solid var(--border)' }}
              >
                <option value="all">All kinds</option>
                <option value="semantic">semantic</option>
                <option value="episodic">episodic</option>
                <option value="procedural">procedural</option>
              </select>
            </div>
            <div>
              <label htmlFor="mem-filter-sens" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                Sensitivity
              </label>
              <select
                id="mem-filter-sens"
                value={filterSensitivity}
                onChange={(e) => setFilterSensitivity(e.target.value as 'all' | SensitivityLevelDto)}
                style={{ padding: '6px', border: '1px solid var(--border)' }}
              >
                <option value="all">All labels</option>
                <option value="public">public</option>
                <option value="internal">internal</option>
                <option value="confidential">confidential</option>
                <option value="restricted">restricted</option>
                <option value="pii">pii</option>
              </select>
            </div>
            <button
              type="submit"
              style={{
                padding: '7px 12px',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--brand)',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Search Memory
            </button>
          </form>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'start' }}>
            {/* Memory Explorer Items + Add Form */}
            <div style={{ display: 'grid', gap: '12px' }}>
              <form
                onSubmit={(e) => void handleAddMemoryItem(e)}
                style={{
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px',
                  display: 'grid',
                  gap: '8px',
                }}
              >
                <h2 style={{ margin: 0, fontSize: '15px' }}>Store Scoped Memory Item</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '6px' }}>
                  <div>
                    <label htmlFor="new-mem-scope" style={{ display: 'block', fontSize: '11px', fontWeight: 600 }}>
                      Scope
                    </label>
                    <select
                      id="new-mem-scope"
                      value={newMemScope}
                      onChange={(e) => setNewMemScope(e.target.value as MemoryScopeDto)}
                      style={{ width: '100%', padding: '5px', border: '1px solid var(--border)' }}
                    >
                      <option value="user">user</option>
                      <option value="session">session</option>
                      <option value="agent">agent</option>
                      <option value="project">project</option>
                      <option value="org">org</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="new-mem-scope-id" style={{ display: 'block', fontSize: '11px', fontWeight: 600 }}>
                      Scope / Subject ID
                    </label>
                    <input
                      id="new-mem-scope-id"
                      type="text"
                      value={newMemScopeId}
                      onChange={(e) => setNewMemScopeId(e.target.value)}
                      style={{ width: '100%', padding: '5px', border: '1px solid var(--border)' }}
                    />
                  </div>
                  <div>
                    <label htmlFor="new-mem-kind" style={{ display: 'block', fontSize: '11px', fontWeight: 600 }}>
                      Kind
                    </label>
                    <select
                      id="new-mem-kind"
                      value={newMemKind}
                      onChange={(e) => setNewMemKind(e.target.value as MemoryKindDto)}
                      style={{ width: '100%', padding: '5px', border: '1px solid var(--border)' }}
                    >
                      <option value="semantic">semantic</option>
                      <option value="episodic">episodic</option>
                      <option value="procedural">procedural</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="new-mem-sens" style={{ display: 'block', fontSize: '11px', fontWeight: 600 }}>
                      Sensitivity
                    </label>
                    <select
                      id="new-mem-sens"
                      value={newMemSensitivity}
                      onChange={(e) => setNewMemSensitivity(e.target.value as SensitivityLevelDto)}
                      style={{ width: '100%', padding: '5px', border: '1px solid var(--border)' }}
                    >
                      <option value="public">public</option>
                      <option value="internal">internal</option>
                      <option value="confidential">confidential</option>
                      <option value="restricted">restricted</option>
                      <option value="pii">pii</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="new-mem-content" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                    Memory Content
                  </label>
                  <textarea
                    id="new-mem-content"
                    rows={2}
                    required
                    value={newMemContent}
                    onChange={(e) => setNewMemContent(e.target.value)}
                    style={{ width: '100%', padding: '6px', border: '1px solid var(--border)' }}
                  />
                </div>
                <div>
                  <button
                    type="submit"
                    style={{
                      padding: '6px 12px',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--brand)',
                      color: '#fff',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    + Add Memory Item
                  </button>
                </div>
              </form>

              <div
                style={{
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px',
                  display: 'grid',
                  gap: '8px',
                }}
              >
                <h2 style={{ margin: 0, fontSize: '15px' }}>
                  Memory Items ({displayedMemoryRows.length})
                </h2>
                {displayedMemoryRows.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>
                    No matching memory items in current workspace filter.
                  </p>
                ) : (
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {displayedMemoryRows.map(({ item, score }) => (
                      <div
                        key={item.id}
                        style={{
                          padding: '8px 10px',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: 'var(--surface-raised)',
                          display: 'grid',
                          gap: '4px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <StatusChip label={`${item.scope}:${item.scopeId ?? '*'}`} tone="info" />
                            <StatusChip label={item.kind} tone="neutral" />
                            <StatusChip
                              label={item.sensitivity}
                              tone={item.sensitivity === 'restricted' || item.sensitivity === 'pii' ? 'danger' : 'neutral'}
                            />
                            {item.contradictsId && (
                              <StatusChip label="Contradiction flagged" tone="warning" />
                            )}
                            {score !== undefined && (
                              <StatusChip label={`Score: ${score.toFixed(3)}`} tone="success" />
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                              type="button"
                              aria-label={`Pin memory item ${item.id}`}
                              onClick={() => void handleTogglePin(item)}
                              style={{
                                padding: '3px 8px',
                                fontSize: '11px',
                                border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-sm)',
                                backgroundColor: item.pinned ? 'var(--warning-bg)' : 'var(--surface)',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <Pin size={11} aria-hidden="true" />
                              <span>{item.pinned ? 'Pinned' : 'Pin'}</span>
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete memory item ${item.id}`}
                              onClick={() => void handleDeleteMemoryItem(item.id)}
                              style={{
                                padding: '3px 8px',
                                fontSize: '11px',
                                border: '1px solid var(--danger)',
                                borderRadius: 'var(--radius-sm)',
                                backgroundColor: 'var(--danger-bg)',
                                color: 'var(--danger)',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <Trash2 size={11} aria-hidden="true" />
                              <span>Delete</span>
                            </button>
                          </div>
                        </div>
                        <div style={{ fontSize: '13px' }}>{item.content}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Session Rolling Summary + Right-to-Erasure */}
            <div style={{ display: 'grid', gap: '12px' }}>
              <form
                onSubmit={(e) => void handleAppendSessionTurn(e)}
                style={{
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px',
                  display: 'grid',
                  gap: '8px',
                }}
              >
                <h2 style={{ margin: 0, fontSize: '15px' }}>
                  Session Memory &amp; Rolling Summary (E0.5-1)
                </h2>
                <div>
                  <label htmlFor="session-subject-input" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                    Session Subject ID
                  </label>
                  <input
                    id="session-subject-input"
                    type="text"
                    value={sessionSubjectId}
                    onChange={(e) => setSessionSubjectId(e.target.value)}
                    style={{ width: '100%', padding: '6px', border: '1px solid var(--border)' }}
                  />
                </div>
                <div>
                  <label htmlFor="session-turn-input" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                    Append Conversation Turn
                  </label>
                  <textarea
                    id="session-turn-input"
                    rows={3}
                    value={sessionTurnText}
                    onChange={(e) => setSessionTurnText(e.target.value)}
                    style={{ width: '100%', padding: '6px', border: '1px solid var(--border)' }}
                  />
                </div>
                <button
                  type="submit"
                  style={{
                    padding: '6px 12px',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--brand)',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: 'pointer',
                    width: 'fit-content',
                  }}
                >
                  Append &amp; Compact Session
                </button>
                {activeSession && (
                  <div
                    style={{
                      padding: '8px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--surface-raised)',
                      fontSize: '12px',
                      display: 'grid',
                      gap: '4px',
                    }}
                  >
                    <div>
                      <strong>Preserved IDs:</strong>{' '}
                      {activeSession.preservedIdentifiers.join(', ') || 'None'}
                    </div>
                    <div>
                      <strong>Rolling Summary:</strong> {activeSession.rollingSummary || '(active window)'}
                    </div>
                  </div>
                )}
              </form>

              <form
                onSubmit={(e) => void handleEraseSubject(e)}
                style={{
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--danger)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px',
                  display: 'grid',
                  gap: '8px',
                }}
              >
                <h2 style={{ margin: 0, fontSize: '15px', color: 'var(--danger)' }}>
                  Privacy Right-to-Erasure (FR-MEM-5)
                </h2>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Permanently purges all scoped memory items, embeddings, and session rolling summaries for a subject and logs an audit event.
                </p>
                <div>
                  <label htmlFor="erase-subject-input" style={{ display: 'block', fontSize: '12px', fontWeight: 600 }}>
                    Subject / User ID to Erase
                  </label>
                  <input
                    id="erase-subject-input"
                    type="text"
                    required
                    value={eraseSubjectId}
                    onChange={(e) => setEraseSubjectId(e.target.value)}
                    style={{ width: '100%', padding: '6px', border: '1px solid var(--border)' }}
                  />
                </div>
                <button
                  type="submit"
                  style={{
                    padding: '7px 12px',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--danger)',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    width: 'fit-content',
                  }}
                >
                  <Eraser size={14} aria-hidden="true" />
                  <span>Erase Subject Memory</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
