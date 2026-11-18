import { describe, expect, it } from 'vitest';
import { PlatformClient } from '@elshad/sdk-ts';
import { runAgentCtl } from './index.js';

describe('@elshad/cli agentctl [E1.7, B.7]', () => {
  function createCliTestSetup() {
    const out: string[] = [];
    const err: string[] = [];
    const io = {
      stdout: (l: string) => out.push(l),
      stderr: (l: string) => err.push(l),
    };
    const client = new PlatformClient({ baseUrl: 'http://localhost:8080' });

    client.auth.login = async (email) =>
      ({
        csrfToken: 'csrf_1',
        me: {
          principal: { id: 'prn_1', email, displayName: 'CLI User', type: 'user' },
          orgId: 'org_1',
          orgName: 'Default Org',
          workspaces: [],
          bindings: [],
        },
      }) as unknown as Awaited<ReturnType<typeof client.auth.login>>;

    client.evaluations.experiments.run = async (id) =>
      ({
        id,
        status: 'completed',
        gateVerdict: 'passed',
      }) as Awaited<ReturnType<typeof client.evaluations.experiments.run>>;

    client.promotions.create = async (input) =>
      ({
        promotion: {
          id: 'prm_cli_1',
          status: input.toEnv === 'prod' ? 'pending_approval' : 'deployed',
          toEnv: input.toEnv,
        },
        deployment:
          input.toEnv === 'prod'
            ? null
            : { id: 'dep_cli_1', trafficPct: input.canaryPct ?? 100, versionId: input.versionId },
      }) as Awaited<ReturnType<typeof client.promotions.create>>;

    client.deployments.rollback = async (id) =>
      ({
        id,
        environment: 'prod',
        versionId: 'agv_1',
        status: 'rolled_back',
      }) as Awaited<ReturnType<typeof client.deployments.rollback>>;

    client.tools.test = async (name, input) =>
      ({
        toolName: name,
        dryRun: Boolean(input.dryRun),
        validArgs: true,
        rawResult: {},
        sanitizedText: '',
        wrappedObservation: '',
        untrustedSource: false,
        injectionSuspected: false,
      }) as Awaited<ReturnType<typeof client.tools.test>>;

    return { out, err, io, client };
  }

  it('executes login, init, eval run --gate, deploy, rollback, and tool test commands', async () => {
    const { out, io, client } = createCliTestSetup();

    expect(await runAgentCtl(['login', '--email', 'dev@elshad.local'], client, io)).toBe(0);
    expect(out.at(-1)).toContain('Authenticated as dev@elshad.local');

    expect(await runAgentCtl(['init', '--name', 'triage-bot'], client, io)).toBe(0);
    expect(out.at(-1)).toContain('"name": "triage-bot"');

    expect(await runAgentCtl(['eval', 'run', 'exp_1', '--gate'], client, io)).toBe(0);
    expect(out.at(-1)).toContain('gateVerdict=passed');

    expect(
      await runAgentCtl(
        ['deploy', '--env', 'staging', '--subject', 'agt_1', '--version', 'agv_2', '--canary', '25'],
        client,
        io,
      ),
    ).toBe(0);
    expect(out.at(-1)).toContain('status=deployed deployment=dep_cli_1 traffic=25%');

    expect(await runAgentCtl(['rollback', 'dep_cli_1'], client, io)).toBe(0);
    expect(out.at(-1)).toContain('restored version=agv_1 status=rolled_back');

    expect(await runAgentCtl(['tool', 'test', 'current_time', '--dry-run'], client, io)).toBe(0);
    expect(out.at(-1)).toContain('Tool current_time dryRun=true');
  });
});
