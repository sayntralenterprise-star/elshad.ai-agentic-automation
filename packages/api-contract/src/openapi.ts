import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { ALL_ROUTES } from './routes.js';
import { ErrorEnvelopeSchema } from './schemas.js';

export interface OpenApiDocument {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{ url: string }>;
  paths?: Record<string, unknown>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
}

export function generateOpenApiDocument(): OpenApiDocument {
  const registry = new OpenAPIRegistry();
  registry.register('ErrorEnvelope', ErrorEnvelopeSchema);

  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    description: 'API key or OIDC access token',
  });
  registry.registerComponent('securitySchemes', 'sessionCookie', {
    type: 'apiKey',
    in: 'cookie',
    name: 'platform_session',
  });

  for (const route of ALL_ROUTES) {
    const request: {
      params?: z.ZodTypeAny;
      query?: z.ZodTypeAny;
      body?: { content: { 'application/json': { schema: z.ZodTypeAny } } };
    } = {};

    if (route.paramsSchema) {
      request.params = route.paramsSchema as never;
    }
    if (route.querySchema) {
      request.query = route.querySchema as never;
    }
    if (route.bodySchema) {
      request.body = {
        content: {
          'application/json': {
            schema: route.bodySchema,
          },
        },
      };
    }

    const responses: Record<
      string,
      { description: string; content?: { 'application/json': { schema: z.ZodTypeAny } } }
    > = {
      [String(route.successStatus)]: {
        description: 'Success',
        ...(route.responseSchema
          ? { content: { 'application/json': { schema: route.responseSchema } } }
          : {}),
      },
      default: {
        description: 'Standard platform error envelope',
        content: { 'application/json': { schema: ErrorEnvelopeSchema } },
      },
    };

    registry.registerPath({
      method: route.method === 'delete' ? 'delete' : route.method,
      path: route.path,
      operationId: route.id,
      summary: route.summary,
      tags: route.tags,
      security:
        route.access.kind === 'public' ? [] : [{ bearerAuth: [] }, { sessionCookie: [] }],
      request: Object.keys(request).length > 0 ? (request as never) : undefined,
      responses: responses as never,
    });
  }

  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Elshad AI Agent & Automation Platform API',
      version: '0.1.0',
      description: 'Unified runtime and governance API (Slice S0.1)',
    },
    servers: [{ url: 'http://localhost:8080' }],
  }) as unknown as OpenApiDocument;
}
