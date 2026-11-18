import { PlatformError, type EnvironmentKind, type TenantContext } from '@elshad/domain';

export type PromotionStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'deployed'
  | 'rolled_back'
  | 'failed';

export type DeploymentStatus = 'active' | 'canary' | 'rolled_back';

export interface DeploymentRecord {
  readonly id: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly environment: EnvironmentKind;
  readonly subjectType: 'agent' | 'workflow';
  readonly subjectId: string;
  readonly versionId: string;
  readonly previousVersionId: string | null;
  readonly channel: string;
  readonly trafficPct: number;
  readonly status: DeploymentStatus;
  readonly deployedBy: string;
  readonly deployedAt: string;
}

export interface PromotionRecord {
  readonly id: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly subjectType: 'agent' | 'workflow';
  readonly subjectId: string;
  readonly versionId: string;
  readonly fromEnv: EnvironmentKind;
  readonly toEnv: EnvironmentKind;
  readonly status: PromotionStatus;
  readonly evalGatePassed: boolean;
  readonly evalScore: number | null;
  readonly diffSummary: Record<string, unknown>;
  readonly credentialMapping: Record<string, string>;
  readonly canaryPct: number;
  readonly initiatedBy: string;
  readonly approvedBy: string | null;
  readonly deploymentId: string | null;
  readonly deployedAt: string | null;
  readonly rolledBackAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Environment Promotion & Rollback Engine (PRD N.2.13, FR-WF-8, FR-WF-11, FR-EV-4).
 */
export class PromotionEngine {
  private readonly promotions = new Map<string, PromotionRecord>();
  private readonly deployments = new Map<string, DeploymentRecord>();
  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}${this.seq}_${Date.now()}`;
  }

  private findLiveDeployment(
    orgId: string,
    workspaceId: string,
    environment: EnvironmentKind,
    subjectType: 'agent' | 'workflow',
    subjectId: string,
  ): DeploymentRecord | undefined {
    return Array.from(this.deployments.values()).find(
      (d) =>
        d.orgId === orgId &&
        d.workspaceId === workspaceId &&
        d.environment === environment &&
        d.subjectType === subjectType &&
        d.subjectId === subjectId,
    );
  }

  promote(
    ctx: Pick<TenantContext, 'orgId' | 'workspaceId' | 'principal'>,
    input: {
      subjectType: 'agent' | 'workflow';
      subjectId: string;
      versionId: string;
      versionPublished?: boolean;
      fromEnv: EnvironmentKind;
      toEnv: EnvironmentKind;
      requiredCredentials?: readonly string[];
      credentialMapping?: Record<string, string>;
      evalGatePassed?: boolean;
      evalScore?: number | null;
      canaryPct?: number;
      diffFields?: readonly string[];
    },
  ): { promotion: PromotionRecord; deployment: DeploymentRecord | null } {
    const wsId = ctx.workspaceId ?? 'ws_default';

    // 1. Verify version is published
    if (input.versionPublished === false) {
      throw new PlatformError(
        'VAL_SCHEMA_MISMATCH',
        `Version "${input.versionId}" must be published before promotion to ${input.toEnv}`,
      );
    }

    // 2. Credential / connection mapping resolution (fail fast if any unmapped reference)
    const mapping = input.credentialMapping ?? {};
    const requiredCreds = input.requiredCredentials ?? [];
    const unmapped = requiredCreds.filter(
      (key) => !mapping[key] || String(mapping[key]).trim().length === 0,
    );
    if (unmapped.length > 0) {
      throw new PlatformError(
        'VAL_SCHEMA_MISMATCH',
        `Unmapped credential(s) in target environment "${input.toEnv}": ${unmapped.join(', ')}. Map all required connections before promoting.`,
      );
    }

    // 3. Eval gate check for staging and prod
    const evalPassed = input.evalGatePassed ?? (input.toEnv === 'dev');
    if ((input.toEnv === 'staging' || input.toEnv === 'prod') && !evalPassed) {
      throw new PlatformError(
        'VAL_SCHEMA_MISMATCH',
        `Evaluation release gate must pass before promoting to "${input.toEnv}"`,
      );
    }

    // 4. Compute diff versus live deployment in target environment
    const live = this.findLiveDeployment(
      ctx.orgId,
      wsId,
      input.toEnv,
      input.subjectType,
      input.subjectId,
    );
    const diffSummary: Record<string, unknown> = {
      previous_version_id: live?.versionId ?? null,
      new_version_id: input.versionId,
      from_env: input.fromEnv,
      to_env: input.toEnv,
      changed_fields: input.diffFields ?? ['version', 'prompt', 'tools'],
    };

    const now = new Date().toISOString();
    const promoId = this.nextId('prm_');
    const canaryPct = input.canaryPct ?? 100;

    // 5. Production promotions require Separation-of-Duties approval
    if (input.toEnv === 'prod') {
      const promo: PromotionRecord = {
        id: promoId,
        orgId: ctx.orgId,
        workspaceId: wsId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        versionId: input.versionId,
        fromEnv: input.fromEnv,
        toEnv: input.toEnv,
        status: 'pending_approval',
        evalGatePassed: evalPassed,
        evalScore: input.evalScore ?? null,
        diffSummary,
        credentialMapping: mapping,
        canaryPct,
        initiatedBy: ctx.principal.id,
        approvedBy: null,
        deploymentId: null,
        deployedAt: null,
        rolledBackAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.promotions.set(promoId, promo);
      return { promotion: promo, deployment: null };
    }

    // 6. Auto-deploy for dev & staging
    const deployment = this.upsertDeployment(ctx, {
      workspaceId: wsId,
      environment: input.toEnv,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      versionId: input.versionId,
      trafficPct: canaryPct,
    });

    const promo: PromotionRecord = {
      id: promoId,
      orgId: ctx.orgId,
      workspaceId: wsId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      versionId: input.versionId,
      fromEnv: input.fromEnv,
      toEnv: input.toEnv,
      status: 'deployed',
      evalGatePassed: evalPassed,
      evalScore: input.evalScore ?? null,
      diffSummary,
      credentialMapping: mapping,
      canaryPct,
      initiatedBy: ctx.principal.id,
      approvedBy: ctx.principal.id,
      deploymentId: deployment.id,
      deployedAt: now,
      rolledBackAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.promotions.set(promoId, promo);
    return { promotion: promo, deployment };
  }

  private upsertDeployment(
    ctx: Pick<TenantContext, 'orgId' | 'principal'>,
    input: {
      workspaceId: string;
      environment: EnvironmentKind;
      subjectType: 'agent' | 'workflow';
      subjectId: string;
      versionId: string;
      trafficPct: number;
    },
  ): DeploymentRecord {
    const existing = this.findLiveDeployment(
      ctx.orgId,
      input.workspaceId,
      input.environment,
      input.subjectType,
      input.subjectId,
    );
    const id = existing?.id ?? this.nextId('dep_');
    const now = new Date().toISOString();
    const record: DeploymentRecord = {
      id,
      orgId: ctx.orgId,
      workspaceId: input.workspaceId,
      environment: input.environment,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      versionId: input.versionId,
      previousVersionId: existing ? existing.versionId : null,
      channel: input.trafficPct < 100 ? 'canary' : 'stable',
      trafficPct: input.trafficPct,
      status: input.trafficPct < 100 ? 'canary' : 'active',
      deployedBy: ctx.principal.id,
      deployedAt: now,
    };
    this.deployments.set(id, record);
    return record;
  }

  approvePromotion(
    ctx: Pick<TenantContext, 'orgId' | 'principal'>,
    promotionId: string,
  ): { promotion: PromotionRecord; deployment: DeploymentRecord } {
    const promo = this.promotions.get(promotionId);
    if (!promo || promo.orgId !== ctx.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Promotion not found: ${promotionId}`);
    }
    if (promo.status !== 'pending_approval') {
      throw new PlatformError(
        'RES_CONFLICT',
        `Promotion "${promotionId}" is in status "${promo.status}", not pending_approval`,
      );
    }
    if (promo.initiatedBy === ctx.principal.id) {
      throw new PlatformError(
        'AUTH_FORBIDDEN',
        'Separation of Duties: promotion initiator cannot approve their own promotion',
      );
    }

    const now = new Date().toISOString();
    const deployment = this.upsertDeployment(ctx, {
      workspaceId: promo.workspaceId,
      environment: promo.toEnv,
      subjectType: promo.subjectType,
      subjectId: promo.subjectId,
      versionId: promo.versionId,
      trafficPct: promo.canaryPct,
    });

    const updated: PromotionRecord = {
      ...promo,
      status: 'deployed',
      approvedBy: ctx.principal.id,
      deploymentId: deployment.id,
      deployedAt: now,
      updatedAt: now,
    };
    this.promotions.set(promotionId, updated);
    return { promotion: updated, deployment };
  }

  rejectPromotion(
    ctx: Pick<TenantContext, 'orgId' | 'principal'>,
    promotionId: string,
  ): PromotionRecord {
    const promo = this.promotions.get(promotionId);
    if (!promo || promo.orgId !== ctx.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Promotion not found: ${promotionId}`);
    }
    if (promo.status !== 'pending_approval') {
      throw new PlatformError(
        'RES_CONFLICT',
        `Promotion "${promotionId}" cannot be rejected from status "${promo.status}"`,
      );
    }
    const now = new Date().toISOString();
    const updated: PromotionRecord = {
      ...promo,
      status: 'rejected',
      approvedBy: ctx.principal.id,
      updatedAt: now,
    };
    this.promotions.set(promotionId, updated);
    return updated;
  }

  rollbackDeployment(
    ctx: Pick<TenantContext, 'orgId' | 'principal'>,
    deploymentId: string,
  ): DeploymentRecord {
    const dep = this.deployments.get(deploymentId);
    if (!dep || dep.orgId !== ctx.orgId) {
      throw new PlatformError('RES_NOT_FOUND', `Deployment not found: ${deploymentId}`);
    }
    if (!dep.previousVersionId) {
      throw new PlatformError(
        'RES_CONFLICT',
        `Deployment "${deploymentId}" has no previous version to roll back to`,
      );
    }

    const now = new Date().toISOString();
    const restored: DeploymentRecord = {
      ...dep,
      versionId: dep.previousVersionId,
      previousVersionId: dep.versionId,
      channel: 'stable',
      trafficPct: 100,
      status: 'rolled_back',
      deployedBy: ctx.principal.id,
      deployedAt: now,
    };
    this.deployments.set(deploymentId, restored);

    // Mark latest deployed promotion for this deployment as rolled_back
    for (const [pId, p] of this.promotions.entries()) {
      if (p.deploymentId === deploymentId && p.status === 'deployed') {
        this.promotions.set(pId, {
          ...p,
          status: 'rolled_back',
          rolledBackAt: now,
          updatedAt: now,
        });
      }
    }

    return restored;
  }

  listDeployments(ctx: Pick<TenantContext, 'orgId' | 'workspaceId'>): DeploymentRecord[] {
    return Array.from(this.deployments.values()).filter(
      (d) => d.orgId === ctx.orgId && (!ctx.workspaceId || d.workspaceId === ctx.workspaceId),
    );
  }

  listPromotions(ctx: Pick<TenantContext, 'orgId' | 'workspaceId'>): PromotionRecord[] {
    return Array.from(this.promotions.values()).filter(
      (p) => p.orgId === ctx.orgId && (!ctx.workspaceId || p.workspaceId === ctx.workspaceId),
    );
  }
}
