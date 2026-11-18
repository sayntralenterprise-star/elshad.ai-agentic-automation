import { PlatformError, type EnvironmentKind, type TenantContext } from '@elshad/domain';
import type { SideEffectClass } from '@elshad/policy-kit';
import {
  sanitizeAndWrapToolResult,
  validateJsonSchema,
  type SanitizedToolOutput,
} from './shared.js';

export type ConnectorAuthType =
  | 'api_key'
  | 'oauth2'
  | 'basic'
  | 'jwt'
  | 'mtls'
  | 'aws_sigv4'
  | 'custom';

export type ConnectorCategory =
  | 'http'
  | 'database'
  | 'communication'
  | 'productivity'
  | 'engineering'
  | 'crm'
  | 'support'
  | 'payments'
  | 'storage';

export interface ConnectorActionSpec {
  readonly name: string;
  readonly description: string;
  readonly sideEffectClass: SideEffectClass;
  readonly idempotent: boolean;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema: Record<string, unknown>;
  readonly rateLimitPerMinute: number;
  readonly pagination: 'none' | 'cursor' | 'offset' | 'page';
}

export interface ConnectorTriggerSpec {
  readonly name: string;
  readonly type: 'webhook' | 'polling';
  readonly description: string;
  readonly verifyHeader?: string;
}

export interface ConnectorFixture {
  readonly name: string;
  readonly action: string;
  readonly input: Record<string, unknown>;
  readonly expectedOutput: Record<string, unknown>;
  readonly targetDomain?: string;
}

export interface ConnectorManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly category: ConnectorCategory;
  readonly description: string;
  readonly authTypes: readonly ConnectorAuthType[];
  readonly scopes: readonly string[];
  readonly egressDomains: readonly string[];
  readonly actions: readonly ConnectorActionSpec[];
  readonly triggers: readonly ConnectorTriggerSpec[];
  readonly fixtures: readonly ConnectorFixture[];
}

export interface ConnectorContractTestResult {
  readonly connectorId: string;
  readonly passed: boolean;
  readonly totalFixtures: number;
  readonly passedFixtures: number;
  readonly details: readonly {
    readonly fixtureName: string;
    readonly action: string;
    readonly passed: boolean;
    readonly errors: readonly string[];
  }[];
}

function makeSimpleConnector(params: {
  id: string;
  name: string;
  category: ConnectorCategory;
  description: string;
  authTypes: readonly ConnectorAuthType[];
  scopes: readonly string[];
  egressDomains: readonly string[];
  readAction: string;
  readDesc: string;
  readInputProp: string;
  writeAction: string;
  writeDesc: string;
  writeInputProp: string;
  triggerName: string;
  triggerType: 'webhook' | 'polling';
  verifyHeader?: string;
}): ConnectorManifest {
  return {
    id: params.id,
    name: params.name,
    version: '1.0.0',
    category: params.category,
    description: params.description,
    authTypes: params.authTypes,
    scopes: params.scopes,
    egressDomains: params.egressDomains,
    actions: [
      {
        name: params.readAction,
        description: params.readDesc,
        sideEffectClass: 'read',
        idempotent: true,
        inputSchema: {
          type: 'object',
          required: [params.readInputProp],
          properties: {
            [params.readInputProp]: { type: 'string' },
          },
        },
        outputSchema: {
          type: 'object',
          required: ['ok', 'data'],
          properties: {
            ok: { type: 'boolean' },
            data: { type: 'object' },
          },
        },
        rateLimitPerMinute: 120,
        pagination: 'cursor',
      },
      {
        name: params.writeAction,
        description: params.writeDesc,
        sideEffectClass: 'write',
        idempotent: true,
        inputSchema: {
          type: 'object',
          required: [params.writeInputProp],
          properties: {
            [params.writeInputProp]: { type: 'string' },
          },
        },
        outputSchema: {
          type: 'object',
          required: ['ok', 'id'],
          properties: {
            ok: { type: 'boolean' },
            id: { type: 'string' },
          },
        },
        rateLimitPerMinute: 60,
        pagination: 'none',
      },
    ],
    triggers: [
      {
        name: params.triggerName,
        type: params.triggerType,
        description: `Trigger fired on ${params.name} event`,
        verifyHeader: params.verifyHeader,
      },
    ],
    fixtures: [
      {
        name: `${params.id}_read_fixture`,
        action: params.readAction,
        input: { [params.readInputProp]: 'sample_123' },
        expectedOutput: { ok: true, data: { id: 'sample_123', source: params.id } },
        targetDomain: params.egressDomains[0],
      },
      {
        name: `${params.id}_write_fixture`,
        action: params.writeAction,
        input: { [params.writeInputProp]: 'payload_abc' },
        expectedOutput: { ok: true, id: `${params.id}_res_1` },
        targetDomain: params.egressDomains[0],
      },
    ],
  };
}

