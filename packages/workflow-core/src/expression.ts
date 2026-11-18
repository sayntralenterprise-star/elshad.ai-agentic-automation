import { createHash, randomUUID } from 'node:crypto';
import { PlatformError } from '@elshad/domain';
import { withSpan } from '@elshad/telemetry';

export interface ExprScope {
  readonly json: Record<string, unknown>;
  readonly item: number;
  readonly node: Record<string, { readonly json: Record<string, unknown> }>;
  readonly trigger?: Record<string, unknown>;
  readonly run?: { readonly id: string; readonly started: string; readonly labels: Record<string, string> };
  readonly env?: Record<string, string>;
  readonly now?: string;
  readonly workflow?: { readonly id: string; readonly name: string; readonly version: string };
}

export interface ExprLimits {
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

export interface ExpressionEngine {
  evaluate(expr: string, scope: ExprScope, limits?: ExprLimits): Promise<unknown>;
}

const DEFAULT_TIMEOUT_MS = 50;
const DEFAULT_MAX_BYTES = 1_048_576;
const BLOCKED_PROPS = new Set(['__proto__', 'constructor', 'prototype']);

type TokenKind =
  | 'ident'
  | 'var'
  | 'string'
  | 'number'
  | 'op'
  | 'punct'
  | 'eof';

interface Token {
  kind: TokenKind;
  value: string;
  pos: number;
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    // Two-character operators
    const two = src.slice(i, i + 2);
    if (two === '!=' || two === '<=' || two === '>=') {
      tokens.push({ kind: 'op', value: two, pos: i });
      i += 2;
      continue;
    }

    if ('=<>+-*/%&?:!'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch, pos: i });
      i += 1;
      continue;
    }

    if ('.,()[]{}'.includes(ch)) {
      tokens.push({ kind: 'punct', value: ch, pos: i });
      i += 1;
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      const start = i;
      i += 1;
      let str = '';
      let closed = false;
      while (i < src.length) {
        const c = src[i]!;
        if (c === '\\') {
          const next = src[i + 1];
          if (next === undefined) break;
          if (next === 'n') str += '\n';
          else if (next === 't') str += '\t';
          else if (next === 'r') str += '\r';
          else str += next;
          i += 2;
          continue;
        }
        if (c === quote) {
          closed = true;
          i += 1;
          break;
        }
        str += c;
        i += 1;
      }
      if (!closed) {
        throw new PlatformError('VAL_SCHEMA_MISMATCH', `Unterminated string literal at ${start}`);
      }
      tokens.push({ kind: 'string', value: str, pos: start });
      continue;
    }

    if (/[0-9]/.test(ch)) {
      const start = i;
      while (i < src.length && /[0-9.]/.test(src[i]!)) i += 1;
      tokens.push({ kind: 'number', value: src.slice(start, i), pos: start });
      continue;
    }

    if (ch === '$') {
      const start = i;
      i += 1;
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i]!)) i += 1;
      const name = src.slice(start, i);
      if (name === '$') {
        throw new PlatformError('VAL_SCHEMA_MISMATCH', `Unexpected bare $ at ${start}`);
      }
      tokens.push({ kind: 'var', value: name, pos: start });
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i]!)) i += 1;
      const word = src.slice(start, i);
      if (word === 'and' || word === 'or' || word === 'in' || word === 'not') {
        tokens.push({ kind: 'op', value: word, pos: start });
      } else {
        tokens.push({ kind: 'ident', value: word, pos: start });
      }
      continue;
    }

    throw new PlatformError('VAL_SCHEMA_MISMATCH', `Unexpected token "${ch}" at ${i}`);
  }

  tokens.push({ kind: 'eof', value: '', pos: i });
  return tokens;
}

interface EvalContext {
  scope: ExprScope;
  deadlineMs: number;
  ops: number;
  depth: number;
}

function assertBudget(ctx: EvalContext): void {
  ctx.ops += 1;
  if (ctx.depth > 64) {
    throw new PlatformError('VAL_LIMIT_EXCEEDS_CEILING', 'Expression recursion depth exceeded');
  }
  if (ctx.ops > 100_000 || Date.now() > ctx.deadlineMs) {
    throw new PlatformError('RUN_TIMEOUT', 'Expression execution exceeded 50ms sandbox limit');
  }
}

