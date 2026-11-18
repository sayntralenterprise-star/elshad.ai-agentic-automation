import type { EnvironmentKind } from '@elshad/domain';
import { PlatformClient } from '@elshad/sdk-ts';

export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseCliArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx >= 0) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function getFlagString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const val = flags[key];
  return typeof val === 'string' ? val : undefined;
}

/**
 * Main `agentctl` CLI dispatcher (PRD B.7).
 */
export async function runAgentCtl(
  argv: readonly string[],
  client: PlatformClient,
  io: CliIo = {
    stdout: (l) => console.log(l),
    stderr: (l) => console.error(l),
  },
): Promise<number> {
  const { positional, flags } = parseCliArgs(argv);
  const cmd = positional[0];
  const sub = positional[1];

  if (!cmd || cmd === 'help' || flags['help']) {
    io.stdout(
      [
        'agentctl - Elshad Agentic Automation CLI (v0.1.0)',
        '',
        'Commands:',
        '  login --email <email> --password <password>     Authenticate against control plane',
        '  init [--name <project>]                         Initialize local agent.yaml scaffold',
        '  run --agent <agent_version_id> [--prompt <txt>] Start an agent run',
        '  trace <run_id>                                  Inspect run status, steps & cost',
        '  eval run <experiment_id> [--gate]               Run evaluation experiment & check release gate',
        '  deploy --env <dev|staging|prod> --subject <id> --version <ver_id> [--from <env>] [--canary <pct>]',
        '  rollback <deployment_id>                        Roll back deployment to previous version',
        '  diff --agent <agent_id> --from <v1> --to <v2>   Compare two agent versions',
        '  tool test <tool_name> [--args <json>] [--dry-run]',
      ].join('\n'),
    );
    return 0;
  }

  try {
    if (cmd === 'login') {
      const email = getFlagString(flags, 'email') ?? 'admin@elshad.local';
      const password = getFlagString(flags, 'password') ?? 'ChangeMe123!';
      const res = await client.auth.login(email, password);
      io.stdout(`Authenticated as ${res.me.principal.email} (org=${res.me.orgName})`);
      return 0;
    }

    if (cmd === 'init') {
      const name = getFlagString(flags, 'name') ?? 'my-elshad-agent';
      io.stdout(
        JSON.stringify(
          {
            schema_version: 1,
            name,
            version: '1.0.0',
            model: { tier: 'standard' },
            limits: { max_steps: 25, max_cost_micro_usd: 2_000_000 },
          },
          null,
          2,
        ),
      );
      return 0;
    }

    if (cmd === 'run') {
      const versionId = getFlagString(flags, 'agent') ?? 'agv_1';
      const prompt = getFlagString(flags, 'prompt') ?? 'Hello from agentctl';
      const run = await client.runs.create(
        {
          subjectType: 'agent_version',
          subjectVersionId: versionId,
          input: { prompt },
          executeInline: true,
        },
        `cli-run-${Date.now()}`,
      );
      io.stdout(`Run ${run.id} status=${run.status} cost=${run.costMicroUsd} micro-USD`);
      return 0;
    }

    if (cmd === 'trace' && sub) {
      const run = await client.runs.get(sub);
      const steps = await client.runs.listSteps(sub);
      io.stdout(
        `Trace ${run.id} | status=${run.status} | steps=${steps.length} | cost=${run.costMicroUsd} micro-USD`,
      );
      for (const s of steps) {
        io.stdout(`  #${s.seq} ${s.type} [${s.status}] ${s.latencyMs}ms`);
      }
      return 0;
    }

    if (cmd === 'eval' && sub === 'run') {
      const expId = positional[2];
      if (!expId) {
        io.stderr('Usage: agentctl eval run <experiment_id> [--gate]');
        return 1;
      }
      const exp = await client.evaluations.experiments.run(expId);
      io.stdout(`Experiment ${exp.id} status=${exp.status} gateVerdict=${exp.gateVerdict ?? 'none'}`);
      if (flags['gate'] && exp.gateVerdict === 'failed') {
        io.stderr('Release gate failed!');
        return 2;
      }
      return 0;
    }

    if (cmd === 'deploy') {
      const toEnv = (getFlagString(flags, 'env') ?? 'staging') as EnvironmentKind;
      const fromEnv = (getFlagString(flags, 'from') ?? 'dev') as EnvironmentKind;
      const subjectId = getFlagString(flags, 'subject');
      const versionId = getFlagString(flags, 'version');
      const subjectType = (getFlagString(flags, 'type') ?? 'agent') as 'agent' | 'workflow';
      const canaryPct = Number(getFlagString(flags, 'canary') ?? '100');
      const evalGatePassed = flags['eval-passed'] !== 'false';

      if (!subjectId || !versionId) {
        io.stderr('Usage: agentctl deploy --env <env> --subject <id> --version <version_id>');
        return 1;
      }

      const res = await client.promotions.create({
        subjectType,
        subjectId,
        versionId,
        fromEnv,
        toEnv,
        evalGatePassed,
        canaryPct,
      });
      io.stdout(
        `Promotion ${res.promotion.id} -> ${toEnv} status=${res.promotion.status}${res.deployment ? ` deployment=${res.deployment.id} traffic=${res.deployment.trafficPct}%` : ''}`,
      );
      return 0;
    }

    if (cmd === 'rollback' && sub) {
      const dep = await client.deployments.rollback(sub);
      io.stdout(
        `Rolled back deployment ${dep.id} in ${dep.environment} -> restored version=${dep.versionId} status=${dep.status}`,
      );
      return 0;
    }

    if (cmd === 'diff') {
      const agentId = getFlagString(flags, 'agent');
      const fromV = getFlagString(flags, 'from');
      const toV = getFlagString(flags, 'to');
      if (!agentId || !fromV || !toV) {
        io.stderr('Usage: agentctl diff --agent <id> --from <v1> --to <v2>');
        return 1;
      }
      const d = await client.agents.diff(agentId, fromV, toV);
      io.stdout(JSON.stringify(d, null, 2));
      return 0;
    }

    if (cmd === 'tool' && sub === 'test') {
      const toolName = positional[2];
      if (!toolName) {
        io.stderr('Usage: agentctl tool test <tool_name> [--args <json>] [--dry-run]');
        return 1;
      }
      const argsRaw = getFlagString(flags, 'args') ?? '{}';
      const args = JSON.parse(argsRaw) as Record<string, unknown>;
      const dryRun = flags['dry-run'] !== false;
      const res = await client.tools.test(toolName, { args, dryRun });
      io.stdout(
        `Tool ${res.toolName} dryRun=${res.dryRun} untrusted=${res.untrustedSource} injection=${res.injectionSuspected}`,
      );
      return 0;
    }

    io.stderr(`Unknown command: ${argv.join(' ')}`);
    return 1;
  } catch (err) {
    io.stderr(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

export function createCliClient(baseUrl: string, token?: string): PlatformClient {
  return new PlatformClient({ baseUrl, token });
}