/**
 * PRD D17 Wave 1 Connector Catalog (16 connectors in D17 priority order).
 */
export const WAVE_1_CONNECTORS: readonly ConnectorManifest[] = [
  makeSimpleConnector({
    id: 'http_rest',
    name: 'HTTP / REST',
    category: 'http',
    description: 'Generic RESTful HTTP/JSON client with mTLS, OAuth2, API key, and egress allowlists.',
    authTypes: ['api_key', 'oauth2', 'basic', 'jwt', 'mtls', 'custom'],
    scopes: ['http:read', 'http:write'],
    egressDomains: ['api.example.com'],
    readAction: 'request.get',
    readDesc: 'Execute an HTTP GET request',
    readInputProp: 'url',
    writeAction: 'request.post',
    writeDesc: 'Execute an HTTP POST request',
    writeInputProp: 'url',
    triggerName: 'webhook.received',
    triggerType: 'webhook',
    verifyHeader: 'X-Webhook-Signature',
  }),
  makeSimpleConnector({
    id: 'postgres',
    name: 'PostgreSQL',
    category: 'database',
    description: 'Read-only default parameterized SQL queries and schema discovery for PostgreSQL.',
    authTypes: ['basic', 'mtls', 'aws_sigv4'],
    scopes: ['db:read', 'db:write'],
    egressDomains: ['db.internal.example.com'],
    readAction: 'query.select',
    readDesc: 'Run parameterized SELECT query',
    readInputProp: 'sql',
    writeAction: 'query.execute',
    writeDesc: 'Execute parameterized write statement',
    writeInputProp: 'sql',
    triggerName: 'row.inserted',
    triggerType: 'polling',
  }),
  makeSimpleConnector({
    id: 'slack',
    name: 'Slack',
    category: 'communication',
    description: 'Post interactive approval messages, read channels, and handle Slack slash/action callbacks.',
    authTypes: ['oauth2', 'api_key'],
    scopes: ['channels:read', 'chat:write', 'users:read.email'],
    egressDomains: ['slack.com', 'api.slack.com'],
    readAction: 'channels.history',
    readDesc: 'Read recent messages in a Slack channel',
    readInputProp: 'channel_id',
    writeAction: 'chat.postMessage',
    writeDesc: 'Post a message to a Slack channel',
    writeInputProp: 'text',
    triggerName: 'message.posted',
    triggerType: 'webhook',
    verifyHeader: 'X-Slack-Signature',
  }),
  makeSimpleConnector({
    id: 'gmail',
    name: 'Gmail',
    category: 'communication',
    description: 'Read email threads, parse attachments, and send replies via Gmail API.',
    authTypes: ['oauth2'],
    scopes: ['gmail.readonly', 'gmail.send'],
    egressDomains: ['gmail.googleapis.com'],
    readAction: 'messages.get',
    readDesc: 'Fetch an email message by ID',
    readInputProp: 'message_id',
    writeAction: 'messages.send',
    writeDesc: 'Send an email message',
    writeInputProp: 'to',
    triggerName: 'email.received',
    triggerType: 'webhook',
  }),
  makeSimpleConnector({
    id: 'outlook',
    name: 'Microsoft Outlook',
    category: 'communication',
    description: 'Read and send corporate emails and calendar invites via Microsoft Graph.',
    authTypes: ['oauth2'],
    scopes: ['Mail.Read', 'Mail.Send'],
    egressDomains: ['graph.microsoft.com'],
    readAction: 'mail.get',
    readDesc: 'Read an Outlook email message',
    readInputProp: 'message_id',
    writeAction: 'mail.send',
    writeDesc: 'Send an Outlook email message',
    writeInputProp: 'to',
    triggerName: 'mail.received',
    triggerType: 'webhook',
  }),
  makeSimpleConnector({
    id: 'google_workspace',
    name: 'Google Drive & Sheets',
    category: 'productivity',
    description: 'Search Drive files, export Docs, and read/append rows in Google Sheets.',
    authTypes: ['oauth2'],
    scopes: ['drive.readonly', 'spreadsheets'],
    egressDomains: ['www.googleapis.com', 'sheets.googleapis.com'],
    readAction: 'sheets.getRange',
    readDesc: 'Read cell values from a Google Sheet',
    readInputProp: 'spreadsheet_id',
    writeAction: 'sheets.appendRow',
    writeDesc: 'Append a row to a Google Sheet',
    writeInputProp: 'spreadsheet_id',
    triggerName: 'file.updated',
    triggerType: 'webhook',
  }),
  makeSimpleConnector({
    id: 'jira',
    name: 'Jira',
    category: 'engineering',
    description: 'Search issues, transition statuses, and post comments in Atlassian Jira.',
    authTypes: ['oauth2', 'api_key', 'basic'],
    scopes: ['read:jira-work', 'write:jira-work'],
    egressDomains: ['api.atlassian.com'],
    readAction: 'issue.get',
    readDesc: 'Get Jira issue details',
    readInputProp: 'issue_key',
    writeAction: 'issue.create',
    writeDesc: 'Create a new Jira issue',
    writeInputProp: 'summary',
    triggerName: 'issue.updated',
    triggerType: 'webhook',
    verifyHeader: 'X-Hub-Signature',
  }),
  makeSimpleConnector({
    id: 'github',
    name: 'GitHub',
    category: 'engineering',
    description: 'Inspect pull requests, issues, diffs, and create review comments on GitHub.',
    authTypes: ['oauth2', 'api_key', 'jwt'],
    scopes: ['repo', 'read:org'],
    egressDomains: ['api.github.com'],
    readAction: 'issues.get',
    readDesc: 'Fetch a GitHub issue or PR',
    readInputProp: 'repo',
    writeAction: 'issues.createComment',
    writeDesc: 'Post a comment on a GitHub issue or PR',
    writeInputProp: 'body',
    triggerName: 'pull_request.opened',
    triggerType: 'webhook',
    verifyHeader: 'X-Hub-Signature-256',
  }),
  makeSimpleConnector({
    id: 'zendesk',
    name: 'Zendesk',
    category: 'support',
    description: 'Triage support tickets, inspect customer context, and update ticket statuses.',
    authTypes: ['oauth2', 'api_key'],
    scopes: ['read', 'write'],
    egressDomains: ['zendesk.com'],
    readAction: 'ticket.get',
    readDesc: 'Fetch a Zendesk ticket',
    readInputProp: 'ticket_id',
    writeAction: 'ticket.update',
    writeDesc: 'Update a Zendesk ticket',
    writeInputProp: 'ticket_id',
    triggerName: 'ticket.created',
    triggerType: 'webhook',
    verifyHeader: 'X-Zendesk-Webhook-Signature',
  }),
  makeSimpleConnector({
    id: 'salesforce',
    name: 'Salesforce',
    category: 'crm',
    description: 'SOQL queries, dynamic CRM schema discovery, and lead/opportunity updates.',
    authTypes: ['oauth2', 'jwt'],
    scopes: ['api', 'refresh_token'],
    egressDomains: ['login.salesforce.com'],
    readAction: 'soql.query',
    readDesc: 'Execute a SOQL query',
    readInputProp: 'query',
    writeAction: 'record.update',
    writeDesc: 'Update a Salesforce CRM record',
    writeInputProp: 'record_id',
    triggerName: 'record.changed',
    triggerType: 'polling',
  }),
  makeSimpleConnector({
    id: 'hubspot',
    name: 'HubSpot',
    category: 'crm',
    description: 'Manage contacts, deals, and engagement notes in HubSpot CRM.',
    authTypes: ['oauth2', 'api_key'],
    scopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write'],
    egressDomains: ['api.hubapi.com'],
    readAction: 'contacts.get',
    readDesc: 'Fetch a HubSpot contact',
    readInputProp: 'contact_id',
    writeAction: 'deals.update',
    writeDesc: 'Update a HubSpot deal stage',
    writeInputProp: 'deal_id',
    triggerName: 'contact.created',
    triggerType: 'webhook',
    verifyHeader: 'X-HubSpot-Signature-v3',
  }),
  makeSimpleConnector({
    id: 'notion',
    name: 'Notion',
    category: 'productivity',
    description: 'Query Notion databases, read pages, and append structured blocks.',
    authTypes: ['oauth2', 'api_key'],
    scopes: ['read_content', 'insert_content'],
    egressDomains: ['api.notion.com'],
    readAction: 'pages.get',
    readDesc: 'Retrieve a Notion page',
    readInputProp: 'page_id',
    writeAction: 'pages.create',
    writeDesc: 'Create a Notion page',
    writeInputProp: 'title',
    triggerName: 'page.updated',
    triggerType: 'polling',
  }),
  makeSimpleConnector({
    id: 'stripe',
    name: 'Stripe',
    category: 'payments',
    description: 'Inspect invoices, charges, and issue idempotent customer refunds via Stripe.',
    authTypes: ['api_key'],
    scopes: ['charges:read', 'refunds:write'],
    egressDomains: ['api.stripe.com'],
    readAction: 'invoices.retrieve',
    readDesc: 'Retrieve a Stripe invoice',
    readInputProp: 'invoice_id',
    writeAction: 'refunds.create',
    writeDesc: 'Issue a Stripe refund',
    writeInputProp: 'charge_id',
    triggerName: 'invoice.payment_failed',
    triggerType: 'webhook',
    verifyHeader: 'Stripe-Signature',
  }),
  makeSimpleConnector({
    id: 's3',
    name: 'AWS S3',
    category: 'storage',
    description: 'Read and upload scoped object artifacts in Amazon S3 via AWS SigV4.',
    authTypes: ['aws_sigv4'],
    scopes: ['s3:GetObject', 's3:PutObject'],
    egressDomains: ['s3.amazonaws.com'],
    readAction: 'object.get',
    readDesc: 'Get an object from S3',
    readInputProp: 'key',
    writeAction: 'object.put',
    writeDesc: 'Upload an object to S3',
    writeInputProp: 'key',
    triggerName: 'object.created',
    triggerType: 'webhook',
  }),
  makeSimpleConnector({
    id: 'teams',
    name: 'Microsoft Teams',
    category: 'communication',
    description: 'Send adaptive approval cards and read channel threads in Microsoft Teams.',
    authTypes: ['oauth2'],
    scopes: ['ChannelMessage.Read.All', 'ChannelMessage.Send'],
    egressDomains: ['graph.microsoft.com'],
    readAction: 'channel.listMessages',
    readDesc: 'List messages in a Teams channel',
    readInputProp: 'channel_id',
    writeAction: 'channel.sendMessage',
    writeDesc: 'Send an adaptive card message to Teams',
    writeInputProp: 'text',
    triggerName: 'message.created',
    triggerType: 'webhook',
  }),
  makeSimpleConnector({
    id: 'twilio',
    name: 'Twilio',
    category: 'communication',
    description: 'Send SMS notifications and verify phone interactions via Twilio.',
    authTypes: ['basic', 'api_key'],
    scopes: ['sms:send'],
    egressDomains: ['api.twilio.com'],
    readAction: 'messages.fetch',
    readDesc: 'Fetch SMS message status',
    readInputProp: 'message_sid',
    writeAction: 'messages.sendSms',
    writeDesc: 'Send an SMS message',
    writeInputProp: 'to',
    triggerName: 'sms.received',
    triggerType: 'webhook',
    verifyHeader: 'X-Twilio-Signature',
  }),
];