function getSafeProp(target: unknown, prop: string): unknown {
  if (BLOCKED_PROPS.has(prop)) {
    throw new PlatformError('POL_DENIED', `Forbidden property access "${prop}" in expression`);
  }
  if (target === null || target === undefined) return undefined;
  if (Array.isArray(target)) {
    const idx = Number(prop);
    if (Number.isInteger(idx)) {
      return idx < 0 ? target[target.length + idx] : target[idx];
    }
    return target
      .map((el) => getSafeProp(el, prop))
      .filter((v) => v !== undefined);
  }
  if (typeof target === 'object') {
    if (!Object.prototype.hasOwnProperty.call(target, prop)) return undefined;
    return (target as Record<string, unknown>)[prop];
  }
  return undefined;
}

function isTruthy(val: unknown): boolean {
  if (val === null || val === undefined || val === false || val === 0 || val === '') return false;
  if (Array.isArray(val)) return val.some(isTruthy);
  return true;
}

function redactFields(input: unknown, classes: unknown): unknown {
  const clsList = Array.isArray(classes)
    ? classes.map((c) => String(c).toLowerCase())
    : [String(classes ?? 'pii').toLowerCase()];

  if (typeof input === 'string') {
    let s = input;
    if (clsList.includes('email') || clsList.includes('pii')) {
      s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED:email]');
    }
    if (clsList.includes('secret') || clsList.includes('api_key')) {
      s = s.replace(/\b(sk|ghp|AKIA)[A-Za-z0-9_-]{8,}\b/g, '[REDACTED:secret]');
    }
    return s;
  }
  if (Array.isArray(input)) {
    return input.map((item) => redactFields(item, clsList));
  }
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (clsList.some((c) => k.toLowerCase().includes(c))) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactFields(v, clsList);
      }
    }
    return out;
  }
  return input;
}

function addDateUnit(rawDate: unknown, nRaw: unknown, unitRaw: unknown): string {
  const base = rawDate instanceof Date ? rawDate : new Date(String(rawDate ?? ''));
  if (Number.isNaN(base.getTime())) {
    throw new PlatformError('VAL_SCHEMA_MISMATCH', `Invalid date passed to $dateAdd: ${String(rawDate)}`);
  }
  const n = Number(nRaw);
  const unit = String(unitRaw ?? 'seconds').toLowerCase();
  const next = new Date(base.getTime());
  if (unit === 'ms' || unit === 'millisecond' || unit === 'milliseconds') {
    next.setUTCMilliseconds(next.getUTCMilliseconds() + n);
  } else if (unit === 's' || unit === 'sec' || unit === 'second' || unit === 'seconds') {
    next.setUTCSeconds(next.getUTCSeconds() + n);
  } else if (unit === 'm' || unit === 'min' || unit === 'minute' || unit === 'minutes') {
    next.setUTCMinutes(next.getUTCMinutes() + n);
  } else if (unit === 'h' || unit === 'hr' || unit === 'hour' || unit === 'hours') {
    next.setUTCHours(next.getUTCHours() + n);
  } else if (unit === 'd' || unit === 'day' || unit === 'days') {
    next.setUTCDate(next.getUTCDate() + n);
  } else {
    throw new PlatformError('VAL_SCHEMA_MISMATCH', `Unsupported $dateAdd unit: ${unit}`);
  }
  return next.toISOString();
}

