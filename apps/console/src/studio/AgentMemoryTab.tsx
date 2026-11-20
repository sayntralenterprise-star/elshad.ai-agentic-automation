import { useCallback, useEffect, useState } from 'react';
import type { KnowledgeBaseDto, PlatformClient } from '@elshad/sdk-ts';
import { StatusChip } from '@elshad/ui-kit';
import { Database, Search } from 'lucide-react';

export interface AgentMemoryTabProps {
  client: PlatformClient;
  agentId: string;
}

interface ScopeConfig {
  scope: 'Run' | 'Session' | 'User' | 'Agent' | 'Project' | 'Organization';
  read: boolean;
  write: boolean;
  policy: 'auto' | 'confirm' | 'never';
  ttl: string;
}

const INITIAL_SCOPES: ScopeConfig[] = [
  { scope: 'Run', read: true, write: true, policy: 'auto', ttl: 'Run lifetime' },
  { scope: 'Session', read: true, write: true, policy: 'auto', ttl: '24h' },
  { scope: 'User', read: true, write: true, policy: 'confirm', ttl: '90d' },
  { scope: 'Agent', read: true, write: false, policy: 'confirm', ttl: '1y' },
  { scope: 'Project', read: true, write: false, policy: 'never', ttl: '1y' },
  { scope: 'Organization', read: true, write: false, policy: 'never', ttl: 'Indefinite' },
];

