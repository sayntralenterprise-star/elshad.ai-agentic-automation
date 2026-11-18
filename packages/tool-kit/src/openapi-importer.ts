import { PlatformError } from '@elshad/domain';
import type { SideEffectClass } from '@elshad/policy-kit';
import type { ToolContract } from './shared.js';

export interface OpenApiHttpConfig {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly baseUrl: string;
  readonly path: string;
  readonly headers?: Record<string, string>;
}

export interface ImportedOpenApiTool {
  readonly contract: ToolContract;
  readonly httpConfig: OpenApiHttpConfig;
  readonly tags: readonly string[];
}

export interface OpenApiImportResult {
  readonly specTitle: string;
  readonly specVersion: string;
  readonly baseUrl: string;
  readonly tools: readonly ImportedOpenApiTool[];
}

function toSnakeCaseToolName(raw: string): string {
  let cleaned = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

  if (!/^[a-z]/.test(cleaned)) {
    cleaned = `api_${cleaned}`;
  }
  if (cleaned.length < 2) {
    cleaned = `${cleaned}_op`;
  }
  return cleaned.slice(0, 64);
}

function normalizeSemver(raw?: string): string {
  if (!raw) return '1.0.0';
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(raw.trim());
  if (match) {
    return `${match[1]}.${match[2]}.${match[3]}`;
  }
  const twoPart = /^(\d+)\.(\d+)$/.exec(raw.trim());
  if (twoPart) {
    return `${twoPart[1]}.${twoPart[2]}.0`;
  }
  return '1.0.0';
}

function resolveRef(
  schema: unknown,
  components: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || depth > 5) {
    return { type: 'object' };
  }
  const obj = schema as Record<string, unknown>;
  const ref = obj['$ref'];
  if (typeof ref === 'string' && ref.startsWith('#/components/schemas/')) {
    const schemaName = ref.slice('#/components/schemas/'.length);
    const schemas = (components['schemas'] ?? {}) as Record<string, unknown>;
    const target = schemas[schemaName];
    if (target && typeof target === 'object') {
      return resolveRef(target, components, depth + 1);
    }
  }
  return obj;
}

function mapHttpMethodToSideEffect(method: string): SideEffectClass {
  switch (method.toUpperCase()) {
    case 'GET':
    case 'HEAD':
    case 'OPTIONS':
      return 'read';
    case 'DELETE':
      return 'destructive';
    case 'POST':
    case 'PUT':
    case 'PATCH':
    default:
      return 'write';
  }
}

/**
 * Parses an OpenAPI 3.0 or 3.1 JSON specification and generates typed ToolContracts.
 */