export function getConnectorManifest(connectorId: string): ConnectorManifest {
  const found = WAVE_1_CONNECTORS.find((c) => c.id === connectorId);
  if (!found) {
    throw new PlatformError('RES_NOT_FOUND', `Connector "${connectorId}" not found in Wave 1 catalog`);
  }
  return found;
}

/**
 * Verifies a connector manifest against all of its recorded test fixtures (PRD D.2).
 */
export function runConnectorContractTests(connectorId: string): ConnectorContractTestResult {
  const manifest = getConnectorManifest(connectorId);
  const details: Array<{
    fixtureName: string;
    action: string;
    passed: boolean;
    errors: string[];
  }> = [];

  for (const fixture of manifest.fixtures) {
    const errors: string[] = [];
    const actionSpec = manifest.actions.find((a) => a.name === fixture.action);
    if (!actionSpec) {
      errors.push(`Action "${fixture.action}" not declared in manifest`);
    } else {
      errors.push(...validateJsonSchema(actionSpec.inputSchema, fixture.input, '$.input'));
      errors.push(
        ...validateJsonSchema(actionSpec.outputSchema, fixture.expectedOutput, '$.output'),
      );
    }

    if (
      fixture.targetDomain &&
      manifest.egressDomains.length > 0 &&
      !manifest.egressDomains.includes(fixture.targetDomain)
    ) {
      errors.push(`Fixture domain "${fixture.targetDomain}" not in manifest egressDomains`);
    }

    details.push({
      fixtureName: fixture.name,
      action: fixture.action,
      passed: errors.length === 0,
      errors,
    });
  }

  const passedFixtures = details.filter((d) => d.passed).length;
  return {
    connectorId: manifest.id,
    passed: passedFixtures === details.length && details.length > 0,
    totalFixtures: details.length,
    passedFixtures,
    details,
  };
}

