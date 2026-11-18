import { PlatformError } from '@elshad/domain';
import type { WorkflowGraph } from './graph.js';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function serializeScalar(val: unknown): string {
  if (val === null) return 'null';
  if (typeof val === 'boolean' || typeof val === 'number') return String(val);
  return JSON.stringify(String(val));
}

function serializeYamlNode(val: unknown, indent: number): string {
  const pad = ' '.repeat(indent);
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]';
    return val
      .map((item) => {
        if (Array.isArray(item) && item.length > 0) {
          return `${pad}-\n${serializeYamlNode(item, indent + 2)}`;
        }
        if (isPlainObject(item) && Object.keys(item).length > 0) {
          const lines = serializeYamlNode(item, indent + 2).split('\n');
          const first = lines[0]!.trimStart();
          const rest = lines.slice(1).join('\n');
          return rest ? `${pad}- ${first}\n${rest}` : `${pad}- ${first}`;
        }
        return `${pad}- ${serializeYamlNode(item, 0)}`;
      })
      .join('\n');
  }

  if (isPlainObject(val)) {
    const entries = Object.entries(val).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return '{}';
    return entries
      .map(([k, v]) => {
        const keyStr = /^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k);
        if ((Array.isArray(v) && v.length > 0) || (isPlainObject(v) && Object.keys(v).length > 0)) {
          return `${pad}${keyStr}:\n${serializeYamlNode(v, indent + 2)}`;
        }
        return `${pad}${keyStr}: ${serializeYamlNode(v, 0)}`;
      })
      .join('\n');
  }

  return serializeScalar(val);
}

/**
 * Lossless indented YAML serializer for WorkflowGraph definitions (FR-WF-11, E0.4-6).
 */
export function serializeWorkflowToYaml(graph: WorkflowGraph): string {
  return `${serializeYamlNode(graph, 0)}\n`;
}

interface YamlLine {
  indent: number;
  text: string;
}

function parseScalarToken(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === 'null' || trimmed === '~') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === '[]') return [];
  if (trimmed === '{}') return {};
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return JSON.parse(trimmed) as string;
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function findUnquotedColon(text: string): number {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
    } else {
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ':' && (i + 1 === text.length || text[i + 1] === ' ')) {
        return i;
      }
    }
  }
  return -1;
}

function parseKeyToken(rawKey: string): string {
  const t = rawKey.trim();
  if (t.startsWith('"') && t.endsWith('"')) return JSON.parse(t) as string;
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
  return t;
}

function parseYamlLines(lines: readonly YamlLine[], idxRef: { pos: number }, minIndent: number): unknown {
  const current = lines[idxRef.pos];
  if (!current || current.indent < minIndent) return {};

  if (current.text.startsWith('-')) {
    const arr: unknown[] = [];
    const seqIndent = current.indent;
    while (idxRef.pos < lines.length) {
      const line = lines[idxRef.pos]!;
      if (line.indent !== seqIndent || !line.text.startsWith('-')) break;
      const afterDash = line.text.slice(1).trim();
      idxRef.pos += 1;

      if (!afterDash) {
        arr.push(parseYamlLines(lines, idxRef, seqIndent + 1));
        continue;
      }

      const colonIdx = findUnquotedColon(afterDash);
      if (colonIdx !== -1) {
        // Inline object first key inside "- key: val"
        const key = parseKeyToken(afterDash.slice(0, colonIdx));
        const valRaw = afterDash.slice(colonIdx + 1).trim();
        const obj: Record<string, unknown> = {};
        obj[key] = valRaw
          ? parseScalarToken(valRaw)
          : parseYamlLines(lines, idxRef, seqIndent + 3);
        const childIndent = seqIndent + 2;
        while (idxRef.pos < lines.length) {
          const next = lines[idxRef.pos]!;
          if (next.indent < childIndent || next.text.startsWith('-')) break;
          const nextColon = findUnquotedColon(next.text);
          if (nextColon === -1) break;
          const k2 = parseKeyToken(next.text.slice(0, nextColon));
          const v2Raw = next.text.slice(nextColon + 1).trim();
          idxRef.pos += 1;
          obj[k2] = v2Raw ? parseScalarToken(v2Raw) : parseYamlLines(lines, idxRef, next.indent + 1);
        }
        arr.push(obj);
      } else {
        arr.push(parseScalarToken(afterDash));
      }
    }
    return arr;
  }

  const map: Record<string, unknown> = {};
  const mapIndent = current.indent;
  while (idxRef.pos < lines.length) {
    const line = lines[idxRef.pos]!;
    if (line.indent < mapIndent || line.text.startsWith('-')) break;
    if (line.indent > mapIndent) {
      throw new PlatformError('VAL_SCHEMA_MISMATCH', `Invalid YAML indentation near "${line.text}"`);
    }
    const colonIdx = findUnquotedColon(line.text);
    if (colonIdx === -1) {
      throw new PlatformError('VAL_SCHEMA_MISMATCH', `Invalid YAML mapping line "${line.text}"`);
    }
    const key = parseKeyToken(line.text.slice(0, colonIdx));
    const valRaw = line.text.slice(colonIdx + 1).trim();
    idxRef.pos += 1;
    if (valRaw.length > 0) {
      map[key] = parseScalarToken(valRaw);
    } else {
      const next = lines[idxRef.pos];
      if (
        !next ||
        (next.indent <= mapIndent && !(next.indent === mapIndent && next.text.startsWith('-')))
      ) {
        map[key] = {};
      } else {
        map[key] = parseYamlLines(lines, idxRef, next.indent);
      }
    }
  }
  return map;
}

/**
 * Parses YAML (or JSON) workflow text produced by serializeWorkflowToYaml losslessly.
 */
export function parseWorkflowFromYaml(yamlText: string): Record<string, unknown> {
  const trimmed = yamlText.trim();
  if (!trimmed) {
    throw new PlatformError('VAL_SCHEMA_MISMATCH', 'Empty workflow YAML document.');
  }
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as Record<string, unknown>;
  }

  const rawLines = yamlText.split(/\r?\n/);
  const parsedLines: YamlLine[] = [];
  for (const raw of rawLines) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    parsedLines.push({ indent, text: raw.trimStart() });
  }

  const parsed = parseYamlLines(parsedLines, { pos: 0 }, 0);
  if (!isPlainObject(parsed)) {
    throw new PlatformError('VAL_SCHEMA_MISMATCH', 'Workflow YAML root must be a mapping.');
  }
  return parsed;
}
