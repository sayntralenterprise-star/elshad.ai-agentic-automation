export type FailureClass =
  | 'transient'
  | 'permanent'
  | 'policy_violation'
  | 'budget'
  | 'model_refusal'
  | 'tool_contract_violation'
  | 'human_rejected'
  | 'timeout';

export interface ErrorMeta {
  readonly http: number;
  readonly retryable: boolean;
  readonly failureClass: FailureClass;
  readonly guidance: string;
}

/**
 * Complete error catalogue from PRD Appendix O.2 (49 codes) with DOC-Q-003 resolution.
 */
export const ERROR_CATALOGUE = {
  AUTH_UNAUTHENTICATED: {
    http: 401,
    retryable: false,
    failureClass: 'permanent',
    guidance: 'Sign in again',
  },
  AUTH_TOKEN_EXPIRED: {
    http: 401,
    retryable: true,
    failureClass: 'permanent',
    guidance: 'Refresh session',
  },
  AUTH_FORBIDDEN: {
    http: 403,
    retryable: false,
    failureClass: 'permanent',
    guidance: 'Request required role from workspace admin',
  },
  AUTH_STEP_UP_REQUIRED: {
    http: 403,
    retryable: true,
    failureClass: 'permanent',
    guidance: 'Confirm identity via step-up authentication',
  },
  VAL_SCHEMA_MISMATCH: {
    http: 422,
    retryable: false,
    failureClass: 'permanent',
    guidance: 'Verify input against schema',
  },
  VAL_UNKNOWN_FIELD: {
    http: 422,
    retryable: false,
    failureClass: 'permanent',
    guidance: 'Remove unexpected property',
  },
  VAL_GRAPH_INVALID: {
    http: 422,
    retryable: false,
    failureClass: 'permanent',
    guidance: 'Fix listed workflow graph validation errors',
  },
  VAL_LIMIT_EXCEEDS_CEILING: {
    http: 422,
    retryable: false,
    failureClass: 'permanent',
    guidance: 'Lower limit below workspace ceiling',
  },
  RES_NOT_FOUND: {
    http: 404,
    retryable: false,
    failureClass: 'permanent',
    guidance: 'Check resource identifier and workspace scope',
  },
  RES_CONFLICT: {
    http: 409,
    retryable: true,
    failureClass: 'permanent',
    guidance: 'Reload resource and retry with latest ETag/state',
  },
  RES_GONE: {
    http: 410,
    retryable: false,
    failureClass: 'permanent',
    guidance: 'Resource has been deleted or retired',
  },
  POL_DENIED: {
    http: 403,
    retryable: false,
    failureClass: 'policy_violation',
    guidance: 'Action denied by governance policy',
  },
  POL_APPROVAL_REQUIRED: {
    http: 202,
    retryable: false,
    failureClass: 'policy_violation',
    guidance: 'Approval request created; awaiting reviewer decision',
  },
  POL_UNTRUSTED_CONTEXT: {
    http: 403,
    retryable: false,
    failureClass: 'policy_violation',
    guidance: 'Approve action or restart run without untrusted input',
  },
  BUD_SOFT_LIMIT: {
    http: 200,
    retryable: false,
    failureClass: 'budget',
    guidance: 'Soft budget limit reached; alert emitted',
  },
  BUD_HARD_LIMIT: {
    http: 402,
    retryable: false,
    failureClass: 'budget',
    guidance: 'Increase budget or wait for next billing period',
  },
  BUD_RATE_LIMITED: {
    http: 429,
    retryable: true,
    failureClass: 'budget',
    guidance: 'Honour Retry-After header before retrying',
  },
  BUD_QUOTA_CONCURRENCY: {
    http: 429,
    retryable: true,
    failureClass: 'budget',
    guidance: 'Concurrency quota reached; retry later',
  },
  RUN_TIMEOUT: {
    http: 408,
    retryable: false,
    failureClass: 'timeout',
    guidance: 'Raise wall-time limit or simplify run',
  },
  RUN_STEP_LIMIT: {
    http: 422,
    retryable: false,
    failureClass: 'budget',
    guidance: 'Maximum step limit reached',
  },
  RUN_TOKEN_LIMIT: {
    http: 422,
    retryable: false,
    failureClass: 'budget',
    guidance: 'Maximum token limit reached',
  },
  RUN_LOOP_DETECTED: {
    http: 422,
    retryable: false,
    failureClass: 'permanent',
    guidance: 'Review agent plan and tool repetition',
  },
  RUN_CANCELLED: {
    http: 409,
    retryable: false,
    failureClass: 'permanent',
    guidance: 'Run was cancelled',
  },
  RUN_DEPTH_EXCEEDED: {
    http: 422,
    retryable: false,
    failureClass: 'budget',
    guidance: 'Delegation depth limit exceeded',
  },
  TOOL_NOT_GRANTED: {
    http: 403,
    retryable: false,
    failureClass: 'policy_violation',
    guidance: 'Attach required tool grant to agent',
  },
  TOOL_ARGS_INVALID: {
    http: 422,
    retryable: false,
    failureClass: 'tool_contract_violation',
    guidance: 'Arguments failed tool input schema',
  },
  TOOL_TIMEOUT: {
    http: 504,
    retryable: true,
    failureClass: 'transient',
    guidance: 'Tool execution timed out',
  },
  TOOL_UPSTREAM_ERROR: {
    http: 502,
    retryable: true,
    failureClass: 'transient',
    guidance: 'Upstream tool service returned 5xx',
  },
  TOOL_UPSTREAM_REJECTED: {
    http: 400,
    retryable: false,
    failureClass: 'permanent',
    guidance: 'Upstream tool service rejected request',
  },
  TOOL_CONTRACT_VIOLATION: {
    http: 502,
    retryable: false,
    failureClass: 'tool_contract_violation',
    guidance: 'Tool output failed declared output schema',
  },
  TOOL_SANDBOX_ERROR: {
    http: 500,
    retryable: false,
    failureClass: 'permanent',
    guidance: 'Sandbox execution failed or exceeded resource limits',
  },
  TOOL_SSRF_BLOCKED: {
    http: 403,
    retryable: false,
    failureClass: 'policy_violation',
    guidance: 'Destination blocked by SSRF guard',
  },
  MODEL_RATE_LIMIT: {
    http: 429,
    retryable: true,
    failureClass: 'transient',
    guidance: 'Provider rate limit hit; apply backoff or fallback',
  },
  MODEL_OVERLOADED: {
    http: 503,
    retryable: true,
    failureClass: 'transient',
    guidance: 'Model provider overloaded; fallback triggered',
  },
  MODEL_REFUSAL: {
    http: 200,
    retryable: false,
    failureClass: 'model_refusal',
    guidance: 'Model refused request; fallback or escalate',
  },
  MODEL_CONTEXT_EXCEEDED: {
    http: 422,
    retryable: false,
    failureClass: 'permanent',
    guidance: 'Reduce memory retrieval or message history',
  },
  MODEL_OUTPUT_INVALID: {
    http: 502,
    retryable: true,
    failureClass: 'tool_contract_violation',
    guidance: 'Structured output invalid after repair',
  },
  MODEL_AUTH_FAILED: {
    http: 401,
    retryable: false,
    failureClass: 'permanent',
    guidance: 'Verify provider API key in workspace settings',
  },
  MEM_SCOPE_DENIED: {
    http: 403,
    retryable: false,
    failureClass: 'policy_violation',
    guidance: 'Memory scope not permitted for agent',
  },
  MEM_BACKEND_ERROR: {
    http: 502,
    retryable: true,
    failureClass: 'transient',
    guidance: 'Vector or memory backend failure',
  },
  KB_INGEST_FAILED: {
    http: 422,
    retryable: false,
    failureClass: 'permanent',
    guidance: 'Document parsing or chunking failed',
  },
  CONN_EXPIRED: {
    http: 401,
    retryable: false,
    failureClass: 'permanent',
    guidance: 'Reconnect expired integration credential',
  },
  CONN_UNHEALTHY: {
    http: 503,
    retryable: true,
    failureClass: 'transient',
    guidance: 'Connection health check failed',
  },
  HUMAN_REJECTED: {
    http: 409,
    retryable: false,
    failureClass: 'human_rejected',
    guidance: 'Human reviewer rejected action',
  },
  HUMAN_TIMEOUT: {
    http: 408,
    retryable: false,
    failureClass: 'timeout',
    guidance: 'Approval request expired without decision',
  },
  SYS_UNAVAILABLE: {
    http: 503,
    retryable: true,
    failureClass: 'transient',
    guidance: 'Platform dependency temporarily unavailable',
  },
  SYS_INTERNAL: {
    http: 500,
    retryable: false,
    failureClass: 'permanent',
    guidance: 'Unexpected internal error; inspect request_id',
  },
  SYS_PAUSED: {
    http: 423,
    retryable: true,
    failureClass: 'policy_violation',
    guidance: 'Kill switch active; contact administrator',
  },
  SYS_MAINTENANCE: {
    http: 503,
    retryable: true,
    failureClass: 'transient',
    guidance: 'Platform in scheduled maintenance window',
  },
} as const satisfies Record<string, ErrorMeta>;