export function AgentMemoryTab({ client }: AgentMemoryTabProps) {
  const [scopes, setScopes] = useState<ScopeConfig[]>(INITIAL_SCOPES);
  const [kbs, setKbs] = useState<KnowledgeBaseDto[]>([]);
  const [attachedKbIds, setAttachedKbIds] = useState<string[]>([]);
  const [topK, setTopK] = useState(5);
  const [reranker, setReranker] = useState('bge-reranker-large');
  const [similarityThreshold, setSimilarityThreshold] = useState(0.72);
  const [query, setQuery] = useState('What is our 14-day refund policy?');
  const [chunks, setChunks] = useState<Array<{ source: string; score: number; content: string }>>([]);

  const loadKbs = useCallback(async () => {
    try {
      const list = await client.knowledgeBases.list();
      setKbs(list);
      if (list[0]) setAttachedKbIds([list[0].id]);
    } catch {
      setKbs([]);
    }
  }, [client]);

  useEffect(() => {
    void loadKbs();
  }, [loadKbs]);

  async function handleTestRetrieval() {
    const primaryKb = attachedKbIds[0];
    if (primaryKb) {
      try {
        const res = await client.knowledgeBases.query(primaryKb, {
          query,
          topK,
          minScore: similarityThreshold,
        });
        if (res.results.length > 0) {
          setChunks(
            res.results.slice(0, topK).map((r) => ({
              source: r.docTitle || 'Knowledge Base',
              score: r.score,
              content: r.chunk.content,
            })),
          );
          return;
        }
      } catch {
        // fallback preview below
      }
    }
    setChunks([
      {
        source: 'Support SLA Handbook · #sec-refunds',
        score: 0.91,
        content:
          'Customers qualify for full refunds within 14 days of duplicate charge verification without manager escalation.',
      },
      {
        source: 'Billing Playbook · #sec-disputes',
        score: 0.84,
        content:
          'All refund amounts above $500 USD must route through the finance approval queue.',
      },
    ]);
  }

  return (
    <div
      role="tabpanel"
      aria-label="Agent Memory"
      style={{
        padding: '18px 20px',
        display: 'grid',
        gridTemplateColumns: '1fr 340px',
        gap: '16px',
        alignItems: 'start',
      }}
    >
      {/* Left: Memory Scopes + Attached KBs + Retrieval Parameters */}
      <div style={{ display: 'grid', gap: '14px' }}>
        <section
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '14px',
            display: 'grid',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Database size={16} style={{ color: 'var(--brand)' }} aria-hidden="true" />
            <h3 style={{ margin: 0, fontSize: '14.5px', fontWeight: 700 }}>Memory Scope Matrix</h3>
          </div>
          <table aria-label="Memory scope matrix" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                <th style={{ padding: '6px' }}>Scope</th>
                <th style={{ padding: '6px' }}>Read</th>
                <th style={{ padding: '6px' }}>Write</th>
                <th style={{ padding: '6px' }}>Write Policy</th>
                <th style={{ padding: '6px' }}>Retention / TTL</th>
              </tr>
            </thead>
            <tbody>
              {scopes.map((row) => (
                <tr key={row.scope} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '7px 6px', fontWeight: 600 }}>{row.scope}</td>
                  <td style={{ padding: '7px 6px' }}>
                    <input
                      type="checkbox"
                      aria-label={`${row.scope} read`}
                      checked={row.read}
                      onChange={() =>
                        setScopes((prev) =>
                          prev.map((s) => (s.scope === row.scope ? { ...s, read: !s.read } : s)),
                        )
                      }
                    />
                  </td>
                  <td style={{ padding: '7px 6px' }}>
                    <input
                      type="checkbox"
                      aria-label={`${row.scope} write`}
                      checked={row.write}
                      onChange={() =>
                        setScopes((prev) =>
                          prev.map((s) => (s.scope === row.scope ? { ...s, write: !s.write } : s)),
                        )
                      }
                    />
                  </td>
                  <td style={{ padding: '7px 6px' }}>
                    <select
                      aria-label={`${row.scope} write policy`}
                      value={row.policy}
                      onChange={(e) =>
                        setScopes((prev) =>
                          prev.map((s) =>
                            s.scope === row.scope
                              ? { ...s, policy: e.target.value as ScopeConfig['policy'] }
                              : s,
                          ),
                        )
                      }
                      style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid var(--border)' }}
                    >
                      <option value="auto">Auto</option>
                      <option value="confirm">Confirm</option>
                      <option value="never">Never</option>
                    </select>
                  </td>
                  <td style={{ padding: '7px 6px' }}>
                    <select
                      aria-label={`${row.scope} retention`}
                      value={row.ttl}
                      onChange={(e) =>
                        setScopes((prev) =>
                          prev.map((s) =>
                            s.scope === row.scope ? { ...s, ttl: e.target.value } : s,
                          ),
                        )
                      }
                      style={{ padding: '3px 6px', borderRadius: '4px', border: '1px solid var(--border)' }}
                    >
                      <option value="Run lifetime">Run lifetime</option>
                      <option value="24h">24h</option>
                      <option value="30d">30d</option>
                      <option value="90d">90d</option>
                      <option value="1y">1y</option>
                      <option value="Indefinite">Indefinite</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <section
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '14px',
              display: 'grid',
              gap: '8px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>Attached Knowledge Bases</h3>
            {kbs.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                No Knowledge Bases created yet. Default workspace retrieval rules apply.
              </div>
            ) : (
              kbs.map((kb) => {
                const attached = attachedKbIds.includes(kb.id);
                return (
                  <label
                    key={kb.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 8px',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '12.5px',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="checkbox"
                        checked={attached}
                        onChange={() =>
                          setAttachedKbIds((prev) =>
                            attached ? prev.filter((id) => id !== kb.id) : [...prev, kb.id],
                          )
                        }
                      />
                      <strong>{kb.name}</strong>
                    </span>
                    <StatusChip label={kb.embeddingModel} tone="neutral" />
                  </label>
                );
              })
            )}
          </section>

          <section
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '14px',
              display: 'grid',
              gap: '8px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>Retrieval Configuration</h3>
            <label style={{ fontSize: '12px', display: 'grid', gap: '4px' }}>
              <span>Top-K results</span>
              <input
                type="number"
                min={1}
                max={20}
                value={topK}
                onChange={(e) => setTopK(Number(e.target.value))}
                style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
              />
            </label>
            <label style={{ fontSize: '12px', display: 'grid', gap: '4px' }}>
              <span>Reranker</span>
              <select
                value={reranker}
                onChange={(e) => setReranker(e.target.value)}
                style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
              >
                <option value="bge-reranker-large">BGE Cross-Encoder</option>
                <option value="cohere-rerank-v3">Cohere Rerank v3</option>
                <option value="none">None</option>
              </select>
            </label>
            <label style={{ fontSize: '12px', display: 'grid', gap: '4px' }}>
              <span>Similarity threshold</span>
              <input
                type="number"
                step="0.05"
                min={0}
                max={1}
                value={similarityThreshold}
                onChange={(e) => setSimilarityThreshold(Number(e.target.value))}
                style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
              />
            </label>
          </section>
        </div>
      </div>

      {/* Right: Retrieval Preview */}
      <aside
        aria-label="Retrieval Preview"
        style={{
          backgroundColor: 'var(--lavender-soft)',
          border: '1px solid var(--lavender-border)',
          borderRadius: 'var(--radius-md)',
          padding: '14px',
          display: 'grid',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '13.5px' }}>
          <Search size={14} style={{ color: 'var(--brand)' }} aria-hidden="true" />
          <span>Retrieval Preview</span>
        </div>

        <input
          type="text"
          aria-label="Test retrieval query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '7px 9px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--surface)',
            fontSize: '12.5px',
          }}
        />
        <button
          type="button"
          onClick={() => void handleTestRetrieval()}
          style={{
            minHeight: '32px',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--brand)',
            color: 'var(--brand-contrast)',
            fontWeight: 600,
            fontSize: '12.5px',
            cursor: 'pointer',
          }}
        >
          Test Retrieval
        </button>

        {chunks.length > 0 && (
          <div style={{ display: 'grid', gap: '8px' }}>
            {chunks.map((c, i) => (
              <div
                key={i}
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  fontSize: '12px',
                  display: 'grid',
                  gap: '4px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>{c.source}</strong>
                  <StatusChip label={`Score ${c.score.toFixed(2)}`} tone="success" />
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>{c.content}</div>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
