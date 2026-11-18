import { describe, expect, it } from 'vitest';
import { PlatformError } from '@elshad/domain';
import { PlatformClient } from './index.js';

describe('@elshad/sdk-ts [E0.1-6, L.4]', () => {
  it('maps snake_case API payloads to camelCase TypeScript DTOs and sends headers', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const mockFetch: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return new Response(
        JSON.stringify({
          data: [
            {
              id: 'ws_1',
              org_id: 'org_1',
              slug: 'default',
              name: 'Default Workspace',
              created_at: '2026-11-18T10:00:00.000Z',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const client = new PlatformClient({
      baseUrl: 'http://localhost:8080',
      token: 'key_abc',
      workspaceId: 'ws_1',
      environment: 'staging',
      fetchImpl: mockFetch,
    });

    const list = await client.workspaces.list();
    expect(list).toEqual([
      {
        id: 'ws_1',
        orgId: 'org_1',
        slug: 'default',
        name: 'Default Workspace',
        createdAt: '2026-11-18T10:00:00.000Z',
      },
    ]);
    expect(calls[0]!.headers['Authorization']).toBe('Bearer key_abc');
    expect(calls[0]!.headers['X-Workspace-Id']).toBe('ws_1');
    expect(calls[0]!.headers['X-Environment']).toBe('staging');
  });

  it('throws PlatformError parsed from standard error envelope', async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'AUTH_FORBIDDEN',
            message: 'Denied',
            details: { permission: 'org:manage' },
          },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );

    const client = new PlatformClient({
      baseUrl: 'http://localhost:8080',
      fetchImpl: mockFetch,
    });

    await expect(client.capabilities()).rejects.toThrowError(PlatformError);
  });

  it('maps runs, steps, and DLQ responses cleanly [E0.2-4]', async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/runs')) {
        return new Response(
          JSON.stringify({
            id: 'run_1',
            org_id: 'org_1',
            workspace_id: 'ws_1',
            environment_id: 'env_1',
            root_run_id: 'run_1',
            parent_run_id: null,
            subject_type: 'agent_version',
            subject_version_id: 'agv_1',
            status: 'queued',
            failure_class: null,
            termination_reason: null,
            initiator_id: 'prn_1',
            input: {},
            output: null,
            usage: { steps: 1, tokens_in: 10, tokens_out: 5, tool_calls: 0 },
            cost_micro_usd: 100,
            labels: {},
            last_event_seq: 1,
            created_at: '2026-11-18T12:00:00.000Z',
            started_at: null,
            ended_at: null,
          }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };

    const client = new PlatformClient({
      baseUrl: 'http://localhost:8080',
      fetchImpl: mockFetch,
    });
    const run = await client.runs.create({ subjectVersionId: 'agv_1' }, 'idem-1');
    expect(run.status).toBe('queued');
    expect(run.usage.tokensIn).toBe(10);
    expect(run.costMicroUsd).toBe(100);
  });
});
