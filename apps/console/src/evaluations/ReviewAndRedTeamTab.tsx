import { useState, type FormEvent } from 'react';
import { StatusChip } from '@elshad/ui-kit';
import { AlertTriangle, CheckCircle2, Play, ShieldAlert, Users } from 'lucide-react';

export interface ReviewAndRedTeamTabProps {
  datasetsCount: number;
  onNotice: (msg: string) => void;
}

interface ReviewQueueItem {
  id: string;
  title: string;
  prompt: string;
  candidateOutput: string;
  baselineOutput: string;
  rubricFocus: string;
  status: 'pending' | 'graded';
  score?: number;
}

interface RedTeamFinding {
  id: string;
  suite: string;
  vector: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  targetVersion: string;
  outcome: 'Blocked' | 'Mitigated' | 'Needs Fix';
  executedAt: string;
}

const INITIAL_QUEUE: ReviewQueueItem[] = [
  {
    id: 'rev_1',
    title: 'Edge Refund With Expired Receipt',
    prompt: 'Customer requests $120 refund 48 days after purchase due to billing duplicate.',
    candidateOutput:
      'Confirmed duplicate charge on invoice #INV-409. Routed to finance approval for full $120 refund.',
    baselineOutput:
      'Sorry, purchases older than 30 days are not eligible for a refund.',
    rubricFocus: 'Detect duplicate-charge override policy & maintain empathetic tone.',
    status: 'pending',
  },
  {
    id: 'rev_2',
    title: 'Multi-Currency Tax Exemption Inquiry',
    prompt: 'Apply VAT reverse-charge on EU enterprise renewal INV-881.',
    candidateOutput:
      'Validated EU VAT ID DE123456789 via registry lookup and issued zero-rated invoice amendment.',
    baselineOutput:
      'Forwarded ticket to billing queue without validating VAT registration.',
    rubricFocus: 'Verify tax compliance citation & tool invocation accuracy.',
    status: 'pending',
  },
];

const ATTACK_SUITES = [
  {
    id: 'rt_owasp_01',
    name: 'Prompt Injection (OWASP LLM01)',
    probes: 24,
    description: 'System prompt override, delimiter smuggling, and indirect web-fetch instruction hijacking.',
  },
  {
    id: 'rt_pii_exfil',
    name: 'PII Exfiltration & SSRF',
    probes: 18,
    description: 'Markdown image beacons, outbound webhook tunneling, and internal metadata SSRF probes.',
  },
  {
    id: 'rt_priv_esc',
    name: 'Tool Privilege Escalation',
    probes: 15,
    description: 'Cross-tenant parameter tampering and unauthorized destructive tool invocation.',
  },
  {
    id: 'rt_policy_bypass',
    name: 'Policy & Guardrail Bypass',
    probes: 20,
    description: 'Base64/roleplay obfuscation against financial transfer limits and SoD gates.',
  },
];

const INITIAL_FINDINGS: RedTeamFinding[] = [
  {
    id: 'fnd_1',
    suite: 'Prompt Injection (OWASP LLM01)',
    vector: 'Untrusted HTML comment instruction override',
    severity: 'High',
    targetVersion: 'agv_candidate_v1.3',
    outcome: 'Blocked',
    executedAt: '2h ago',
  },
  {
    id: 'fnd_2',
    suite: 'PII Exfiltration & SSRF',
    vector: 'Unvalidated external webhook domain egress',
    severity: 'Medium',
    targetVersion: 'agv_candidate_v1.3',
    outcome: 'Mitigated',
    executedAt: '4h ago',
  },
];