function invokeHelper(name: string, args: unknown[]): unknown {
  switch (name) {
    case '$uuid':
      return randomUUID();
    case '$hash':
      return createHash('sha256')
        .update(typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0] ?? null))
        .digest('hex');
    case '$jsonParse':
      return JSON.parse(String(args[0] ?? 'null'));
    case '$dateAdd':
      return addDateUnit(args[0], args[1], args[2]);
    case '$lookup': {
      const table = args[0];
      const key = String(args[1] ?? '');
      return getSafeProp(table, key);
    }
    case '$redact':
      return redactFields(args[0], args[1]);
    case '$uppercase':
      return String(args[0] ?? '').toUpperCase();
    case '$lowercase':
      return String(args[0] ?? '').toLowerCase();
    case '$contains':
      return String(args[0] ?? '').includes(String(args[1] ?? ''));
    case '$length': {
      const v = args[0];
      if (typeof v === 'string' || Array.isArray(v)) return v.length;
      return 0;
    }
    case '$count':
      return Array.isArray(args[0]) ? args[0].length : args[0] === undefined ? 0 : 1;
    case '$sum':
      return Array.isArray(args[0])
        ? args[0].reduce((acc: number, x) => acc + Number(x ?? 0), 0)
        : Number(args[0] ?? 0);
    case '$string':
      return args[0] === undefined ? undefined : String(args[0]);
    case '$number':
      return Number(args[0]);
    case '$boolean':
      return isTruthy(args[0]);
    case '$exists':
      return args[0] !== undefined;
    case '$not':
      return !isTruthy(args[0]);
    default:
      throw new PlatformError('VAL_SCHEMA_MISMATCH', `Unknown expression function "${name}"`);
  }
}

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly ctx: EvalContext,
  ) {}

  private peek(): Token {
    return this.tokens[this.pos]!;
  }

  private consume(): Token {
    const t = this.tokens[this.pos]!;
    this.pos += 1;
    return t;
  }

  private match(kind: TokenKind, value?: string): boolean {
    const t = this.peek();
    if (t.kind !== kind) return false;
    if (value !== undefined && t.value !== value) return false;
    this.pos += 1;
    return true;
  }

  private expect(kind: TokenKind, value?: string): Token {
    const t = this.peek();
    if (t.kind !== kind || (value !== undefined && t.value !== value)) {
      throw new PlatformError(
        'VAL_SCHEMA_MISMATCH',
        `Expected ${value ?? kind}, got "${t.value || t.kind}" at ${t.pos}`,
      );
    }
    this.pos += 1;
    return t;
  }

  parseExpression(): unknown {
    this.ctx.depth += 1;
    try {
      assertBudget(this.ctx);
      return this.parseTernary();
    } finally {
      this.ctx.depth -= 1;
    }
  }

  private parseTernary(): unknown {
    const cond = this.parseOr();
    if (this.match('op', '?')) {
      const thenVal = this.parseExpression();
      this.expect('op', ':');
      const elseVal = this.parseExpression();
      return isTruthy(cond) ? thenVal : elseVal;
    }
    return cond;
  }

  private parseOr(): unknown {
    let left = this.parseAnd();
    while (this.match('op', 'or')) {
      const right = this.parseAnd();
      left = isTruthy(left) || isTruthy(right);
    }
    return left;
  }

  private parseAnd(): unknown {
    let left = this.parseComparison();
    while (this.match('op', 'and')) {
      const right = this.parseComparison();
      left = isTruthy(left) && isTruthy(right);
    }
    return left;
  }

  private parseComparison(): unknown {
    let left = this.parseConcatAdd();
    while (
      this.peek().kind === 'op' &&
      ['=', '!=', '<', '<=', '>', '>=', 'in'].includes(this.peek().value)
    ) {
      const op = this.consume().value;
      const right = this.parseConcatAdd();
      if (op === '=') left = left === right;
      else if (op === '!=') left = left !== right;
      else if (op === '<') left = (left as number) < (right as number);
      else if (op === '<=') left = (left as number) <= (right as number);
      else if (op === '>') left = (left as number) > (right as number);
      else if (op === '>=') left = (left as number) >= (right as number);
      else if (op === 'in') left = Array.isArray(right) && right.includes(left);
    }
    return left;
  }

  private parseConcatAdd(): unknown {
    let left = this.parseMulDiv();
    while (this.peek().kind === 'op' && ['+', '-', '&'].includes(this.peek().value)) {
      const op = this.consume().value;
      const right = this.parseMulDiv();
      if (op === '&') {
        left = `${left === undefined ? '' : String(left)}${right === undefined ? '' : String(right)}`;
      } else if (op === '+') {
        left = Number(left ?? 0) + Number(right ?? 0);
      } else {
        left = Number(left ?? 0) - Number(right ?? 0);
      }
    }
    return left;
  }

  private parseMulDiv(): unknown {
    let left = this.parseUnary();
    while (this.peek().kind === 'op' && ['*', '/', '%'].includes(this.peek().value)) {
      const op = this.consume().value;
      const right = this.parseUnary();
      if (op === '*') left = Number(left ?? 0) * Number(right ?? 0);
      else if (op === '/') left = Number(left ?? 0) / Number(right ?? 1);
      else left = Number(left ?? 0) % Number(right ?? 1);
    }
    return left;
  }

  private parseUnary(): unknown {
    if (this.match('op', 'not') || this.match('op', '!')) {
      return !isTruthy(this.parseUnary());
    }
    if (this.match('op', '-')) {
      return -Number(this.parseUnary() ?? 0);
    }
    return this.parsePostfix();
  }

  private parsePostfix(): unknown {
    let value = this.parsePrimary();

    while (true) {
      assertBudget(this.ctx);
      if (this.match('punct', '.')) {
        const keyToken = this.peek();
        if (keyToken.kind !== 'ident' && keyToken.kind !== 'string') {
          throw new PlatformError(
            'VAL_SCHEMA_MISMATCH',
            `Expected property name after ".", got "${keyToken.value || keyToken.kind}"`,
          );
        }
        this.consume();
        value = getSafeProp(value, keyToken.value);
        continue;
      }

      if (this.match('punct', '[')) {
        const exprStartPos = this.pos;
        const innerTokens: Token[] = [];
        let depth = 1;
        while (this.pos < this.tokens.length && depth > 0) {
          const tok = this.consume();
          if (tok.kind === 'punct' && tok.value === '[') depth += 1;
          else if (tok.kind === 'punct' && tok.value === ']') {
            depth -= 1;
            if (depth === 0) break;
          }
          if (tok.kind === 'eof') {
            throw new PlatformError('VAL_SCHEMA_MISMATCH', `Unclosed "[" at ${exprStartPos}`);
          }
          innerTokens.push(tok);
        }
        innerTokens.push({ kind: 'eof', value: '', pos: this.pos });

        // First test if scalar index / key or array filter predicate
        if (Array.isArray(value)) {
          const simple =
            innerTokens.length === 2 &&
            (innerTokens[0]!.kind === 'number' || innerTokens[0]!.kind === 'var');
          if (simple) {
            const p = new Parser(innerTokens, this.ctx);
            const idxVal = p.parseExpression();
            if (typeof idxVal === 'number') {
              const i = Math.trunc(idxVal);
              value = i < 0 ? value[value.length + i] : value[i];
              continue;
            }
          }
          const filtered: unknown[] = [];
          for (const el of value) {
            assertBudget(this.ctx);
            const itemScope: ExprScope =
              el && typeof el === 'object' && !Array.isArray(el)
                ? { ...this.ctx.scope, json: el as Record<string, unknown> }
                : this.ctx.scope;
            const subCtx: EvalContext = {
              scope: itemScope,
              deadlineMs: this.ctx.deadlineMs,
              ops: this.ctx.ops,
              depth: this.ctx.depth,
            };
            const p = new Parser(innerTokens, subCtx);
            const pred = p.parseExpression();
            this.ctx.ops = subCtx.ops;
            if (isTruthy(pred)) {
              filtered.push(el);
            }
          }
          value = filtered;
        } else {
          const p = new Parser(innerTokens, this.ctx);
          const keyVal = p.parseExpression();
          value = getSafeProp(value, String(keyVal ?? ''));
        }
        continue;
      }

      break;
    }

    return value;
  }

  private parsePrimary(): unknown {
    assertBudget(this.ctx);
    const tok = this.peek();

    if (tok.kind === 'number') {
      this.consume();
      return Number(tok.value);
    }
    if (tok.kind === 'string') {
      this.consume();
      return tok.value;
    }
    if (tok.kind === 'ident') {
      this.consume();
      if (tok.value === 'true') return true;
      if (tok.value === 'false') return false;
      if (tok.value === 'null') return null;
      return getSafeProp(this.ctx.scope.json, tok.value);
    }
    if (tok.kind === 'var') {
      this.consume();
      if (tok.value === '$secret') {
        throw new PlatformError(
          'POL_DENIED',
          'Access to $secret inside workflow expressions is forbidden (PRD N.3).',
        );
      }
      if (this.match('punct', '(')) {
        const args: unknown[] = [];
        if (!this.match('punct', ')')) {
          do {
            args.push(this.parseExpression());
          } while (this.match('punct', ','));
          this.expect('punct', ')');
        }
        return invokeHelper(tok.value, args);
      }
      if (tok.value === '$json') return this.ctx.scope.json;
      if (tok.value === '$item') return this.ctx.scope.item;
      if (tok.value === '$node') return this.ctx.scope.node;
      if (tok.value === '$trigger') return this.ctx.scope.trigger ?? {};
      if (tok.value === '$run') return this.ctx.scope.run ?? {};
      if (tok.value === '$env') return this.ctx.scope.env ?? {};
      if (tok.value === '$now') return this.ctx.scope.now ?? new Date().toISOString();
      if (tok.value === '$workflow') return this.ctx.scope.workflow ?? {};
      throw new PlatformError('VAL_SCHEMA_MISMATCH', `Unknown expression variable "${tok.value}"`);
    }
    if (this.match('punct', '(')) {
      const inner = this.parseExpression();
      this.expect('punct', ')');
      return inner;
    }
    if (this.match('punct', '[')) {
      const items: unknown[] = [];
      if (!this.match('punct', ']')) {
        do {
          items.push(this.parseExpression());
        } while (this.match('punct', ','));
        this.expect('punct', ']');
      }
      return items;
    }
    if (this.match('punct', '{')) {
      const obj: Record<string, unknown> = {};
      if (!this.match('punct', '}')) {
        do {
          const keyTok = this.peek();
          if (keyTok.kind !== 'string' && keyTok.kind !== 'ident') {
            throw new PlatformError('VAL_SCHEMA_MISMATCH', `Expected object key, got ${keyTok.kind}`);
          }
          this.consume();
          this.expect('op', ':');
          const val = this.parseExpression();
          if (!BLOCKED_PROPS.has(keyTok.value)) {
            obj[keyTok.value] = val;
          }
        } while (this.match('punct', ','));
        this.expect('punct', '}');
      }
      return obj;
    }

    throw new PlatformError(
      'VAL_SCHEMA_MISMATCH',
      `Unexpected token "${tok.value || tok.kind}" at ${tok.pos}`,
    );
  }
}

