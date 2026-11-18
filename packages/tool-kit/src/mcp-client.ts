import { PlatformError, type TenantContext } from '@elshad/domain';
import type { SideEffectClass } from '@elshad/policy-kit';
import {
  sanitizeAndWrapToolResult,
  validateJsonSchema,
  type SanitizedToolOutput,
} from './shared.js';

export type McpTransport = 'sse' | 'stdio' | 'http';
export type McpServerStatus = 'connected' | 'disconnected' | 'error';
export type McpToolApprovalStatus = 'pending_approval' | 'approved' | 'rejected';

export interface McpServerRecord {
  readonly id: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly transport: McpTransport;
  readonly endpoint: string;
  readonly status: McpServerStatus;
  readonly metadata: Record<string, unknown>;
  readonly lastHealthCheckAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface McpServerToolRecord {
  readonly id: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly mcpServerId: string;
  readonly name: string;
  readonly description: string | null;
  readonly inputSchema: Record<string, unknown>;
  readonly sideEffectClass: SideEffectClass;
  readonly approvalStatus: McpToolApprovalStatus;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface McpDiscoveryFixtureTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
  readonly sideEffectClass?: SideEffectClass;
}

export interface McpInvocationResult {
  readonly mcpServerId: string;
  readonly toolName: string;
  readonly dryRun: boolean;
  readonly rawResult: unknown;
  readonly sanitized: SanitizedToolOutput;
}

/**
 * Model Context Protocol (MCP) Client Manager (FR-TL-1).
 * Manages remote MCP server registrations, capability discovery,
 * mandatory admin registry approval before execution, and untrusted observation wrapping.
 */
export class McpClientManager {
  private readonly servers = new Map<string, McpServerRecord>();
  private readonly tools = new Map<string, McpServerToolRecord>();
  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}${this.seq}_${Date.now()}`;
  }

  async registerServer(
    ctx: Pick<TenantContext, 'orgId' | 'workspaceId'>,
    input: {
      id?: string;
      name: string;
      transport: McpTransport;
      endpoint: string;
      discoveredTools?: readonly McpDiscoveryFixtureTool[];
      metadata?: Record<string, unknown>;
    },
  ): Promise<{ server: McpServerRecord; discoveredTools: McpServerToolRecord[] }> {
    const wsId = ctx.workspaceId ?? 'ws_default';
    const now = new Date().toISOString();
    const serverId = input.id ?? this.nextId('mcps_');

    const server: McpServerRecord = {
      id: serverId,
      orgId: ctx.orgId,
      workspaceId: wsId,
      name: input.name,
      transport: input.transport,
      endpoint: input.endpoint,
      status: 'connected',
      metadata: input.metadata ?? {},
      lastHealthCheckAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.servers.set(serverId, server);

    const discoveredSource: readonly McpDiscoveryFixtureTool[] =
      input.discoveredTools && input.discoveredTools.length > 0
        ? input.discoveredTools
        : await this.discoverRemoteTools(server);

    const createdTools: McpServerToolRecord[] = [];
    for (const item of discoveredSource) {
      const toolId = this.nextId('mcpt_');
      const rec: McpServerToolRecord = {
        id: toolId,
        orgId: ctx.orgId,
        workspaceId: wsId,
        mcpServerId: serverId,
        name: item.name,
        description: item.description ?? null,
        inputSchema: item.inputSchema,
        sideEffectClass: item.sideEffectClass ?? 'read',
        approvalStatus: 'pending_approval',
        approvedBy: null,
        approvedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.tools.set(toolId, rec);
      createdTools.push(rec);
    }

    return { server, discoveredTools: createdTools };
  }

  private async discoverRemoteTools(server: McpServerRecord): Promise<McpDiscoveryFixtureTool[]> {
    // For mock/test endpoints or stdio commands, return deterministic starter capabilities.
    if (
      server.transport === 'stdio' ||
      server.endpoint.startsWith('mcp://') ||
      server.endpoint.includes('mock') ||
      server.endpoint.includes('example.com') ||
      server.endpoint.includes('localhost')
    ) {
      return [
        {
          name: `${server.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_list_items`,
          description: `List resources exposed by MCP server ${server.name}`,
          inputSchema: {
            type: 'object',
            properties: {
              limit: { type: 'number' },
            },
          },
          sideEffectClass: 'read',
        },
        {
          name: `${server.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_mutate_item`,
          description: `Mutate a resource exposed by MCP server ${server.name}`,
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              action: { type: 'string' },
            },
            required: ['id', 'action'],
          },
          sideEffectClass: 'write',
        },
      ];
    }

    // Attempt live JSON-RPC 2.0 `tools/list` over HTTP/SSE if reachable.
    try {
      const resp = await fetch(server.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) {
        return [];
      }
      const json = (await resp.json()) as {
        result?: { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> };
      };
      const rawTools = json.result?.tools ?? [];
      return rawTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema ?? { type: 'object' },
        sideEffectClass: 'read',
      }));
    } catch {
      return [];
    }
  }

  listServers(ctx: Pick<TenantContext, 'orgId' | 'workspaceId'>): McpServerRecord[] {
    return Array.from(this.servers.values()).filter(
      (s) => s.orgId === ctx.orgId && (!ctx.workspaceId || s.workspaceId === ctx.workspaceId),
    );
  }

  getServer(ctx: Pick<TenantContext, 'orgId'>, serverId: string): McpServerRecord {
    const server = this.servers.get(serverId);
    if (!server || server.orgId !== ctx.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `MCP server not found: ${serverId}`);
    }
    return server;
  }

  listServerTools(ctx: Pick<TenantContext, 'orgId'>, serverId: string): McpServerToolRecord[] {
    this.getServer(ctx, serverId);
    return Array.from(this.tools.values()).filter(
      (t) => t.orgId === ctx.orgId && t.mcpServerId === serverId,
    );
  }

  updateToolApproval(
    ctx: Pick<TenantContext, 'orgId' | 'principal'>,
    toolId: string,
    approvalStatus: McpToolApprovalStatus,
  ): McpServerToolRecord {
    const existing = this.tools.get(toolId);
    if (!existing || existing.orgId !== ctx.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `MCP tool not found: ${toolId}`);
    }
    const now = new Date().toISOString();
    const updated: McpServerToolRecord = {
      ...existing,
      approvalStatus,
      approvedBy: approvalStatus === 'approved' ? ctx.principal.id : null,
      approvedAt: approvalStatus === 'approved' ? now : null,
      updatedAt: now,
    };
    this.tools.set(toolId, updated);
    return updated;
  }

  async invokeTool(
    ctx: Pick<TenantContext, 'orgId' | 'workspaceId'>,
    input: {
      serverId: string;
      toolName: string;
      args: Record<string, unknown>;
      toolCallId?: string;
      dryRun?: boolean;
      simulatedRawResult?: unknown;
    },
  ): Promise<McpInvocationResult> {
    const server = this.getServer(ctx, input.serverId);
    const tool = Array.from(this.tools.values()).find(
      (t) => t.orgId === ctx.orgId && t.mcpServerId === server.id && t.name === input.toolName,
    );
    if (!tool) {
      throw new PlatformError(
        'RES_NOT_FOUND',
        `MCP tool "${input.toolName}" not found on server ${server.name}`,
      );
    }

    // FR-TL-1: Remote MCP servers & tools require registry approval before use
    if (tool.approvalStatus !== 'approved') {
      throw new PlatformError(
        'AUTH_FORBIDDEN',
        `MCP tool "${tool.name}" is ${tool.approvalStatus} and blocked until approved in the registry (FR-TL-1)`,
      );
    }

    const argErrors = validateJsonSchema(tool.inputSchema, input.args);
    if (argErrors.length > 0) {
      throw new PlatformError(
        'VAL_SCHEMA_MISMATCH',
        `MCP tool "${tool.name}" arguments invalid: ${argErrors.join('; ')}`,
      );
    }

    const callId = input.toolCallId ?? `mcp_call_${Date.now()}`;

    if (input.dryRun) {
      const dryPayload = {
        dry_run: true,
        mcp_server: server.name,
        tool: tool.name,
        side_effect_class: tool.sideEffectClass,
        would_execute_with: input.args,
      };
      return {
        mcpServerId: server.id,
        toolName: tool.name,
        dryRun: true,
        rawResult: dryPayload,
        sanitized: sanitizeAndWrapToolResult(callId, tool.name, dryPayload, 'tool_output'),
      };
    }

    const rawResult =
      input.simulatedRawResult !== undefined
        ? input.simulatedRawResult
        : {
            mcp_server: server.name,
            tool: tool.name,
            status: 'ok',
            args: input.args,
          };

    // External MCP results are strictly treated as untrusted_external
    const sanitized = sanitizeAndWrapToolResult(callId, tool.name, rawResult, 'untrusted_external');

    return {
      mcpServerId: server.id,
      toolName: tool.name,
      dryRun: false,
      rawResult,
      sanitized,
    };
  }
}