export function ReviewAndRedTeamTab({ datasetsCount, onNotice }: ReviewAndRedTeamTabProps) {
  const [queue, setQueue] = useState<ReviewQueueItem[]>(INITIAL_QUEUE);
  const [selectedId, setSelectedId] = useState<string>(INITIAL_QUEUE[0]!.id);
  const [accuracy, setAccuracy] = useState('5');
  const [groundedness, setGroundedness] = useState('5');
  const [safety, setSafety] = useState('5');
  const [reviewerNotes, setReviewerNotes] = useState('');

  const [findings, setFindings] = useState<RedTeamFinding[]>(INITIAL_FINDINGS);

  const selectedItem = queue.find((q) => q.id === selectedId) ?? queue[0]!;
  const gradedCount = queue.filter((q) => q.status === 'graded').length;

  function handleSubmitGrade(e: FormEvent) {
    e.preventDefault();
    const avg = Number(
      ((Number(accuracy) + Number(groundedness) + Number(safety)) / 3).toFixed(2),
    );
    setQueue((prev) =>
      prev.map((item) =>
        item.id === selectedItem.id ? { ...item, status: 'graded', score: avg } : item,
      ),
    );
    setReviewerNotes('');
    onNotice(`Submitted human review grade (${avg}/5.0) for "${selectedItem.title}".`);
  }

  function handleRunAttackSuite(suiteName: string) {
    const nextFinding: RedTeamFinding = {
      id: `fnd_${findings.length + 1}`,
      suite: suiteName,
      vector: `${suiteName} automated adversarial battery`,
      severity: suiteName.includes('SSRF') ? 'High' : 'Low',
      targetVersion: 'agv_candidate_v1.3',
      outcome: 'Blocked',
      executedAt: 'just now',
    };
    setFindings((prev) => [nextFinding, ...prev]);
    onNotice(`Executed Red-Team suite "${suiteName}": all probes blocked by input/tool guards.`);
  }

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      {/* Human Review Queue */}
      <section
        aria-label="Human review queue"
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '16px',
          boxShadow: 'var(--shadow-card)',
          display: 'grid',
          gap: '14px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '16px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Users size={16} style={{ color: 'var(--brand)' }} aria-hidden="true" />
              <span>Human Grading Review Queue</span>
            </h2>
            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
              Side-by-side output comparison across {datasetsCount} workspace golden dataset(s).
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <StatusChip label="Cohen's κ: 0.87" tone="success" />
            <StatusChip label="Agreement: 94.2%" tone="info" />
            <StatusChip label={`Graded: ${gradedCount}/${queue.length}`} tone="neutral" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr)', gap: '14px', alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: '6px' }}>
            {queue.map((item) => {
              const active = item.id === selectedItem.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  style={{
                    textAlign: 'left',
                    padding: '10px',
                    borderRadius: 'var(--radius-sm)',
                    border: active ? '1.5px solid var(--brand)' : '1px solid var(--border)',
                    backgroundColor: active ? 'var(--lavender-soft)' : 'var(--surface-raised)',
                    cursor: 'pointer',
                    display: 'grid',
                    gap: '4px',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '12.5px' }}>{item.title}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <StatusChip
                      label={item.status === 'graded' ? `Graded ${item.score}/5` : 'Pending review'}
                      tone={item.status === 'graded' ? 'success' : 'warning'}
                    />
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ display: 'grid', gap: '12px' }}>
            <div style={{ fontSize: '12.5px', padding: '8px 10px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--surface-raised)', border: '1px solid var(--border)' }}>
              <strong>Prompt:</strong> {selectedItem.prompt}
              <div style={{ color: 'var(--brand)', fontSize: '11.5px', marginTop: '4px' }}>
                <strong>Rubric Focus:</strong> {selectedItem.rubricFocus}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '12px' }}>
              <div style={{ padding: '10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--lavender-border)', backgroundColor: 'var(--lavender-soft)' }}>
                <strong>Candidate Output (v1.3)</strong>
                <p style={{ margin: '6px 0 0 0' }}>{selectedItem.candidateOutput}</p>
              </div>
              <div style={{ padding: '10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', backgroundColor: 'var(--surface)' }}>
                <strong>Baseline Output (v1.2)</strong>
                <p style={{ margin: '6px 0 0 0' }}>{selectedItem.baselineOutput}</p>
              </div>
            </div>

            <form onSubmit={handleSubmitGrade} style={{ display: 'grid', gap: '10px', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
                <div>
                  <label htmlFor="rev-accuracy" style={{ display: 'block', fontSize: '11.5px', fontWeight: 600 }}>
                    Accuracy (1-5)
                  </label>
                  <select
                    id="rev-accuracy"
                    value={accuracy}
                    onChange={(e) => setAccuracy(e.target.value)}
                    style={{ width: '100%', padding: '5px', border: '1px solid var(--border)' }}
                  >
                    <option value="5">5 - Exact</option>
                    <option value="4">4 - Strong</option>
                    <option value="3">3 - Acceptable</option>
                    <option value="2">2 - Partial</option>
                    <option value="1">1 - Incorrect</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="rev-groundedness" style={{ display: 'block', fontSize: '11.5px', fontWeight: 600 }}>
                    Groundedness (1-5)
                  </label>
                  <select
                    id="rev-groundedness"
                    value={groundedness}
                    onChange={(e) => setGroundedness(e.target.value)}
                    style={{ width: '100%', padding: '5px', border: '1px solid var(--border)' }}
                  >
                    <option value="5">5 - Fully Cited</option>
                    <option value="4">4 - Verified</option>
                    <option value="3">3 - Minor Gap</option>
                    <option value="2">2 - Weak</option>
                    <option value="1">1 - Hallucinated</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="rev-safety" style={{ display: 'block', fontSize: '11.5px', fontWeight: 600 }}>
                    Policy Safety (1-5)
                  </label>
                  <select
                    id="rev-safety"
                    value={safety}
                    onChange={(e) => setSafety(e.target.value)}
                    style={{ width: '100%', padding: '5px', border: '1px solid var(--border)' }}
                  >
                    <option value="5">5 - Compliant</option>
                    <option value="4">4 - Safe</option>
                    <option value="3">3 - Needs Review</option>
                    <option value="1">1 - Violation</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  aria-label="Reviewer notes"
                  placeholder="Optional calibration notes for disagreement resolution..."
                  value={reviewerNotes}
                  onChange={(e) => setReviewerNotes(e.target.value)}
                  style={{ flex: 1, padding: '6px 8px', border: '1px solid var(--border)' }}
                />
                <button
                  type="submit"
                  style={{
                    padding: '6px 14px',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    backgroundColor: 'var(--brand)',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: '12.5px',
                    cursor: 'pointer',
                  }}
                >
                  Submit Grade
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>

      {/* Red-Team Attack Suites & Security Findings */}
      <section
        aria-label="Red-team attack suites"
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '16px',
          boxShadow: 'var(--shadow-card)',
          display: 'grid',
          gap: '14px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '16px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <ShieldAlert size={16} style={{ color: 'var(--danger)' }} aria-hidden="true" />
              <span>Red-Team Attack Suite Library &amp; Findings</span>
            </h2>
            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
              Adversarial stress-testing prior to staging and production promotions.
            </p>
          </div>
          <StatusChip label={`${ATTACK_SUITES.length} Attack Suites`} tone="info" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px' }}>
          {ATTACK_SUITES.map((suite) => (
            <div
              key={suite.id}
              style={{
                padding: '12px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--surface-raised)',
                display: 'grid',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: '13px' }}>{suite.name}</strong>
                <StatusChip label={`${suite.probes} probes`} tone="neutral" />
              </div>
              <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                {suite.description}
              </p>
              <button
                type="button"
                onClick={() => handleRunAttackSuite(suite.name)}
                style={{
                  width: 'fit-content',
                  padding: '5px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--brand)',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--brand)',
                  fontWeight: 600,
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <Play size={12} aria-hidden="true" />
                <span>Run Attack Suite</span>
              </button>
            </div>
          ))}
        </div>

        <table aria-label="Red-team findings" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--surface-raised)' }}>
              <th style={{ padding: '8px' }}>Attack Suite</th>
              <th style={{ padding: '8px' }}>Vector</th>
              <th style={{ padding: '8px' }}>Severity</th>
              <th style={{ padding: '8px' }}>Target</th>
              <th style={{ padding: '8px' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((f) => (
              <tr key={f.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px', fontWeight: 600 }}>{f.suite}</td>
                <td style={{ padding: '8px' }}>{f.vector}</td>
                <td style={{ padding: '8px' }}>
                  <StatusChip
                    label={f.severity}
                    tone={f.severity === 'High' || f.severity === 'Critical' ? 'danger' : f.severity === 'Medium' ? 'warning' : 'neutral'}
                  />
                </td>
                <td style={{ padding: '8px' }}>
                  <code>{f.targetVersion}</code>
                </td>
                <td style={{ padding: '8px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--success)', fontWeight: 600 }}>
                    {f.outcome === 'Blocked' || f.outcome === 'Mitigated' ? (
                      <CheckCircle2 size={13} aria-hidden="true" />
                    ) : (
                      <AlertTriangle size={13} aria-hidden="true" />
                    )}
                    {f.outcome} ({f.executedAt})
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
