import { useMemo, type CSSProperties } from 'react';

export interface NodeConfigFormProps {
  nodeType: string;
  nodeConfigInput: string;
  onUpdateNodeConfig: (raw: string) => void;
}

const fieldStyle: CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  fontSize: '12px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  backgroundColor: 'var(--surface)',
  color: 'var(--text-primary)',
};

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: '11.5px',
  fontWeight: 600,
  marginBottom: '2px',
};

export function NodeConfigForm({
  nodeType,
  nodeConfigInput,
  onUpdateNodeConfig,
}: NodeConfigFormProps) {
  const cfg = useMemo<Record<string, unknown>>(() => {
    try {
      const parsed = JSON.parse(nodeConfigInput) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Fallback to empty object while user is typing invalid raw JSON
    }
    return {};
  }, [nodeConfigInput]);

  function patchConfig(patch: Record<string, unknown>) {
    const next = { ...cfg, ...patch };
    onUpdateNodeConfig(JSON.stringify(next, null, 2));
  }

  switch (nodeType) {
    case 'trigger.webhook': {
      const authObj =
        cfg.auth && typeof cfg.auth === 'object' && !Array.isArray(cfg.auth)
          ? (cfg.auth as Record<string, unknown>)
          : { mode: typeof cfg.auth === 'string' ? cfg.auth : 'none' };
      return (
        <div style={{ display: 'grid', gap: '8px' }}>
          <div>
            <label htmlFor="node-cfg-webhook-path" style={labelStyle}>
              Webhook Path
            </label>
            <input
              id="node-cfg-webhook-path"
              type="text"
              value={String(cfg.path ?? '')}
              onChange={(e) => patchConfig({ path: e.target.value })}
              style={fieldStyle}
            />
          </div>
          <div>
            <label htmlFor="node-cfg-webhook-auth" style={labelStyle}>
              Auth Mode
            </label>
            <select
              id="node-cfg-webhook-auth"
              value={String(authObj.mode ?? 'none')}
              onChange={(e) => patchConfig({ auth: { ...authObj, mode: e.target.value } })}
              style={fieldStyle}
            >
              <option value="none">none</option>
              <option value="token">token</option>
              <option value="hmac">hmac</option>
              <option value="jwt">jwt</option>
            </select>
          </div>
        </div>
      );
    }

    case 'trigger.schedule':
      return (
        <div style={{ display: 'grid', gap: '8px' }}>
          <div>
            <label htmlFor="node-cfg-cron" style={labelStyle}>
              Cron Expression
            </label>
            <input
              id="node-cfg-cron"
              type="text"
              value={String(cfg.cron ?? '*/15 * * * *')}
              onChange={(e) => patchConfig({ cron: e.target.value })}
              style={fieldStyle}
            />
          </div>
          <div>
            <label htmlFor="node-cfg-misfire" style={labelStyle}>
              Misfire Policy
            </label>
            <select
              id="node-cfg-misfire"
              value={String(cfg.misfire_policy ?? cfg.misfire ?? 'run_once')}
              onChange={(e) => patchConfig({ misfire_policy: e.target.value })}
              style={fieldStyle}
            >
              <option value="run_once">run_once</option>
              <option value="skip">skip</option>
              <option value="run_all">run_all</option>
            </select>
          </div>
        </div>
      );

    case 'trigger.manual':
      return (
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
          Manual trigger accepts any JSON trigger payload when started from Canvas or API.
        </div>
      );

    case 'ai.agent':
      return (
        <div style={{ display: 'grid', gap: '8px' }}>
          <div>
            <label htmlFor="node-cfg-agent-id" style={labelStyle}>
              Agent ID / Slug
            </label>
            <input
              id="node-cfg-agent-id"
              type="text"
              value={String(cfg.agent ?? 'triage-agent')}
              onChange={(e) => patchConfig({ agent: e.target.value })}
              style={fieldStyle}
            />
          </div>
          <div>
            <label htmlFor="node-cfg-agent-input" style={labelStyle}>
              Input / Prompt Expression
            </label>
            <input
              id="node-cfg-agent-input"
              type="text"
              value={String(cfg.input ?? cfg.prompt ?? '={{ $json }}')}
              onChange={(e) => patchConfig({ input: e.target.value })}
              style={fieldStyle}
            />
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={Boolean(cfg.dry_run)}
              onChange={(e) => patchConfig({ dry_run: e.target.checked })}
            />
            <span>Dry-run mode (no external side effects)</span>
          </label>
        </div>
      );

    case 'ai.llm':
      return (
        <div style={{ display: 'grid', gap: '8px' }}>
          <div>
            <label htmlFor="node-cfg-llm-tier" style={labelStyle}>
              Model Tier
            </label>
            <select
              id="node-cfg-llm-tier"
              value={String(cfg.tier ?? 'standard')}
              onChange={(e) => patchConfig({ tier: e.target.value })}
              style={fieldStyle}
            >
              <option value="fast">fast</option>
              <option value="standard">standard</option>
              <option value="reasoning">reasoning</option>
            </select>
          </div>
          <div>
            <label htmlFor="node-cfg-llm-prompt" style={labelStyle}>
              Prompt Template
            </label>
            <textarea
              id="node-cfg-llm-prompt"
              rows={2}
              value={String(cfg.prompt ?? '')}
              onChange={(e) => patchConfig({ prompt: e.target.value })}
              style={fieldStyle}
            />
          </div>
        </div>
      );

    case 'logic.if':
      return (
        <div>
          <label htmlFor="node-cfg-if-condition" style={labelStyle}>
            Boolean Condition (JSONata)
          </label>
          <input
            id="node-cfg-if-condition"
            type="text"
            value={String(cfg.condition ?? '=$prev.ok = true')}
            onChange={(e) => patchConfig({ condition: e.target.value })}
            style={fieldStyle}
          />
        </div>
      );

    case 'logic.switch':
      return (
        <div style={{ display: 'grid', gap: '6px' }}>
          <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
            Evaluates cases in order; falls back to <code>default</code> port when enabled.
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={cfg.default !== false}
              onChange={(e) => patchConfig({ default: e.target.checked })}
            />
            <span>Enable default fallback port</span>
          </label>
        </div>
      );

    case 'logic.loop':
      return (
        <div style={{ display: 'grid', gap: '8px' }}>
          <div>
            <label htmlFor="node-cfg-loop-items" style={labelStyle}>
              Items Expression
            </label>
            <input
              id="node-cfg-loop-items"
              type="text"
              value={String(cfg.items ?? '=$prev.items')}
              onChange={(e) => patchConfig({ items: e.target.value })}
              style={fieldStyle}
            />
          </div>
          <div>
            <label htmlFor="node-cfg-loop-max" style={labelStyle}>
              Max Iterations
            </label>
            <input
              id="node-cfg-loop-max"
              type="number"
              min={1}
              value={Number(cfg.max_iterations ?? 100)}
              onChange={(e) => patchConfig({ max_iterations: Math.max(1, Number(e.target.value) || 1) })}
              style={fieldStyle}
            />
          </div>
        </div>
      );

    case 'logic.wait':
      return (
        <div style={{ display: 'grid', gap: '8px' }}>
          <div>
            <label htmlFor="node-cfg-wait-ms" style={labelStyle}>
              Delay (ms)
            </label>
            <input
              id="node-cfg-wait-ms"
              type="number"
              min={0}
              value={Number(cfg.duration_ms ?? cfg.delay_ms ?? 1000)}
              onChange={(e) => patchConfig({ duration_ms: Math.max(0, Number(e.target.value) || 0) })}
              style={fieldStyle}
            />
          </div>
          <div>
            <label htmlFor="node-cfg-wait-reason" style={labelStyle}>
              Wait Reason
            </label>
            <input
              id="node-cfg-wait-reason"
              type="text"
              value={String(cfg.reason ?? 'Waiting on timer')}
              onChange={(e) => patchConfig({ reason: e.target.value })}
              style={fieldStyle}
            />
          </div>
        </div>
      );

    case 'logic.parallel':
      return (
        <div>
          <label htmlFor="node-cfg-parallel-cap" style={labelStyle}>
            Concurrency Cap
          </label>
          <input
            id="node-cfg-parallel-cap"
            type="number"
            min={1}
            max={50}
            value={Number(cfg.concurrency_cap ?? 5)}
            onChange={(e) => patchConfig({ concurrency_cap: Math.max(1, Number(e.target.value) || 1) })}
            style={fieldStyle}
          />
        </div>
      );

    case 'logic.join':
      return (
        <div>
          <label htmlFor="node-cfg-join-mode" style={labelStyle}>
            Join Mode
          </label>
          <select
            id="node-cfg-join-mode"
            value={String(cfg.join_mode ?? 'all')}
            onChange={(e) => patchConfig({ join_mode: e.target.value })}
            style={fieldStyle}
          >
            <option value="all">all</option>
            <option value="any">any</option>
            <option value="n_of_m">n_of_m</option>
          </select>
        </div>
      );

    case 'data.code':
      return (
        <div style={{ display: 'grid', gap: '8px' }}>
          <div>
            <label htmlFor="node-cfg-code-lang" style={labelStyle}>
              Sandbox Language
            </label>
            <select
              id="node-cfg-code-lang"
              value={String(cfg.language ?? 'javascript')}
              onChange={(e) => patchConfig({ language: e.target.value })}
              style={fieldStyle}
            >
              <option value="javascript">javascript</option>
              <option value="python">python</option>
            </select>
          </div>
          <div>
            <label htmlFor="node-cfg-code-src" style={labelStyle}>
              Code
            </label>
            <textarea
              id="node-cfg-code-src"
              rows={2}
              value={String(cfg.code ?? 'return items;')}
              onChange={(e) => patchConfig({ code: e.target.value })}
              style={{ ...fieldStyle, fontFamily: 'var(--font-mono, monospace)' }}
            />
          </div>
        </div>
      );

    case 'integration.http':
      return (
        <div style={{ display: 'grid', gap: '8px' }}>
          <div>
            <label htmlFor="node-cfg-http-method" style={labelStyle}>
              HTTP Method
            </label>
            <select
              id="node-cfg-http-method"
              value={String(cfg.method ?? 'GET')}
              onChange={(e) => patchConfig({ method: e.target.value })}
              style={fieldStyle}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>
          <div>
            <label htmlFor="node-cfg-http-url" style={labelStyle}>
              Request URL (SSRF-guarded)
            </label>
            <input
              id="node-cfg-http-url"
              type="url"
              value={String(cfg.url ?? '')}
              onChange={(e) => patchConfig({ url: e.target.value })}
              style={fieldStyle}
            />
          </div>
        </div>
      );

    case 'integration.db':
      return (
        <div style={{ display: 'grid', gap: '8px' }}>
          <div>
            <label htmlFor="node-cfg-db-source" style={labelStyle}>
              Data Source
            </label>
            <input
              id="node-cfg-db-source"
              type="text"
              value={String(cfg.source ?? 'primary_pg')}
              onChange={(e) => patchConfig({ source: e.target.value })}
              style={fieldStyle}
            />
          </div>
          <div>
            <label htmlFor="node-cfg-db-query" style={labelStyle}>
              SQL Query
            </label>
            <textarea
              id="node-cfg-db-query"
              rows={2}
              value={String(cfg.query ?? '')}
              onChange={(e) => patchConfig({ query: e.target.value })}
              style={{ ...fieldStyle, fontFamily: 'var(--font-mono, monospace)' }}
            />
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={cfg.readonly !== false}
              onChange={(e) => patchConfig({ readonly: e.target.checked })}
            />
            <span>Enforce read-only query guard</span>
          </label>
        </div>
      );

    case 'integration.crm':
      return (
        <div style={{ display: 'grid', gap: '8px' }}>
          <div>
            <label htmlFor="node-cfg-crm-provider" style={labelStyle}>
              CRM Provider
            </label>
            <select
              id="node-cfg-crm-provider"
              value={String(cfg.provider ?? 'salesforce')}
              onChange={(e) => patchConfig({ provider: e.target.value })}
              style={fieldStyle}
            >
              <option value="salesforce">salesforce</option>
              <option value="hubspot">hubspot</option>
              <option value="custom">custom</option>
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <div>
              <label htmlFor="node-cfg-crm-object" style={labelStyle}>
                Object
              </label>
              <input
                id="node-cfg-crm-object"
                type="text"
                value={String(cfg.object ?? 'Lead')}
                onChange={(e) => patchConfig({ object: e.target.value })}
                style={fieldStyle}
              />
            </div>
            <div>
              <label htmlFor="node-cfg-crm-op" style={labelStyle}>
                Operation
              </label>
              <select
                id="node-cfg-crm-op"
                value={String(cfg.operation ?? 'upsert')}
                onChange={(e) => patchConfig({ operation: e.target.value })}
                style={fieldStyle}
              >
                <option value="upsert">upsert</option>
                <option value="create">create</option>
                <option value="update">update</option>
                <option value="query">query</option>
              </select>
            </div>
          </div>
        </div>
      );

    case 'human.approval':
      return (
        <div style={{ display: 'grid', gap: '8px' }}>
          <div>
            <label htmlFor="node-cfg-approval-role" style={labelStyle}>
              Approver Role
            </label>
            <input
              id="node-cfg-approval-role"
              type="text"
              value={String(cfg.approverRole ?? 'operator')}
              onChange={(e) => patchConfig({ approverRole: e.target.value })}
              style={fieldStyle}
            />
          </div>
          <div>
            <label htmlFor="node-cfg-approval-timeout" style={labelStyle}>
              Timeout (minutes)
            </label>
            <input
              id="node-cfg-approval-timeout"
              type="number"
              min={1}
              value={Number(cfg.timeoutMinutes ?? 60)}
              onChange={(e) => patchConfig({ timeoutMinutes: Math.max(1, Number(e.target.value) || 1) })}
              style={fieldStyle}
            />
          </div>
        </div>
      );

    case 'human.notify':
      return (
        <div style={{ display: 'grid', gap: '8px' }}>
          <div>
            <label htmlFor="node-cfg-notify-channel" style={labelStyle}>
              Channel
            </label>
            <select
              id="node-cfg-notify-channel"
              value={String(cfg.channel ?? 'slack')}
              onChange={(e) => patchConfig({ channel: e.target.value })}
              style={fieldStyle}
            >
              <option value="slack">slack</option>
              <option value="teams">teams</option>
              <option value="email">email</option>
              <option value="sms">sms</option>
              <option value="webhook">webhook</option>
            </select>
          </div>
          <div>
            <label htmlFor="node-cfg-notify-tpl" style={labelStyle}>
              Message Template
            </label>
            <textarea
              id="node-cfg-notify-tpl"
              rows={2}
              value={String(cfg.template ?? cfg.message ?? '')}
              onChange={(e) => patchConfig({ template: e.target.value })}
              style={fieldStyle}
            />
          </div>
        </div>
      );

    case 'control.subworkflow':
      return (
        <div>
          <label htmlFor="node-cfg-subwf" style={labelStyle}>
            Target Workflow Slug / ID
          </label>
          <input
            id="node-cfg-subwf"
            type="text"
            value={String(cfg.workflow ?? cfg.workflow_id ?? '')}
            onChange={(e) => patchConfig({ workflow: e.target.value })}
            style={fieldStyle}
          />
        </div>
      );

    case 'control.stop':
      return (
        <div style={{ display: 'grid', gap: '8px' }}>
          <div>
            <label htmlFor="node-cfg-stop-status" style={labelStyle}>
              Terminal Status
            </label>
            <select
              id="node-cfg-stop-status"
              value={String(cfg.status ?? 'succeeded')}
              onChange={(e) => patchConfig({ status: e.target.value })}
              style={fieldStyle}
            >
              <option value="succeeded">succeeded</option>
              <option value="failed">failed</option>
            </select>
          </div>
          <div>
            <label htmlFor="node-cfg-stop-msg" style={labelStyle}>
              Exit Message
            </label>
            <input
              id="node-cfg-stop-msg"
              type="text"
              value={String(cfg.message ?? 'Workflow stopped cleanly.')}
              onChange={(e) => patchConfig({ message: e.target.value })}
              style={fieldStyle}
            />
          </div>
        </div>
      );

    default:
      return null;
  }
}