export type ConnectionSharingMode = 'personal' | 'shared';
export type ConnectionHealthStatus = 'healthy' | 'expiring' | 'failed' | 'pending_approval';

export interface ConnectionRecord {
  readonly id: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly connectorId: string;
  readonly name: string;
  readonly authType: ConnectorAuthType;
  readonly sharingMode: ConnectionSharingMode;
  readonly ownerId: string;
  readonly environmentMapping: Partial<Record<EnvironmentKind, string>>;
  readonly secretVersion: number;
  readonly secretMasked: string;
  readonly scopes: readonly string[];
  readonly allowedAgents: readonly string[];
  readonly egressDomains: readonly string[];
  readonly status: ConnectionHealthStatus;
  readonly lastTestedAt: string | null;
  readonly lastError: string | null;
  readonly expiresAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ConnectionActionExecutionResult {
  readonly connectionId: string;
  readonly connectorId: string;
  readonly action: string;
  readonly environment: EnvironmentKind;
  readonly latencyMs: number;
  readonly rawResult: unknown;
  readonly sanitized: SanitizedToolOutput;
}

/**
 * Manages write-only connections, environment mapping, health tests, and egress-checked action calls (FR-INT-2..5).
 */
export class ConnectionManager {
  private readonly connections = new Map<string, ConnectionRecord>();
  private readonly secretsVault = new Map<string, string>();
  private seq = 0;

