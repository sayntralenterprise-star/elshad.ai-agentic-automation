import { useCallback, useEffect, useState } from 'react';
import type {
  InvoiceExceptionOutputDto,
  PilotBenchmarkReportDto,
  PilotSpecDto,
  PlatformClient,
  SupportTriageOutputDto,
} from '@elshad/sdk-ts';
import { StateView, StatusChip } from '@elshad/ui-kit';

export interface PilotsViewProps {
  client: PlatformClient;
  workspaceId?: string;
}

const btnStyle = (primary = false): React.CSSProperties => ({
  padding: '6px 12px',
  borderRadius: '6px',
  border: '1px solid var(--color-border)',
  backgroundColor: primary ? 'var(--color-accent, #2563eb)' : 'var(--color-surface-elevated)',
  color: primary ? '#ffffff' : 'inherit',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 500,
});

export function PilotsView({ client, workspaceId }: PilotsViewProps) {
  const [pilots, setPilots] = useState<PilotSpecDto[]>([]);
  const [benchmark, setBenchmark] = useState<PilotBenchmarkReportDto | null>(null);
  const [triageOut, setTriageOut] = useState<SupportTriageOutputDto | null>(null);
  const [invoiceOut, setInvoiceOut] = useState<InvoiceExceptionOutputDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await client.pilots.list();
      setPilots(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pilot agents');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load, workspaceId]);

  async function handleRunBenchmarks() {
    setError(null);
    try {
      const res = await client.pilots.runBenchmarks();
      setBenchmark(res);
      setStatusMessage(
        res.allPassed
          ? 'All pilot golden-set KPI benchmarks passed.'
          : 'One or more pilot benchmarks failed targets.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run benchmarks');
    }
  }

  async function handleTestTriage() {
    setError(null);
    try {
      const out = await client.pilots.runSupportTriage({
        ticketId: 't_demo_1',
        subject: 'Duplicate billing charge',
        body: 'Please refund duplicate charge for alice@example.com',
        customerId: 'cust_demo_1',
      });
      setTriageOut(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run Support Triage');
    }
  }

  async function handleTestInvoice() {
    setError(null);
    try {
      const out = await client.pilots.runInvoiceException({
        invoiceId: 'inv_demo_1',
        vendorId: 'v_demo_1',
        amount: 1012,
        poAmount: 1005,
        poId: 'po_demo_1',
        mismatchType: 'price_variance',
      });
      setInvoiceOut(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run Invoice Exception');
    }
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '22px' }}>Pilot Agents &amp; Go-Live Readiness</h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--color-text-muted)' }}>
            Production pilot agents (Support Triage L1 &amp; Invoice Exception L2), golden benchmarks, and S.4 sign-off.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button type="button" style={btnStyle(true)} onClick={() => void handleRunBenchmarks()}>
            Run Golden Benchmarks
          </button>
          <button type="button" style={btnStyle()} onClick={() => void handleTestTriage()}>
            Test Support Triage (L1)
          </button>
          <button type="button" style={btnStyle()} onClick={() => void handleTestInvoice()}>
            Test Invoice Exception (L2)
          </button>
        </div>
      </div>

      {statusMessage && (
        <div
          role="status"
          style={{
            marginBottom: '12px',
            padding: '10px 12px',
            borderRadius: '6px',
            backgroundColor: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-border)',
            fontSize: '13px',
          }}
        >
          {statusMessage}
        </div>
      )}

      {error && <StateView state="error" title="Pilot error" description={error} />}

      {loading && pilots.length === 0 ? (
        <StateView
          state="loading"
          title="Loading pilot agents..."
          description="Fetching Support Triage (L1) and Invoice Exception (L2) specifications."
        />
      ) : null}

      {benchmark && (
        <section
          style={{
            padding: '14px',
            borderRadius: '8px',
            border: '1px solid var(--color-border)',
            marginBottom: '16px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h2 style={{ margin: 0, fontSize: '15px' }}>Golden Set Benchmark Results</h2>
            <StatusChip
              label={benchmark.allPassed ? 'ALL KPI TARGETS MET' : 'KPI FAILURE'}
              tone={benchmark.allPassed ? 'success' : 'danger'}
            />
          </div>
          <div style={{ fontSize: '13px', display: 'grid', gap: '4px' }}>
            <div>
              <strong>Support Triage (L1):</strong> {(benchmark.supportTriage.categoryAccuracy * 100).toFixed(0)}%
              category accuracy, {(benchmark.supportTriage.injectionBlockRate * 100).toFixed(0)}% injection blocked,
              avg ${benchmark.supportTriage.avgCostUsd.toFixed(3)}/ticket
            </div>
            <div>
              <strong>Invoice Exception (L2):</strong> {(benchmark.invoiceException.resolutionAccuracy * 100).toFixed(0)}%
              resolution accuracy, {(benchmark.invoiceException.falseAutoResolveRate * 100).toFixed(0)}% false
              auto-resolve, avg ${benchmark.invoiceException.avgCostUsd.toFixed(3)}/invoice
            </div>
          </div>
        </section>
      )}

      {triageOut && (
        <section
          style={{
            padding: '14px',
            borderRadius: '8px',
            border: '1px solid var(--color-border)',
            marginBottom: '16px',
            fontSize: '13px',
          }}
        >
          <h2 style={{ margin: '0 0 6px 0', fontSize: '15px' }}>Support Triage Sample Output</h2>
          <div>
            Category: <strong>{triageOut.category}</strong> | Priority: <strong>{triageOut.priority}</strong> | PII
            Redacted: <strong>{triageOut.piiRedacted ? 'Yes' : 'No'}</strong>
          </div>
          <p style={{ margin: '6px 0 0 0' }}>{triageOut.draftReply}</p>
        </section>
      )}

      {invoiceOut && (
        <section
          style={{
            padding: '14px',
            borderRadius: '8px',
            border: '1px solid var(--color-border)',
            marginBottom: '16px',
            fontSize: '13px',
          }}
        >
          <h2 style={{ margin: '0 0 6px 0', fontSize: '15px' }}>Invoice Exception Sample Output</h2>
          <div>
            Resolution: <strong>{invoiceOut.resolution}</strong> | Variance: ${invoiceOut.varianceUsd.toFixed(2)} (
            {invoiceOut.variancePct}%)
          </div>
          <p style={{ margin: '6px 0 0 0' }}>{invoiceOut.rationale}</p>
        </section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
        {pilots.map((pilot) => (
          <section
            key={pilot.id}
            style={{
              padding: '14px',
              borderRadius: '8px',
              border: '1px solid var(--color-border)',
              backgroundColor: 'var(--color-surface)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h2 style={{ margin: 0, fontSize: '15px' }}>{pilot.name}</h2>
              <StatusChip label={pilot.autonomyLevel} tone="neutral" />
            </div>
            <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--color-text-muted)' }}>
              Trigger: {pilot.trigger} | Limits: {pilot.limits.maxSteps} steps, ${pilot.limits.maxCostUsd.toFixed(2)}
            </p>
            <ul style={{ margin: '0 0 12px 0', paddingLeft: '18px', fontSize: '12px' }}>
              {pilot.checklist.map((item) => (
                <li key={item.id}>
                  [{item.done ? 'x' : ' '}] {item.label}
                </li>
              ))}
            </ul>
            {pilot.signedOffBy ? (
              <StatusChip label={`Signed off by ${pilot.signedOffBy}`} tone="success" />
            ) : (
              <button
                type="button"
                style={btnStyle(true)}
                onClick={async () => {
                  await client.pilots.signOff(pilot.id, 'Approved in staging readiness review');
                  setStatusMessage(`Recorded go-live sign-off for ${pilot.name}.`);
                  await load();
                }}
              >
                Sign Off {pilot.autonomyLevel} Pilot
              </button>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
