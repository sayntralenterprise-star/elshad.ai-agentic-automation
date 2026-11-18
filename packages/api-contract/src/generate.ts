import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateOpenApiDocument } from './openapi.js';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '..', '..', '..', 'docs', 'api', 'openapi.json');

mkdirSync(dirname(outPath), { recursive: true });
const doc = generateOpenApiDocument();
writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
console.log(`Generated OpenAPI 3.1 spec at ${outPath}`);
