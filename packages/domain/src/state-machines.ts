import { PlatformError } from './errors.js';

export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'waiting_input'
  | 'waiting_timer'
  | 'waiting_child'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'budget_exceeded'
  | 'policy_blocked'
  | 'cancelled';

export const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  'succeeded',
  'failed',
  'timed_out',
  'budget_exceeded',
  'policy_blocked',
  'cancelled',
]);

export const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  queued: ['running', 'cancelled'],
  running: [
    'waiting_approval',
    'waiting_input',
    'waiting_timer',
    'waiting_child',
    'succeeded',
    'failed',
    'timed_out',
    'budget_exceeded',
    'policy_blocked',
    'cancelled',
  ],
  waiting_approval: ['queued', 'cancelled'],
  waiting_input: ['queued', 'cancelled'],
  waiting_timer: ['queued', 'cancelled'],
  waiting_child: ['queued', 'cancelled'],
  succeeded: [],
  failed: ['queued'], // DLQ re-drive
  timed_out: ['queued'], // DLQ re-drive
  budget_exceeded: [],
  policy_blocked: [],
  cancelled: [],
};

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'info_requested';

export const APPROVAL_TRANSITIONS: Record<ApprovalStatus, readonly ApprovalStatus[]> = {
  pending: ['approved', 'rejected', 'expired', 'cancelled', 'info_requested'],
  info_requested: ['pending', 'approved', 'rejected', 'expired', 'cancelled'],
  approved: [],
  rejected: [],
  expired: [],
  cancelled: [],
};

export type AgentVersionState = 'draft' | 'published' | 'retired';

export const AGENT_VERSION_TRANSITIONS: Record<AgentVersionState, readonly AgentVersionState[]> = {
  draft: ['published'],
  published: ['retired'],
  retired: [],
};

export type DeploymentStatus = 'pending' | 'active' | 'superseded' | 'rolled_back';

export const DEPLOYMENT_TRANSITIONS: Record<DeploymentStatus, readonly DeploymentStatus[]> = {
  pending: ['active', 'rolled_back'],
  active: ['superseded', 'rolled_back'],
  superseded: [],
  rolled_back: [],
};

export type WorkItemStatus = 'ready' | 'leased' | 'done' | 'dead';

export const WORK_ITEM_TRANSITIONS: Record<WorkItemStatus, readonly WorkItemStatus[]> = {
  ready: ['leased', 'dead'],
  leased: ['done', 'ready', 'dead'],
  done: [],
  dead: ['ready'],
};

function checkTransition<S extends string>(
  entity: string,
  table: Record<S, readonly S[]>,
  from: S,
  to: S,
): void {
  const allowed = table[from];
  if (!allowed || !allowed.includes(to)) {
    throw new PlatformError('RES_CONFLICT', `Illegal ${entity} transition from '${from}' to '${to}'`, {
      entity,
      from,
      to,
    });
  }
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  checkTransition('run', RUN_TRANSITIONS, from, to);
}

export function assertApprovalTransition(from: ApprovalStatus, to: ApprovalStatus): void {
  checkTransition('approval', APPROVAL_TRANSITIONS, from, to);
}

export function assertAgentVersionTransition(
  from: AgentVersionState,
  to: AgentVersionState,
): void {
  checkTransition('agent_version', AGENT_VERSION_TRANSITIONS, from, to);
}

export function assertDeploymentTransition(from: DeploymentStatus, to: DeploymentStatus): void {
  checkTransition('deployment', DEPLOYMENT_TRANSITIONS, from, to);
}

export function assertWorkItemTransition(from: WorkItemStatus, to: WorkItemStatus): void {
  checkTransition('work_item', WORK_ITEM_TRANSITIONS, from, to);
}
