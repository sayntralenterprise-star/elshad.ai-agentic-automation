import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { type EnvironmentKind } from '@elshad/domain';
import {
  type CustomToolDto,
  type McpServerDto,
  type McpServerToolDto,
  type PlatformClient,
  type TestToolResultDto,
  type ToolContractDto,
} from '@elshad/sdk-ts';
import { StateView, StatusChip, SuccessNotice } from '@elshad/ui-kit';
import {
  CheckCircle2,
  FileJson,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  Wrench,
  XCircle,
} from 'lucide-react';

export interface ToolsViewProps {
  client: PlatformClient;
  workspaceId?: string;
  environment: EnvironmentKind;
}

type ToolsTab = 'registry' | 'mcp' | 'openapi';

const SAMPLE_OPENAPI_SPEC = JSON.stringify(
  {
    openapi: '3.1.0',
    info: { title: 'Billing Service API', version: '1.0.0' },
    servers: [{ url: 'https://billing.example.com/v1' }],
    paths: {
      '/invoices/{invoice_id}': {
        get: {
          operationId: 'getInvoice',
          summary: 'Retrieve an invoice by ID',
          parameters: [{ name: 'invoice_id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'OK' } },
        },
      },
      '/refunds': {
        post: {
          operationId: 'issueBillingRefund',
          summary: 'Issue a refund for an invoice',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['invoice_id', 'amount_cents'],
                  properties: {
                    invoice_id: { type: 'string' },
                    amount_cents: { type: 'number' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Created' } },
        },
      },
    },
  },
  null,
  2,
);

function sideEffectTone(
  sideEffect: string,
): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (sideEffect) {
    case 'read':
      return 'info';
    case 'write':
      return 'warning';
    case 'destructive':
    case 'external_comms':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function ToolsView({ client }: ToolsViewProps) {
  const [activeTab, setActiveTab] = useState<ToolsTab>('registry');
  const [builtinTools, setBuiltinTools] = useState<ToolContractDto[]>([]);
  const [customTools, setCustomTools] = useState<CustomToolDto[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerDto[]>([]);
  const [mcpToolsByServer, setMcpToolsByServer] = useState<Record<string, McpServerToolDto[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Search & Test Panel state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedToolName, setSelectedToolName] = useState<string | null>(null);
  const [testArgsJson, setTestArgsJson] = useState('{"invoice_id": "inv_1001"}');
  const [dryRun, setDryRun] = useState(true);
  const [simulatedOutputText, setSimulatedOutputText] = useState('');
  const [testingTool, setTestingTool] = useState(false);
  const [testResult, setTestResult] = useState<TestToolResultDto | null>(null);

  // OpenAPI Importer state
  const [openApiText, setOpenApiText] = useState(SAMPLE_OPENAPI_SPEC);
  const [importingOpenApi, setImportingOpenApi] = useState(false);

  // MCP Registration state
  const [mcpName, setMcpName] = useState('GitHub MCP');
  const [mcpTransport, setMcpTransport] = useState<'http' | 'sse' | 'stdio'>('http');
  const [mcpEndpoint, setMcpEndpoint] = useState('https://mcp.example.com/github');
  const [registeringMcp, setRegisteringMcp] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [builtins, customs, servers] = await Promise.all([
        client.tools.list().catch(() => [] as ToolContractDto[]),
        client.tools.listCustom().catch(() => [] as CustomToolDto[]),
        client.mcp.listServers().catch(() => [] as McpServerDto[]),
      ]);
      setBuiltinTools(builtins);
      setCustomTools(customs);
      setMcpServers(servers);

      const toolsMap: Record<string, McpServerToolDto[]> = {};
      for (const srv of servers) {
        const srvTools = await client.mcp.listServerTools(srv.id).catch(() => []);
        toolsMap[srv.id] = srvTools;
      }
      setMcpToolsByServer(toolsMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const combinedRegistry = useMemo(() => {
    const builtins = builtinTools.map((b) => ({
      name: b.name,
      version: b.version,
      description: b.description,
      sideEffectClass: b.sideEffectClass,
      implementation: b.implementation,
      untrustedSource: false,
      inputSchema: b.inputSchema,
      source: 'Builtin' as const,
    }));
    const customs = customTools.map((c) => ({
      name: c.name,
      version: c.version,
      description: c.description,
      sideEffectClass: c.sideEffectClass,
      implementation: c.implementation,
      untrustedSource: c.untrustedSource,
      inputSchema: c.inputSchema,
      source: 'Custom / OpenAPI' as const,
    }));
    const all = [...customs, ...builtins];
    if (!searchQuery.trim()) return all;
    const q = searchQuery.toLowerCase();
    return all.filter(
      (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
    );
  }, [builtinTools, customTools, searchQuery]);

  const selectedTool = useMemo(
    () => combinedRegistry.find((t) => t.name === selectedToolName) ?? combinedRegistry[0] ?? null,
    [combinedRegistry, selectedToolName],
  );

  const handleImportOpenApi = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setImportingOpenApi(true);
      setError(null);
      setNotice(null);
      const res = await client.tools.importOpenApi({
        spec: openApiText,
        register: true,
      });
      await loadAll();
      setNotice(
        `Imported ${res.importedTools.length} tools from OpenAPI spec "${res.specTitle}" (v${res.specVersion}).`,
      );
      setActiveTab('registry');
      if (res.importedTools[0]) {
        setSelectedToolName(res.importedTools[0].name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportingOpenApi(false);
    }
  };

  const handleTestTool = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedTool) return;
    try {
      setTestingTool(true);
      setError(null);
      const parsedArgs = JSON.parse(testArgsJson || '{}') as Record<string, unknown>;
      const res = await client.tools.test(selectedTool.name, {
        args: parsedArgs,
        dryRun,
        simulatedRawResult: simulatedOutputText.trim() ? simulatedOutputText : undefined,
      });
      setTestResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTestingTool(false);
    }
  };

  const handleRegisterMcpServer = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setRegisteringMcp(true);
      setError(null);
      setNotice(null);
      const res = await client.mcp.createServer({
        name: mcpName,
        transport: mcpTransport,
        endpoint: mcpEndpoint,
      });
      await loadAll();
      setNotice(
        `Registered MCP server "${res.server.name}" and discovered ${res.discoveredTools.length} tools (pending approval).`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegisteringMcp(false);
    }
  };

  const handleMcpApproval = async (
    toolId: string,
    status: 'approved' | 'rejected',
  ) => {
    try {
      setError(null);
      const updated = await client.mcp.updateToolApproval(toolId, status);
      await loadAll();
      setNotice(`MCP tool "${updated.name}" marked as ${updated.approvalStatus}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div style={{ display: 'grid', gap: '20px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Wrench size={24} aria-hidden="true" style={{ color: 'var(--brand)' }} />
          <div>
            <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>
              Tools, OpenAPI &amp; MCP Registry
            </h1>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
              Unified tool contracts, OpenAPI 3.1 importer, MCP server approvals, dry-run testing &amp; untrusted isolation.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <StatusChip label="FR-TL-5 Sanitization: Active" tone="success" />
          <StatusChip label="FR-TL-9 Dry-Run Ready" tone="info" />
          <button
            type="button"
            onClick={() => void loadAll()}
            aria-label="Refresh tools registry"
            style={{
              minHeight: '34px',
              padding: '6px 10px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--surface-raised)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <RefreshCw size={14} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      {notice && <SuccessNotice message={notice} />}

      {error && (
        <StateView
          state="error"
          title="Tooling Error"
          description={error}
          actionLabel="Dismiss"
          onAction={() => setError(null)}
        />
      )}

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Tools & Connections Sections"
        style={{
          display: 'flex',
          gap: '8px',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '8px',
        }}
      >
        {(
          [
            { id: 'registry', label: `Tool Registry (${combinedRegistry.length})` },
            { id: 'openapi', label: 'Import OpenAPI 3.1' },
            { id: 'mcp', label: `MCP Servers (${mcpServers.length})` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              minHeight: '34px',
              padding: '6px 14px',
              borderRadius: 'var(--radius-sm)',
              border: activeTab === tab.id ? '1px solid var(--brand)' : '1px solid var(--border)',
              backgroundColor: activeTab === tab.id ? 'var(--info-bg)' : 'var(--surface-raised)',
              color: activeTab === tab.id ? 'var(--info)' : 'var(--text-primary)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Tool Registry + Test Panel */}
      {activeTab === 'registry' && (
        <div
          role="tabpanel"
          aria-label="Tool Registry"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 380px',
            gap: '20px',
            alignItems: 'start',
          }}
        >
          {/* Left: Registry Table */}
          <div style={{ display: 'grid', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Search size={16} aria-hidden="true" style={{ color: 'var(--text-secondary)' }} />
              <label htmlFor="tool-search-input" style={{ position: 'absolute', left: '-9999px' }}>
                Search tools
              </label>
              <input
                id="tool-search-input"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tools by name or description..."
                style={{
                  flex: 1,
                  minHeight: '34px',
                  padding: '6px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            {loading ? (
              <StateView state="loading" title="Loading Tool Registry" description="Fetching tools..." />
            ) : combinedRegistry.length === 0 ? (
              <StateView
                state="empty"
                title="No tools match"
                description="Import an OpenAPI spec or clear your search filter."
              />
            ) : (
              <div
                style={{
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  overflowX: 'auto',
                }}
              >
                <table
                  aria-label="Tool Registry Table"
                  style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}
                >
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '10px' }}>Name</th>
                      <th style={{ padding: '10px' }}>Side Effect</th>
                      <th style={{ padding: '10px' }}>Source</th>
                      <th style={{ padding: '10px' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {combinedRegistry.map((tool) => {
                      const isSelected = selectedTool?.name === tool.name;
                      return (
                        <tr
                          key={`${tool.source}-${tool.name}`}
                          style={{
                            borderBottom: '1px solid var(--border)',
                            backgroundColor: isSelected ? 'var(--info-bg)' : 'transparent',
                          }}
                        >
                          <td style={{ padding: '10px' }}>
                            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                              {tool.name}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                              v{tool.version} &bull; {tool.description}
                            </div>
                          </td>
                          <td style={{ padding: '10px' }}>
                            <StatusChip
                              label={tool.sideEffectClass}
                              tone={sideEffectTone(tool.sideEffectClass)}
                            />
                          </td>
                          <td style={{ padding: '10px', fontSize: '12px' }}>{tool.source}</td>
                          <td style={{ padding: '10px' }}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedToolName(tool.name);
                                setTestResult(null);
                              }}
                              style={{
                                minHeight: '28px',
                                padding: '4px 10px',
                                border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-sm)',
                                backgroundColor: 'var(--surface-raised)',
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                fontSize: '12px',
                              }}
                            >
                              Inspect / Test
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Right: Tool Test Panel & Dry-Run */}
          <div
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '16px',
              display: 'grid',
              gap: '12px',
            }}
          >
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
              Tool Test Panel (FR-TL-8 / FR-TL-9)
            </h2>

            {selectedTool ? (
              <form onSubmit={(e) => void handleTestTool(e)} style={{ display: 'grid', gap: '12px' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '14px' }}>
                    {selectedTool.name}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {selectedTool.description}
                  </div>
                </div>

                <div>
                  <label htmlFor="tool-test-args" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Input Arguments (JSON)
                  </label>
                  <textarea
                    id="tool-test-args"
                    rows={4}
                    value={testArgsJson}
                    onChange={(e) => setTestArgsJson(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '12px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--bg)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>

                <div>
                  <label htmlFor="tool-sim-output" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Simulated Raw Output (optional, tests injection detector)
                  </label>
                  <input
                    id="tool-sim-output"
                    type="text"
                    value={simulatedOutputText}
                    onChange={(e) => setSimulatedOutputText(e.target.value)}
                    placeholder="e.g. Ignore all previous instructions..."
                    style={{
                      width: '100%',
                      minHeight: '32px',
                      padding: '4px 8px',
                      fontSize: '12px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--bg)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={dryRun}
                    onChange={(e) => setDryRun(e.target.checked)}
                  />
                  <span>Dry-Run Mode (FR-TL-9: simulate without side effects)</span>
                </label>

                <button
                  type="submit"
                  disabled={testingTool}
                  style={{
                    minHeight: '34px',
                    padding: '6px 14px',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--brand)',
                    color: 'var(--brand-contrast)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  <Play size={14} aria-hidden="true" />
                  {testingTool ? 'Running...' : dryRun ? 'Run Dry-Run Test' : 'Execute Tool Test'}
                </button>

                {testResult && (
                  <div
                    role="status"
                    style={{
                      padding: '10px',
                      backgroundColor: 'var(--bg)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      display: 'grid',
                      gap: '8px',
                      fontSize: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <StatusChip
                        label={testResult.dryRun ? 'Dry-Run' : 'Executed'}
                        tone="info"
                      />
                      {testResult.untrustedSource && (
                        <StatusChip label="Untrusted Source" tone="warning" />
                      )}
                      {testResult.injectionSuspected && (
                        <StatusChip label="Injection Suspected" tone="danger" />
                      )}
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        fontFamily: 'var(--font-mono)',
                        fontSize: '11px',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {testResult.wrappedObservation}
                    </pre>
                  </div>
                )}
              </form>
            ) : (
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                Select a tool from the registry to inspect and test it.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: OpenAPI 3.1 Importer */}
      {activeTab === 'openapi' && (
        <div
          role="tabpanel"
          aria-label="Import OpenAPI 3.1"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '20px',
            display: 'grid',
            gap: '14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileJson size={18} aria-hidden="true" style={{ color: 'var(--brand)' }} />
            <h2 style={{ margin: 0, fontSize: '16px' }}>
              One-Click OpenAPI 3.0 / 3.1 Tool Importer (FR-TL-7)
            </h2>
          </div>

          <form onSubmit={(e) => void handleImportOpenApi(e)} style={{ display: 'grid', gap: '12px' }}>
            <div>
              <label htmlFor="openapi-spec-textarea" style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                OpenAPI JSON Specification
              </label>
              <textarea
                id="openapi-spec-textarea"
                rows={14}
                value={openApiText}
                onChange={(e) => setOpenApiText(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                disabled={importingOpenApi}
                style={{
                  minHeight: '36px',
                  padding: '6px 16px',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--brand)',
                  color: 'var(--brand-contrast)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Plus size={16} aria-hidden="true" />
                {importingOpenApi ? 'Importing...' : 'Import OpenAPI Tools'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tab 3: MCP Servers & Approval Gate */}
      {activeTab === 'mcp' && (
        <div role="tabpanel" aria-label="MCP Servers" style={{ display: 'grid', gap: '20px' }}>
          {/* Register MCP Server Form */}
          <form
            onSubmit={(e) => void handleRegisterMcpServer(e)}
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '16px',
              display: 'grid',
              gridTemplateColumns: '1fr 140px 1.5fr auto',
              gap: '12px',
              alignItems: 'end',
            }}
          >
            <div>
              <label htmlFor="mcp-name-input" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                MCP Server Name
              </label>
              <input
                id="mcp-name-input"
                type="text"
                value={mcpName}
                onChange={(e) => setMcpName(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: '34px',
                  padding: '6px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            <div>
              <label htmlFor="mcp-transport-select" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                Transport
              </label>
              <select
                id="mcp-transport-select"
                value={mcpTransport}
                onChange={(e) => setMcpTransport(e.target.value as 'http' | 'sse' | 'stdio')}
                style={{
                  width: '100%',
                  minHeight: '34px',
                  padding: '6px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg)',
                  color: 'var(--text-primary)',
                }}
              >
                <option value="http">HTTP</option>
                <option value="sse">SSE</option>
                <option value="stdio">stdio</option>
              </select>
            </div>

            <div>
              <label htmlFor="mcp-endpoint-input" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                Endpoint URL or Command
              </label>
              <input
                id="mcp-endpoint-input"
                type="text"
                value={mcpEndpoint}
                onChange={(e) => setMcpEndpoint(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: '34px',
                  padding: '6px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={registeringMcp}
              style={{
                minHeight: '34px',
                padding: '6px 14px',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--brand)',
                color: 'var(--brand-contrast)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {registeringMcp ? 'Connecting...' : 'Register MCP Server'}
            </button>
          </form>

          {/* Registered MCP Servers List */}
          {mcpServers.length === 0 ? (
            <StateView
              state="empty"
              title="No MCP Servers Registered"
              description="Register an external MCP server above to discover and approve tools."
            />
          ) : (
            <div style={{ display: 'grid', gap: '14px' }}>
              {mcpServers.map((srv) => {
                const srvTools = mcpToolsByServer[srv.id] ?? [];
                return (
                  <div
                    key={srv.id}
                    style={{
                      backgroundColor: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                      padding: '16px',
                      display: 'grid',
                      gap: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Server size={18} aria-hidden="true" style={{ color: 'var(--brand)' }} />
                        <strong style={{ fontSize: '15px' }}>{srv.name}</strong>
                        <StatusChip label={srv.transport.toUpperCase()} tone="info" />
                        <StatusChip label={srv.status} tone="success" />
                      </div>
                      <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                        {srv.endpoint}
                      </span>
                    </div>

                    <table
                      aria-label={`Discovered tools for ${srv.name}`}
                      style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}
                    >
                      <thead>
                        <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                          <th style={{ padding: '8px' }}>Tool Name</th>
                          <th style={{ padding: '8px' }}>Side Effect</th>
                          <th style={{ padding: '8px' }}>Approval Status</th>
                          <th style={{ padding: '8px' }}>Registry Gate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {srvTools.map((t) => (
                          <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '8px' }}>
                              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                                {t.name}
                              </div>
                              <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                {t.description ?? 'MCP tool capability'}
                              </div>
                            </td>
                            <td style={{ padding: '8px' }}>
                              <StatusChip
                                label={t.sideEffectClass}
                                tone={sideEffectTone(t.sideEffectClass)}
                              />
                            </td>
                            <td style={{ padding: '8px' }}>
                              <StatusChip
                                label={t.approvalStatus}
                                tone={
                                  t.approvalStatus === 'approved'
                                    ? 'success'
                                    : t.approvalStatus === 'rejected'
                                      ? 'danger'
                                      : 'warning'
                                }
                              />
                            </td>
                            <td style={{ padding: '8px', display: 'flex', gap: '6px' }}>
                              {t.approvalStatus !== 'approved' && (
                                <button
                                  type="button"
                                  onClick={() => void handleMcpApproval(t.id, 'approved')}
                                  style={{
                                    minHeight: '28px',
                                    padding: '4px 10px',
                                    border: '1px solid var(--success)',
                                    borderRadius: 'var(--radius-sm)',
                                    backgroundColor: 'var(--success-bg)',
                                    color: 'var(--success)',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                  }}
                                >
                                  <CheckCircle2 size={12} aria-hidden="true" />
                                  Approve
                                </button>
                              )}
                              {t.approvalStatus !== 'rejected' && (
                                <button
                                  type="button"
                                  onClick={() => void handleMcpApproval(t.id, 'rejected')}
                                  style={{
                                    minHeight: '28px',
                                    padding: '4px 10px',
                                    border: '1px solid var(--danger)',
                                    borderRadius: 'var(--radius-sm)',
                                    backgroundColor: 'var(--danger-bg)',
                                    color: 'var(--danger)',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                  }}
                                >
                                  <XCircle size={12} aria-hidden="true" />
                                  Block
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}

          <div
            style={{
              padding: '10px 14px',
              backgroundColor: 'var(--info-bg)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              color: 'var(--info)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <ShieldAlert size={16} aria-hidden="true" />
            <span>
              <strong>FR-TL-1 Security Gate:</strong> Remote MCP tools start in <code>pending_approval</code> and are blocked from agent runtime invocation until explicitly approved.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
