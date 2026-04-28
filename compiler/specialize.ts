/**
 * specialize.ts — type-arg resolution utilities.
 *
 * The strata pipeline (`compiler/ir/specialize.ts`) handles graph-IR
 * specialization. This module survives only as the boundary at which
 * `RawTypeArgs` (as supplied by MCP / patch-file `instanceDecl.type_args`,
 * which may carry `{op:'typeParam',name}` for outer-frame forwarding)
 * is resolved against the surrounding generic frame to produce
 * `ResolvedTypeArgs` — concrete integers — that the strata
 * specializer can consume.
 */
import type { ExprNode } from './expr.js'

export type TypeArgValue = number | ExprNode

/** Raw args as they appear on an instance entry (may contain type_param refs). */
export type RawTypeArgs = Record<string, TypeArgValue>

/** Fully resolved args — concrete integers only. Cacheable. */
export type ResolvedTypeArgs = Record<string, number>

/**
 * Resolve raw type_args against the surrounding (outer) program's resolved args.
 * Numeric literals pass through. `{ op: 'typeParam', name }` looks up in outerArgs.
 * Throws on unresolved refs, non-integer values, or unknown param names.
 */
export function resolveTypeArgs(
  rawArgs: RawTypeArgs | undefined,
  outerArgs: ResolvedTypeArgs | undefined,
  typeParams: Record<string, { type: 'int'; default?: number }> | undefined,
  contextName: string,
): ResolvedTypeArgs {
  const params = typeParams ?? {}
  const raw = rawArgs ?? {}

  for (const key of Object.keys(raw)) {
    if (!(key in params)) {
      throw new Error(`${contextName}: unknown type_arg '${key}'. Declared: ${Object.keys(params).join(', ') || '(none)'}`)
    }
  }

  const resolved: ResolvedTypeArgs = {}
  for (const [name, spec] of Object.entries(params)) {
    if (name in raw) {
      const v = raw[name]
      const n = resolveValue(v, outerArgs, `${contextName}.type_args.${name}`)
      if (!Number.isInteger(n)) {
        throw new Error(`${contextName}: type_arg '${name}' must be an integer, got ${n}`)
      }
      resolved[name] = n
    } else if (spec.default !== undefined) {
      resolved[name] = spec.default
    } else {
      throw new Error(`${contextName}: missing required type_arg '${name}' (no default)`)
    }
  }
  return resolved
}

function resolveValue(
  v: TypeArgValue,
  outerArgs: ResolvedTypeArgs | undefined,
  context: string,
): number {
  if (typeof v === 'number') return v
  if (v && typeof v === 'object' && !Array.isArray(v) && (v as { op?: string }).op === 'typeParam') {
    const name = (v as unknown as { name: string }).name
    if (!outerArgs || !(name in outerArgs)) {
      throw new Error(`${context}: unresolved type_param '${name}' (no outer frame provides it)`)
    }
    return outerArgs[name]
  }
  throw new Error(`${context}: type_arg value must be a number or { op: 'typeParam', name }, got ${JSON.stringify(v)}`)
}

/** Build a stable cache key for a specialization. */
export function specializationCacheKey(typeName: string, args: ResolvedTypeArgs): string {
  const sorted = Object.keys(args).sort().map(k => `${k}=${args[k]}`).join(',')
  return `${typeName}<${sorted}>`
}
