import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const ErrorEnvelopeSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.record(z.string(), z.unknown()),
      request_id: z.string(),
      trace_id: z.string(),
      doc_url: z.string(),
    }),
  })
  .openapi('ErrorEnvelope');

export const HealthResponseSchema = z
  .object({
    status: z.literal('ok'),
    service: z.string(),
  })
  .openapi('HealthResponse');

export const ReadyResponseSchema = z
  .object({
    status: z.enum(['ready', 'degraded']),
    checks: z.record(z.string(), z.enum(['ok', 'error'])),
  })
  .openapi('ReadyResponse');

export const VersionResponseSchema = z
  .object({
    version: z.string(),
    edition: z.enum(['community', 'enterprise']),
  })
  .openapi('VersionResponse');

export const CapabilitiesResponseSchema = z
  .object({
    edition: z.enum(['community', 'enterprise']),
    feature_flags: z.array(z.string()),
    modules: z.array(z.string()),
  })
  .openapi('CapabilitiesResponse');

export const LoginRequestSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(1),
  })
  .openapi('LoginRequest');

export const PrincipalSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    type: z.enum(['user', 'group', 'service_account', 'agent']),
    email: z.string().nullable(),
    display_name: z.string(),
  })
  .openapi('Principal');

export const WorkspaceSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    slug: z.string(),
    name: z.string(),
    created_at: z.string(),
  })
  .openapi('Workspace');

export const CreateWorkspaceSchema = z
  .object({
    slug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, 'Slug must be kebab-case 3-64 chars'),
    name: z.string().min(1).max(120),
  })
  .openapi('CreateWorkspaceRequest');

export const UpdateWorkspaceSchema = z
  .object({
    name: z.string().min(1).max(120),
  })
  .openapi('UpdateWorkspaceRequest');

export const ProjectSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    workspace_id: z.string(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    max_autonomy_level: z.enum(['L0', 'L1', 'L2', 'L3', 'L4']),
    created_at: z.string(),
  })
  .openapi('Project');

export const CreateProjectSchema = z
  .object({
    slug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, 'Slug must be kebab-case 3-64 chars'),
    name: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
  })
  .openapi('CreateProjectRequest');

export const EnvironmentSchema = z
  .object({
    id: z.string(),
    workspace_id: z.string(),
    kind: z.enum(['dev', 'staging', 'prod']),
    name: z.string(),
  })
  .openapi('Environment');

export const RoleSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    is_system: z.boolean(),
  })
  .openapi('Role');

export const RoleBindingSchema = z
  .object({
    id: z.string(),
    principal_id: z.string(),
    role_id: z.string(),
    role_name: z.string(),
    scope_type: z.enum(['org', 'workspace', 'project', 'resource']),
    scope_id: z.string(),
    created_at: z.string(),
  })
  .openapi('RoleBinding');

export const CreateRoleBindingSchema = z
  .object({
    principal_id: z.string().min(1),
    role_name: z.string().min(1),
    scope_type: z.enum(['org', 'workspace', 'project', 'resource']),
    scope_id: z.string().min(1),
  })
  .openapi('CreateRoleBindingRequest');

export const MeResponseSchema = z
  .object({
    principal: PrincipalSchema,
    org_id: z.string(),
    org_slug: z.string(),
    org_name: z.string(),
    bindings: z.array(RoleBindingSchema),
    workspaces: z.array(WorkspaceSchema),
  })
  .openapi('MeResponse');

export const LoginResponseSchema = z
  .object({
    csrf_token: z.string(),
    me: MeResponseSchema,
  })
  .openapi('LoginResponse');

export const ApiKeySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    key_prefix: z.string(),
    scopes: z.array(z.string()),
    workspace_id: z.string().nullable(),
    expires_at: z.string().nullable(),
    last_used_at: z.string().nullable(),
    revoked_at: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi('ApiKey');

export const CreateApiKeySchema = z
  .object({
    name: z.string().min(1).max(120),
    scopes: z.array(z.string()).default([]),
    workspace_id: z.string().optional(),
  })
  .openapi('CreateApiKeyRequest');

export const CreatedApiKeySchema = ApiKeySchema.extend({
  secret: z.string(),
}).openapi('CreatedApiKey');

export const AuditEventSchema = z
  .object({
    id: z.string(),
    seq: z.number().int(),
    ts: z.string(),
    actor: z.record(z.string(), z.unknown()),
    action: z.string(),
    resource: z.record(z.string(), z.unknown()),
    decision: z.string().nullable(),
    hash: z.string(),
    prev_hash: z.string(),
  })
  .openapi('AuditEvent');

export const AuditEventPageSchema = z
  .object({
    data: z.array(AuditEventSchema),
    next_cursor: z.string().nullable(),
  })
  .openapi('AuditEventPage');

export const IdParamSchema = z.object({ id: z.string().min(1) });
export const EmptyOkSchema = z.object({ ok: z.literal(true) }).openapi('EmptyOk');
