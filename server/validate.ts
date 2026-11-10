// Tiny input checks for request bodies (no schema library needed at this size).

import { badRequest } from './errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

export function uuid(v: unknown, field: string): string {
  if (!isUuid(v)) throw badRequest(`${field} must be an id`);
  return v;
}

export function obj(v: unknown, field = 'body'): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw badRequest(`${field} must be an object`);
  return v as Record<string, unknown>;
}

export function str(v: unknown, field: string, max = 20_000): string {
  if (typeof v !== 'string' || !v.trim()) throw badRequest(`${field} is required`);
  if (v.length > max) throw badRequest(`${field} is too long (max ${max} characters)`);
  return v.trim();
}

/** Optional string: `undefined` / `null` / blank → `undefined`. */
export function optStr(v: unknown, field: string, max = 20_000): string | undefined {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) return undefined;
  return str(v, field, max);
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string, fallback?: T): T {
  if ((v === undefined || v === null || v === '') && fallback !== undefined) return fallback;
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw badRequest(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return v as T;
}

export function arr(v: unknown, field: string): unknown[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw badRequest(`${field} must be a list`);
  return v;
}
