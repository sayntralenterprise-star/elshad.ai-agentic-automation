import type { Brand } from './ids.js';

/**
 * Platform monetary unit: integer micro-USD (1 USD = 1,000,000 micro-USD) per PRD D22.
 */
export type MicroUsd = Brand<number, 'MicroUsd'>;

export const MICRO_USD_PER_USD = 1_000_000;

export function microUsd(amount: number): MicroUsd {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(`MicroUsd must be a non-negative safe integer, got ${amount}`);
  }
  return amount as MicroUsd;
}

export function usdToMicroUsd(usd: number): MicroUsd {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new Error(`USD amount must be finite and non-negative, got ${usd}`);
  }
  return microUsd(Math.ceil(usd * MICRO_USD_PER_USD));
}

export function addMicroUsd(a: MicroUsd, b: MicroUsd): MicroUsd {
  return microUsd((a as number) + (b as number));
}

export function formatMicroUsdAsUsd(amount: MicroUsd, decimals = 4): string {
  const usd = (amount as number) / MICRO_USD_PER_USD;
  return `$${usd.toFixed(decimals)}`;
}