export function importOpenApiSpec(
  rawSpec: string | Record<string, unknown>,
  options: { baseUrlOverride?: string; tags?: string[] } = {},
): OpenApiImportResult {
  let doc: Record<string, unknown>;
  if (typeof rawSpec === 'string') {
    try {
      const parsed: unknown = JSON.parse(rawSpec);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Root must be a JSON object');
      }
      doc = parsed as Record<string, unknown>;
    } catch (err) {
      throw new PlatformError(
        'VAL_SCHEMA_MISMATCH',
        `Invalid OpenAPI JSON specification: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    doc = rawSpec;
  }

  const openapiVersion = doc['openapi'];
  if (typeof openapiVersion !== 'string' || !openapiVersion.startsWith('3.')) {
    throw new PlatformError(
      'VAL_SCHEMA_MISMATCH',
      `Unsupported or missing OpenAPI version "${String(openapiVersion)}". Expected OpenAPI 3.0.x or 3.1.x.`,
    );
  }

  const paths = doc['paths'];
  if (!paths || typeof paths !== 'object' || Array.isArray(paths)) {
    throw new PlatformError('VAL_SCHEMA_MISMATCH', 'OpenAPI specification missing valid "paths" object');
  }

  const info = (doc['info'] && typeof doc['info'] === 'object' ? doc['info'] : {}) as Record<
    string,
    unknown
  >;
  const specTitle = typeof info['title'] === 'string' ? info['title'] : 'Imported OpenAPI';
  const specVersion = normalizeSemver(
    typeof info['version'] === 'string' ? info['version'] : undefined,
  );

  const servers = Array.isArray(doc['servers']) ? (doc['servers'] as Array<Record<string, unknown>>) : [];
  const defaultServerUrl =
    typeof servers[0]?.['url'] === 'string' ? servers[0]['url'] : 'https://api.example.com';
  const baseUrl = options.baseUrlOverride ?? defaultServerUrl;

  const components = (
    doc['components'] && typeof doc['components'] === 'object' ? doc['components'] : {}
  ) as Record<string, unknown>;

  const tools: ImportedOpenApiTool[] = [];
  const seenNames = new Set<string>();
  const supportedMethods = ['get', 'post', 'put', 'patch', 'delete'] as const;

  for (const [pathKey, pathItemRaw] of Object.entries(paths as Record<string, unknown>)) {
    if (!pathItemRaw || typeof pathItemRaw !== 'object') continue;
    const pathItem = pathItemRaw as Record<string, unknown>;
    const pathLevelParams = Array.isArray(pathItem['parameters'])
      ? (pathItem['parameters'] as Array<Record<string, unknown>>)
      : [];

    for (const method of supportedMethods) {
      const opRaw = pathItem[method];
      if (!opRaw || typeof opRaw !== 'object') continue;
      const op = opRaw as Record<string, unknown>;

      const rawName =
        typeof op['operationId'] === 'string' && op['operationId'].trim().length > 0
          ? op['operationId']
          : `${method}_${pathKey}`;
      let toolName = toSnakeCaseToolName(rawName);
      if (seenNames.has(toolName)) {
        let suffix = 2;
        while (seenNames.has(`${toolName.slice(0, 60)}_${suffix}`)) {
          suffix++;
        }
        toolName = `${toolName.slice(0, 60)}_${suffix}`;
      }
      seenNames.add(toolName);

      const description =
        (typeof op['summary'] === 'string' && op['summary'].trim()) ||
        (typeof op['description'] === 'string' && op['description'].trim()) ||
        `${method.toUpperCase()} ${pathKey}`;

      const inputProperties: Record<string, unknown> = {};
      const inputRequired: string[] = [];

      const opParams = Array.isArray(op['parameters'])
        ? (op['parameters'] as Array<Record<string, unknown>>)
        : [];
      for (const param of [...pathLevelParams, ...opParams]) {
        const pName = param['name'];
        if (typeof pName !== 'string' || !pName) continue;
        const pSchema = resolveRef(param['schema'] ?? { type: 'string' }, components);
        inputProperties[pName] = {
          ...pSchema,
          ...(typeof param['description'] === 'string' ? { description: param['description'] } : {}),
        };
        if (param['required'] === true || param['in'] === 'path') {
          if (!inputRequired.includes(pName)) inputRequired.push(pName);
        }
      }

      const reqBody = op['requestBody'] as Record<string, unknown> | undefined;
      if (reqBody && typeof reqBody === 'object') {
        const content = (reqBody['content'] ?? {}) as Record<string, unknown>;
        const jsonMedia = (content['application/json'] ?? Object.values(content)[0]) as
          | Record<string, unknown>
          | undefined;
        if (jsonMedia && typeof jsonMedia === 'object' && jsonMedia['schema']) {
          const bodySchema = resolveRef(jsonMedia['schema'], components);
          if (bodySchema['properties'] && typeof bodySchema['properties'] === 'object') {
            for (const [propKey, propVal] of Object.entries(
              bodySchema['properties'] as Record<string, unknown>,
            )) {
              inputProperties[propKey] = resolveRef(propVal, components);
            }
          } else {
            inputProperties['body'] = bodySchema;
          }
          if (Array.isArray(bodySchema['required'])) {
            for (const reqKey of bodySchema['required']) {
              if (typeof reqKey === 'string' && !inputRequired.includes(reqKey)) {
                inputRequired.push(reqKey);
              }
            }
          }
        }
      }

      const responses = (op['responses'] ?? {}) as Record<string, unknown>;
      const successResp = (responses['200'] ?? responses['201'] ?? responses['204']) as
        | Record<string, unknown>
        | undefined;
      let outputSchema: Record<string, unknown> = { type: 'object' };
      if (successResp && typeof successResp === 'object' && successResp['content']) {
        const respContent = successResp['content'] as Record<string, unknown>;
        const respJson = (respContent['application/json'] ?? Object.values(respContent)[0]) as
          | Record<string, unknown>
          | undefined;
        if (respJson && typeof respJson === 'object' && respJson['schema']) {
          outputSchema = resolveRef(respJson['schema'], components);
        }
      }

      const opTags = Array.isArray(op['tags'])
        ? op['tags'].filter((t): t is string => typeof t === 'string')
        : [];
      const mergedTags = Array.from(new Set([...(options.tags ?? []), ...opTags, 'openapi']));

      const sideEffect = mapHttpMethodToSideEffect(method);
      const contract: ToolContract = {
        name: toolName,
        version: specVersion,
        description: description.slice(0, 1000),
        input_schema: {
          type: 'object',
          properties: inputProperties,
          ...(inputRequired.length > 0 ? { required: inputRequired } : {}),
        },
        output_schema: outputSchema,
        side_effect_class: sideEffect,
        idempotent: method === 'get' || method === 'put' || method === 'delete',
        required_permissions: [],
        data_classification_touched: ['internal'],
        timeout_ms: 15_000,
        retry_policy: { max_attempts: 3, backoff_ms: 500 },
        cost_model: { per_call_micro_usd: 0 },
        examples: [],
        implementation: 'http',
        untrusted_source: true,
      };

      tools.push({
        contract,
        httpConfig: {
          method: method.toUpperCase() as OpenApiHttpConfig['method'],
          baseUrl,
          path: pathKey,
        },
        tags: mergedTags,
      });
    }
  }

  if (tools.length === 0) {
    throw new PlatformError(
      'VAL_SCHEMA_MISMATCH',
      'No valid HTTP operations found in OpenAPI paths',
    );
  }

  return {
    specTitle,
    specVersion,
    baseUrl,
    tools,
  };
}
