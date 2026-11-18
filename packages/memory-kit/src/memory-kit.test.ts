import { describe, expect, it } from 'vitest';
import {
  PlatformError,
  type EnvironmentId,
  type OrgId,
  type PrincipalId,
  type ProjectId,
  type TenantContext,
  type WorkspaceId,
} from '@elshad/domain';
import {
  ConversationSessionStore,
  DeterministicEmbeddingGenerator,
  InMemoryMemoryBackend,
  KnowledgeBaseService,
  chunkDocumentN211,
  cosineSimilarity,
  createKbSearchTool,
} from './index.js';

function makeCtx(overrides: { orgId?: string; workspaceId?: string; principalId?: string } = {}): TenantContext {
  return {
    orgId: (overrides.orgId ?? 'org_s05') as OrgId,
    workspaceId: (overrides.workspaceId ?? 'ws_s05') as WorkspaceId,
    projectId: 'prj_s05' as ProjectId,
    environmentId: 'env_dev' as EnvironmentId,
    principal: {
      id: (overrides.principalId ?? 'prn_alice') as PrincipalId,
      type: 'user',
    },
    requestId: 'req_test_s05',
    traceId: 'trace_test_s05',
  };
}

describe('@elshad/memory-kit E0.5-1..4', () => {
  it('compacts long session history into rolling summary while preserving identifiers [E0.5-1]', () => {
    const store = new ConversationSessionStore({
      compactThresholdTokens: 80,
      keepRecentMessages: 2,
    });
    const ctx = makeCtx();

    const s1 = store.appendMessages(ctx, {
      subjectId: 'user_bob',
      title: 'Refund & Invoice Escalation',
      messages: [
        {
          role: 'user',
          content:
            'Customer alice.ops@elshad.local opened ticket T-10492 on 2026-11-10 regarding invoice INV-9981 for $149.95 on order ORD-441.',
        },
        {
          role: 'assistant',
          content:
            'Checked correlation UUID 0192b123-4567-789a-bcde-112233445566 for agent agt_triage_01 and queued inspection.',
        },
        {
          role: 'tool',
          content: 'CRM lookup confirmed duplicate billing charge $149.95 on INV-9981.',
        },
        {
          role: 'user',
          content: 'Please proceed with issuing the credit memo today.',
        },
        {
          role: 'assistant',
          content: 'Credit memo approved and dispatched.',
        },
      ],
    });

    expect(s1.messages).toHaveLength(2);
    expect(s1.rollingSummary).toContain('T-10492');
    expect(s1.rollingSummary).toContain('INV-9981');
    expect(s1.rollingSummary).toContain('ORD-441');
    expect(s1.rollingSummary).toContain('alice.ops@elshad.local');
    expect(s1.rollingSummary).toContain('0192b123-4567-789a-bcde-112233445566');
    expect(s1.rollingSummary).toContain('$149.95');
    expect(s1.rollingSummary).toContain('agt_triage_01');
    expect(s1.preservedIdentifiers).toEqual(
      expect.arrayContaining([
        'T-10492',
        'INV-9981',
        'ORD-441',
        'alice.ops@elshad.local',
        '0192b123-4567-789a-bcde-112233445566',
        '$149.95',
      ]),
    );
  });

  it('achieves Recall@5 >= 0.8 on seeded corpus with hybrid N.2.10 scoring, isolation, contradiction, dedup & erasure [E0.5-2]', async () => {
    const backend = new InMemoryMemoryBackend({
      embedder: new DeterministicEmbeddingGenerator({ dimension: 256 }),
    });
    const sessionStore = new ConversationSessionStore();
    backend.attachSessionEraseHook((orgId, subjectId) => sessionStore.eraseBySubject(orgId, subjectId));

    const ctx = makeCtx();
    const seededFacts: Array<{ key: string; content: string }> = [
      { key: 'refund_sla', content: 'Enterprise billing refunds complete within 5 business days with finance approval.' },
      { key: 'pgvector', content: 'Postgres pgvector HNSW partial expression indexes support 1536 dimension embeddings.' },
      { key: 'webhook_hmac', content: 'Inbound webhooks validate X-Signature HMAC-SHA256 headers and reject clock skew above 5 minutes.' },
      { key: 'ssrf_guard', content: 'Outbound HTTP integrations resolve DNS first and block RFC1918 and 169.254.169.254 metadata hosts.' },
      { key: 'sandbox_python', content: 'Python code tools run inside a network-disabled read-only sandbox container with memory limits.' },
      { key: 'audit_chain', content: 'Immutable audit events compute chained SHA-256 hashes over canonical JSON payloads.' },
      { key: 'idempotency', content: 'Side-effect tool calls key effect ledger deduplication on sha256 run_id step_seq attempt_group.' },
      { key: 'canary', content: 'Staging promotion verifies eval regression gates before flipping traffic to production.' },
      { key: 'rotate_key', content: 'Workspace API keys display an immutable prefix once and store salted hashes at rest.' },
      { key: 'loop_detect', content: 'ReAct agent runtime halts repeated identical failing tool invocations with RUN_LOOP_DETECTED.' },
    ];

    const idsByKey = new Map<string, string>();
    for (const fact of seededFacts) {
      const created = await backend.put(ctx, {
        scope: 'project',
        scopeId: 'prj_s05',
        kind: 'semantic',
        content: fact.content,
        importance: 0.75,
        metadata: { fact_key: fact.key },
      });
      idsByKey.set(fact.key, created.id);
    }

    // Add near-duplicate to verify N.2.10 deduplication (cosine > 0.95)
    await backend.put(ctx, {
      scope: 'project',
      scopeId: 'prj_s05',
      kind: 'semantic',
      content: 'Enterprise billing refunds complete within 5 business days with finance approval!',
      importance: 0.5,
      metadata: { fact_key: 'refund_sla_dup' },
    });

    const evalQueries: Array<{ query: string; expectedKey: string }> = [
      { query: 'How many business days does finance refund take?', expectedKey: 'refund_sla' },
      { query: 'HNSW pgvector embedding dimension index', expectedKey: 'pgvector' },
      { query: 'HMAC-SHA256 webhook signature clock skew', expectedKey: 'webhook_hmac' },
      { query: 'SSRF RFC1918 metadata host block DNS', expectedKey: 'ssrf_guard' },
      { query: 'API key prefix salted hash storage', expectedKey: 'rotate_key' },
    ];

    let hits = 0;
    for (const eq of evalQueries) {
      const res = await backend.search(ctx, {
        query: eq.query,
        topK: 5,
        allowedScopes: [{ scope: 'project', scopeId: 'prj_s05' }],
      });
      const expectedId = idsByKey.get(eq.expectedKey)!;
      if (res.some((r) => r.item.id === expectedId)) {
        hits += 1;
      }
      // Verify near-duplicate of refund_sla is deduplicated when searching refunds
      if (eq.expectedKey === 'refund_sla') {
        const refundKeys = res
          .map((r) => r.item.metadata['fact_key'])
          .filter((k) => k === 'refund_sla' || k === 'refund_sla_dup');
        expect(refundKeys.length).toBeLessThanOrEqual(1);
      }
    }
    const recallAt5 = hits / evalQueries.length;
    expect(recallAt5).toBeGreaterThanOrEqual(0.8);

    // User scope & sensitivity isolation (FR-MEM-1, FR-MEM-5)
    const userA = await backend.put(ctx, {
      scope: 'user',
      scopeId: 'user_a',
      kind: 'episodic',
      content: 'Alice prefers Slack notifications for urgent outage tickets.',
      sensitivity: 'internal',
    });
    const userB = await backend.put(ctx, {
      scope: 'user',
      scopeId: 'user_b',
      kind: 'episodic',
      content: 'Bob passport SSN secret number restricted data.',
      sensitivity: 'restricted',
    });
    await backend.put(ctx, {
      scope: 'user',
      scopeId: 'user_a',
      kind: 'semantic',
      content: 'Alice confidential tax ID X-9991 must not leak under internal policy.',
      sensitivity: 'restricted',
    });

    const userAScoped = await backend.search(ctx, {
      query: 'notifications secret restricted',
      topK: 10,
      allowedScopes: [{ scope: 'user', scopeId: 'user_a' }],
      maxSensitivity: 'internal',
    });
    expect(userAScoped.map((r) => r.item.id)).toContain(userA.id);
    expect(userAScoped.map((r) => r.item.id)).not.toContain(userB.id);
    expect(userAScoped.every((r) => r.item.sensitivity === 'public' || r.item.sensitivity === 'internal')).toBe(true);

    // Contradiction detection (FR-MEM-4)
    const fact1 = await backend.put(ctx, {
      scope: 'user',
      scopeId: 'user_a',
      kind: 'semantic',
      content: 'Primary region is eu-west-1.',
      metadata: { entity: 'tenant_pref', attribute: 'region' },
    });
    const fact2 = await backend.put(ctx, {
      scope: 'user',
      scopeId: 'user_a',
      kind: 'semantic',
      content: 'Primary region is us-east-1.',
      metadata: { entity: 'tenant_pref', attribute: 'region' },
    });
    expect(fact2.contradictsId).toBe(fact1.id);

    // Right-to-erasure removes user items AND session summaries (FR-MEM-5)
    sessionStore.appendMessages(ctx, {
      sessionId: 'ses_erasure_1',
      subjectId: 'user_a',
      messages: [{ role: 'user', content: 'Help with INV-5555' }],
    });
    const report = await backend.eraseSubject(ctx, 'user_a');
    expect(report.deletedMemoryItems).toBe(4);
    expect(report.deletedSessions).toBe(1);
    expect(await backend.get(ctx, userA.id)).toBeNull();
    expect(sessionStore.get(ctx, 'ses_erasure_1')).toBeNull();
    const afterErase = await backend.search(ctx, {
      query: 'Slack notifications region',
      topK: 10,
      allowedScopes: [{ scope: 'user', scopeId: 'user_a' }],
    });
    expect(afterErase).toHaveLength(0);

    // Sanity check high similarity on duplicates
    expect(cosineSimilarity(userA.embedding, userB.embedding)).toBeLessThan(0.5);
  });

  it('chunks structurally per N.2.11, keeps tables/code whole, and incrementally embeds ONLY changed chunks [E0.5-3, E0.5-4]', async () => {
    const embedder = new DeterministicEmbeddingGenerator({ dimension: 128 });
    let ssrfSafeCalls = 0;
    const kbService = new KnowledgeBaseService({
      embedder,
      resolveHostFn: async () => ['93.184.216.34'],
      fetchUrlFn: async () => {
        ssrfSafeCalls += 1;
        return {
          title: 'Remote Runbook',
          mimeType: 'text/html',
          content: '<h1>Remote Runbook</h1><p>Latency threshold is 250ms in production.</p>',
        };
      },
    });
    const ctx = makeCtx();

    const kb = kbService.createKnowledgeBase(ctx, {
      name: 'Ops & Support KB',
      embeddingDim: 128,
      chunkTargetTokens: 60,
      chunkMaxTokens: 200,
      chunkOverlapTokens: 10,
    });

    const v1Markdown = [
      '# Billing Policy',
      '',
      'Standard refunds apply to annual plans canceled within 14 days of purchase.',
      '',
      '| Tier | SLA Hours | Escalation |',
      '| --- | --- | --- |',
      '| Gold | 4 | PagerDuty |',
      '| Silver | 24 | Slack |',
      '',
      '# Webhook Security',
      '',
      '```ts',
      'export function verifyHmac(secret: string, body: string): string {',
      '  return secret + body;',
      '}',
      '```',
      '',
      '# Disaster Recovery',
      '',
      'Postgres point-in-time recovery snapshots run every 15 minutes across zones.',
    ].join('\n');

    // Verify chunker keeps fenced code block & table summary intact
    const previewChunks = chunkDocumentN211(v1Markdown, 'text/markdown', {
      targetTokens: 60,
      maxTokens: 200,
      overlapTokens: 10,
    });
    expect(previewChunks.some((c) => c.content.includes('Table summary'))).toBe(true);
    expect(previewChunks.some((c) => c.content.includes('export function verifyHmac'))).toBe(true);
    expect(previewChunks.some((c) => c.sectionPath.includes('Webhook Security'))).toBe(true);

    const first = await kbService.ingestDocument(ctx, kb.id, {
      sourceName: 'support-handbook.md',
      externalKey: 'handbook',
      title: 'Support Handbook',
      mimeType: 'text/markdown',
      content: v1Markdown,
    });
    expect(first.syncReport.addedChunks).toBe(3);
    expect(first.syncReport.unchangedChunks).toBe(0);
    const embedsAfterFirst = embedder.embedCallCount;
    expect(embedsAfterFirst).toBe(3);

    // Modify ONLY Billing Policy paragraph; Webhook Security & Disaster Recovery stay unchanged
    const v2Markdown = v1Markdown.replace(
      'Standard refunds apply to annual plans canceled within 14 days of purchase.',
      'Enterprise refunds apply to annual plans canceled within 30 days of purchase.',
    );

    const resyncReport = await kbService.syncDocumentContent(
      ctx,
      kb.id,
      first.document.id,
      v2Markdown,
    );
    expect(resyncReport.unchangedChunks).toBe(2);
    expect(resyncReport.addedChunks).toBe(1);
    expect(resyncReport.reEmbeddedChunks).toBe(1);
    expect(resyncReport.deletedChunks).toBe(1);
    // Embedder was invoked ONLY once more for the single changed chunk
    expect(embedder.embedCallCount - embedsAfterFirst).toBe(1);

    // Query KB & verify inline [cit:<chunk_id>] citations + kb_search built-in tool
    const queryRes = await kbService.queryKnowledgeBase(ctx, {
      kbId: kb.id,
      query: '30 days enterprise refund policy',
      topK: 3,
    });
    expect(queryRes.citations.length).toBeGreaterThan(0);
    const topCitation = queryRes.citations[0]!;
    expect(queryRes.answer).toContain(`[cit:${topCitation.chunkId}]`);
    expect(topCitation.docTitle).toBe('Support Handbook');

    const { contract, executor } = createKbSearchTool(kbService);
    expect(contract.name).toBe('kb_search');
    const toolOut = await executor(
      { kb_id: kb.id, query: 'verifyHmac webhook', top_k: 2 },
      ctx,
    );
    expect(String(toolOut['answer'])).toContain('[cit:');

    // URL ingestion allows safe URLs and blocks SSRF metadata endpoints
    await kbService.ingestDocument(ctx, kb.id, {
      sourceName: 'runbook-url',
      kind: 'url',
      uri: 'https://docs.example.com/runbook',
      title: 'Remote Runbook',
    });
    expect(ssrfSafeCalls).toBe(1);

    await expect(
      kbService.ingestDocument(ctx, kb.id, {
        sourceName: 'bad-url',
        kind: 'url',
        uri: 'http://169.254.169.254/latest/meta-data',
        title: 'Metadata Attack',
      }),
    ).rejects.toMatchObject<Partial<PlatformError>>({
      code: 'TOOL_SSRF_BLOCKED',
    });
  });
});