export type ErrorCode = keyof typeof ERROR_CATALOGUE;

export class PlatformError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly failureClass: FailureClass;
  readonly details: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    details: Record<string, unknown> = {},
    httpStatusOverride?: number,
  ) {
    super(message);
    this.name = 'PlatformError';
    const meta = ERROR_CATALOGUE[code];
    this.code = code;
    this.httpStatus = httpStatusOverride ?? meta.http;
    this.retryable = meta.retryable;
    this.failureClass = meta.failureClass;
    this.details = details;
  }
}

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details: Record<string, unknown>;
    request_id: string;
    trace_id: string;
    doc_url: string;
  };
}

export function toErrorEnvelope(
  err: unknown,
  requestId: string,
  traceId: string,
  docsBaseUrl = 'https://docs.elshad.ai/errors',
): { status: number; body: ErrorEnvelope } {
  if (err instanceof PlatformError) {
    return {
      status: err.httpStatus,
      body: {
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
          request_id: requestId,
          trace_id: traceId,
          doc_url: `${docsBaseUrl}/${err.code}`,
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: 'SYS_INTERNAL',
        message: 'An unexpected internal error occurred.',
        details: {},
        request_id: requestId,
        trace_id: traceId,
        doc_url: `${docsBaseUrl}/SYS_INTERNAL`,
      },
    },
  };
}