export class SandboxedJsonataEngine implements ExpressionEngine {
  async evaluate(expr: string, scope: ExprScope, limits?: ExprLimits): Promise<unknown> {
    return withSpan('workflow.expr.evaluate', { 'expr.length': expr.length }, async () => {
      const timeoutMs = limits?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const maxBytes = limits?.maxBytes ?? DEFAULT_MAX_BYTES;
      const now = Date.now();
      const deadlineMs = timeoutMs <= 0 ? now - 1 : now + timeoutMs;

      if (/\b\$secret\b/.test(expr)) {
        throw new PlatformError(
          'POL_DENIED',
          'Access to $secret inside workflow expressions is forbidden (PRD N.3).',
        );
      }

      const tokens = tokenize(expr);
      const ctx: EvalContext = {
        scope,
        deadlineMs,
        ops: 0,
        depth: 0,
      };
      const parser = new Parser(tokens, ctx);
      const result = parser.parseExpression();

      const serialized = JSON.stringify(result === undefined ? null : result);
      if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
        throw new PlatformError(
          'VAL_LIMIT_EXCEEDS_CEILING',
          `Expression result exceeded 1 MB cap (${maxBytes} bytes).`,
        );
      }
      return result;
    });
  }

  /**
   * DOC-Q-009: Evaluates arbitrary node config values:
   * - Starting with "=" -> whole-value JSONata expression preserving non-string types.
   * - Containing "{{ expr }}" -> string interpolation of JSONata expressions.
   */
  async evaluateConfigValue(
    value: unknown,
    scope: ExprScope,
    limits?: ExprLimits,
  ): Promise<unknown> {
    if (typeof value === 'string') {
      if (value.startsWith('=')) {
        let inner = value.slice(1).trim();
        if (inner.startsWith('{{') && inner.endsWith('}}')) {
          inner = inner.slice(2, -2).trim();
        }
        return this.evaluate(inner, scope, limits);
      }

      const templateRx = /\{\{([\s\S]*?)\}\}/g;
      if (!templateRx.test(value)) {
        return value;
      }

      templateRx.lastIndex = 0;
      let out = '';
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = templateRx.exec(value)) !== null) {
        out += value.slice(lastIndex, match.index);
        const val = await this.evaluate(match[1]!.trim(), scope, limits);
        out +=
          val === undefined || val === null
            ? ''
            : typeof val === 'object'
              ? JSON.stringify(val)
              : String(val);
        lastIndex = match.index + match[0].length;
      }
      out += value.slice(lastIndex);
      return out;
    }

    if (Array.isArray(value)) {
      const mapped: unknown[] = [];
      for (const el of value) {
        mapped.push(await this.evaluateConfigValue(el, scope, limits));
      }
      return mapped;
    }

    if (value && typeof value === 'object') {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        obj[k] = await this.evaluateConfigValue(v, scope, limits);
      }
      return obj;
    }

    return value;
  }
}
