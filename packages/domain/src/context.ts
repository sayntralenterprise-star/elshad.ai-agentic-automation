import type {
  EnvironmentId,
  OrgId,
  PrincipalId,
  ProjectId,
  WorkspaceId,
} from './ids.js';

export type PrincipalType = 'user' | 'group' | 'service_account' | 'agent';
export type EnvironmentKind = 'dev' | 'staging' | 'prod';
export type Edition = 'community' | 'enterprise';

export interface PrincipalRef {
  id: PrincipalId;
  type: PrincipalType;
  displayName?: string;
  email?: string;
}

export interface TenantContext {
  orgId: OrgId;
  workspaceId?: WorkspaceId;
  projectId?: ProjectId;
  environmentId?: EnvironmentId;
  environmentKind?: EnvironmentKind;
  principal: PrincipalRef;
  onBehalfOf?: PrincipalRef;
  requestId: string;
  traceId: string;
}

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