  private nextId(): string {
    this.seq += 1;
    return `conn_${this.seq}_${Date.now()}`;
  }

  createConnection(
    ctx: Pick<TenantContext, 'orgId' | 'workspaceId' | 'principal'>,
    input: {
      connectorId: string;
      name: string;
      authType: ConnectorAuthType;
      secretValue: string;
      sharingMode?: ConnectionSharingMode;
      environmentMapping?: Partial<Record<EnvironmentKind, string>>;
      scopes?: readonly string[];
      allowedAgents?: readonly string[];
      egressDomains?: readonly string[];
      expiresAt?: string | null;
    },
  ): ConnectionRecord {
    const manifest = getConnectorManifest(input.connectorId);
    if (!manifest.authTypes.includes(input.authType)) {
      throw new PlatformError(
        'VAL_SCHEMA_MISMATCH',
        `Auth type "${input.authType}" not supported by connector "${manifest.id}"`,
      );
    }
    if (!input.secretValue || input.secretValue.trim().length === 0) {
      throw new PlatformError('VAL_SCHEMA_MISMATCH', 'Secret value is required');
    }

    const id = this.nextId();
    const now = new Date().toISOString();
    this.secretsVault.set(id, input.secretValue);

    const record: ConnectionRecord = {
      id,
      orgId: ctx.orgId,
      workspaceId: ctx.workspaceId ?? 'ws_default',
      connectorId: manifest.id,
      name: input.name,
      authType: input.authType,
      sharingMode: input.sharingMode ?? 'shared',
      ownerId: ctx.principal.id,
      environmentMapping: input.environmentMapping ?? { dev: id, staging: id, prod: id },
      secretVersion: 1,
      secretMasked: `Stored (v1, updated by ${ctx.principal.id} on ${now.slice(0, 10)})`,
      scopes: input.scopes ?? manifest.scopes,
      allowedAgents: input.allowedAgents ?? ['*'],
      egressDomains:
        input.egressDomains && input.egressDomains.length > 0
          ? input.egressDomains
          : manifest.egressDomains,
      status: 'healthy',
      lastTestedAt: null,
      lastError: null,
      expiresAt: input.expiresAt ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.connections.set(id, record);
    return record;
  }

  listConnections(ctx: Pick<TenantContext, 'orgId' | 'workspaceId'>): ConnectionRecord[] {
    return Array.from(this.connections.values()).filter(
      (c) => c.orgId === ctx.orgId && (!ctx.workspaceId || c.workspaceId === ctx.workspaceId),
    );
  }

  getConnection(ctx: Pick<TenantContext, 'orgId'>, connectionId: string): ConnectionRecord {
    const conn = this.connections.get(connectionId);
    if (!conn || conn.orgId !== ctx.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Connection not found: ${connectionId}`);
    }
    return conn;
  }

  rotateSecret(
    ctx: Pick<TenantContext, 'orgId' | 'principal'>,
    connectionId: string,
    newSecretValue: string,
  ): ConnectionRecord {
    const existing = this.getConnection(ctx, connectionId);
    if (!newSecretValue || newSecretValue.trim().length === 0) {
      throw new PlatformError('VAL_SCHEMA_MISMATCH', 'New secret value cannot be empty');
    }
    const now = new Date().toISOString();
    const nextVersion = existing.secretVersion + 1;
    this.secretsVault.set(connectionId, newSecretValue);

    const updated: ConnectionRecord = {
      ...existing,
      secretVersion: nextVersion,
      secretMasked: `Stored (v${nextVersion}, updated by ${ctx.principal.id} on ${now.slice(0, 10)})`,
      status: 'healthy',
      updatedAt: now,
    };
    this.connections.set(connectionId, updated);
    return updated;
  }

  testConnection(
    ctx: Pick<TenantContext, 'orgId'>,
    connectionId: string,
  ): {
    connection: ConnectionRecord;
    healthy: boolean;
    scopesGranted: readonly string[];
    latencyMs: number;
  } {
    const existing = this.getConnection(ctx, connectionId);
    const hasSecret = this.secretsVault.has(connectionId);
    const now = new Date().toISOString();
    const updated: ConnectionRecord = {
      ...existing,
      status: hasSecret ? 'healthy' : 'failed',
      lastTestedAt: now,
      lastError: hasSecret ? null : 'Missing secret in vault',
      updatedAt: now,
    };
    this.connections.set(connectionId, updated);
    return {
      connection: updated,
      healthy: hasSecret,
      scopesGranted: updated.scopes,
      latencyMs: 18,
    };
  }

  executeAction(
    ctx: Pick<TenantContext, 'orgId' | 'workspaceId'>,
    input: {
      connectionId: string;
      action: string;
      args: Record<string, unknown>;
      environment?: EnvironmentKind;
      agentId?: string;
      targetDomain?: string;
    },
  ): ConnectionActionExecutionResult {
    const conn = this.getConnection(ctx, input.connectionId);
    const manifest = getConnectorManifest(conn.connectorId);

    // Check agent allowlist (FR-INT-4)
    if (
      input.agentId &&
      !conn.allowedAgents.includes('*') &&
      !conn.allowedAgents.includes(input.agentId)
    ) {
      throw new PlatformError(
        'AUTH_FORBIDDEN',
        `Agent "${input.agentId}" is not authorized to use connection "${conn.name}"`,
      );
    }

    // Check egress allowlist (FR-INT-5)
    if (
      input.targetDomain &&
      conn.egressDomains.length > 0 &&
      !conn.egressDomains.includes('*') &&
      !conn.egressDomains.includes(input.targetDomain)
    ) {
      throw new PlatformError(
        'TOOL_SSRF_BLOCKED',
        `Outbound domain "${input.targetDomain}" blocked by egress allowlist for connector "${conn.connectorId}"`,
      );
    }

    const actionSpec = manifest.actions.find((a) => a.name === input.action);
    if (!actionSpec) {
      throw new PlatformError(
        'RES_NOT_FOUND',
        `Action "${input.action}" not found on connector "${manifest.id}"`,
      );
    }

    const errors = validateJsonSchema(actionSpec.inputSchema, input.args);
    if (errors.length > 0) {
      throw new PlatformError(
        'VAL_SCHEMA_MISMATCH',
        `Invalid arguments for "${input.action}": ${errors.join('; ')}`,
      );
    }

    // Inject credential at gateway call time only (never returned in result)
    const _secret = this.secretsVault.get(conn.id);
    if (!_secret) {
      throw new PlatformError('SYS_INTERNAL', 'Connection secret unavailable in vault');
    }

    const fixture = manifest.fixtures.find((f) => f.action === input.action);
    const rawResult = fixture
      ? { ...fixture.expectedOutput, argsEcho: input.args }
      : { ok: true, connector: manifest.id, action: input.action };

    const sanitized = sanitizeAndWrapToolResult(
      `conn_call_${Date.now()}`,
      `${manifest.id}.${input.action}`,
      rawResult,
      'untrusted_external',
    );

    return {
      connectionId: conn.id,
      connectorId: manifest.id,
      action: input.action,
      environment: input.environment ?? 'dev',
      latencyMs: 24,
      rawResult,
      sanitized,
    };
  }
}
