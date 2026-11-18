import { describe, expect, it } from 'vitest';
import type { OrgId, PrincipalId, TenantContext, WorkspaceId } from '@elshad/domain';
import { PromotionEngine } from './promotions.js';

const builderCtx: TenantContext = {
  orgId: '01930000-0000-7000-8000-000000000001' as OrgId,
  workspaceId: '01930000-0000-7000-8000-000000000002' as WorkspaceId,
  principal: {
    id: '01930000-0000-7000-8000-000000000010' as PrincipalId,
    type: 'user',
  },
};

const approverCtx: TenantContext = {
  orgId: '01930000-0000-7000-8000-000000000001' as OrgId,
  workspaceId: '01930000-0000-7000-8000-000000000002' as WorkspaceId,
  principal: {
    id: '01930000-0000-7000-8000-000000000020' as PrincipalId,
    type: 'user',
  },
};

describe('@elshad/runtime-core PromotionEngine [E1.7, N.2.13]', () => {
  it('blocks promotion when a required credential is unmapped in target environment', () => {
    const engine = new PromotionEngine();
    expect(() =>
      engine.promote(builderCtx, {
        subjectType: 'agent',
        subjectId: 'agt_1',
        versionId: 'agv_1',
        versionPublished: true,
        fromEnv: 'dev',
        toEnv: 'prod',
        requiredCredentials: ['slack_bot_token', 'stripe_api_key'],
        credentialMapping: { slack_bot_token: 'conn_prod_slack' },
        evalGatePassed: true,
      }),
    ).toThrowError(/Unmapped credential\(s\) in target environment "prod": stripe_api_key/);
  });

  it('enforces eval gate, SoD approval for prod, canary traffic, and rollback restoring previous version', () => {
    const engine = new PromotionEngine();

    // Eval gate failure blocks staging promotion
    expect(() =>
      engine.promote(builderCtx, {
        subjectType: 'agent',
        subjectId: 'agt_1',
        versionId: 'agv_1',
        fromEnv: 'dev',
        toEnv: 'staging',
        evalGatePassed: false,
      }),
    ).toThrowError(/Evaluation release gate must pass/);

    // Deploy v1 to prod via SoD approval
    const p1 = engine.promote(builderCtx, {
      subjectType: 'agent',
      subjectId: 'agt_1',
      versionId: 'agv_1',
      fromEnv: 'staging',
      toEnv: 'prod',
      evalGatePassed: true,
      evalScore: 0.94,
    });
    expect(p1.promotion.status).toBe('pending_approval');
    expect(p1.deployment).toBeNull();

    // Self-approval blocked (SoD)
    expect(() => engine.approvePromotion(builderCtx, p1.promotion.id)).toThrowError(
      /Separation of Duties/,
    );

    // Approver deploys v1
    const a1 = engine.approvePromotion(approverCtx, p1.promotion.id);
    expect(a1.promotion.status).toBe('deployed');
    expect(a1.deployment.versionId).toBe('agv_1');

    // Promote v2 as 10% canary to prod
    const p2 = engine.promote(builderCtx, {
      subjectType: 'agent',
      subjectId: 'agt_1',
      versionId: 'agv_2',
      fromEnv: 'staging',
      toEnv: 'prod',
      evalGatePassed: true,
      canaryPct: 10,
    });
    expect(p2.promotion.diffSummary['previous_version_id']).toBe('agv_1');
    const a2 = engine.approvePromotion(approverCtx, p2.promotion.id);
    expect(a2.deployment.versionId).toBe('agv_2');
    expect(a2.deployment.trafficPct).toBe(10);
    expect(a2.deployment.status).toBe('canary');

    // Rollback restores v1 at 100%
    const rolledBack = engine.rollbackDeployment(approverCtx, a2.deployment.id);
    expect(rolledBack.versionId).toBe('agv_1');
    expect(rolledBack.trafficPct).toBe(100);
    expect(rolledBack.status).toBe('rolled_back');
  });
});
