/**
 * stdlib_loader.ts — pure (no-fs) stdlib registration.
 *
 * Accepts a map of raw stdlib JSON payloads keyed by program name and
 * wires them into a session's type registry with an on-demand resolver.
 * Shared between the disk-reading loader in program.ts and the browser
 * bundle (stdlib_bundled.ts).
 *
 * Phase C7: under `TROPICAL_USE_NEW_PIPELINE=1`, the JSON payloads are
 * lowered to ParsedProgram (via raise + parseProgram), elaborated to
 * ResolvedProgram, and registered through the strata pipeline. Default-
 * off; the legacy path still routes through `loadProgramAsType`.
 */

import type { SessionState } from './session.js'
import { normalizeProgramFile } from './session.js'
import { loadProgramAsType } from './program.js'
import type { ProgramType } from './program_types.js'
import { useNewPipeline } from './feature_flags.js'
import { elaborate, type ExternalProgramResolver } from './ir/elaborator.js'
import { compileResolvedToProgramDef } from './ir/strata.js'
import type { ResolvedProgram } from './ir/nodes.js'
import { raiseProgram } from './parse/raise.js'

type StdlibTarget =
  | Map<string, ProgramType>
  | Pick<
      SessionState,
      | 'typeRegistry'
      | 'instanceRegistry'
      | 'paramRegistry'
      | 'triggerRegistry'
      | 'specializationCache'
      | 'genericTemplates'
    > & Partial<Pick<SessionState, 'genericTemplatesResolved'>>

function toSession(target: StdlibTarget) {
  if (target instanceof Map) {
    return {
      typeRegistry: target,
      instanceRegistry: new Map(),
      paramRegistry: new Map(),
      triggerRegistry: new Map(),
      specializationCache: new Map(),
      genericTemplates: new Map(),
      genericTemplatesResolved: new Map<string, ResolvedProgram>(),
    } as Pick<
      SessionState,
      | 'typeRegistry'
      | 'instanceRegistry'
      | 'paramRegistry'
      | 'triggerRegistry'
      | 'specializationCache'
      | 'genericTemplates'
      | 'genericTemplatesResolved'
    > &
      Partial<Pick<SessionState, 'typeResolver'>>
  }
  if (!target.genericTemplatesResolved) {
    (target as { genericTemplatesResolved?: Map<string, ResolvedProgram> }).genericTemplatesResolved = new Map<string, ResolvedProgram>()
  }
  return target as typeof target & Partial<Pick<SessionState, 'typeResolver'>>
}

/**
 * Register stdlib types from a pre-loaded map of raw JSON payloads.
 * Keys are program names; values are the parsed JSON (either schema version).
 *
 * Types are indexed first, then loaded on demand via a resolver installed on
 * `session.typeResolver` — dependencies resolve recursively regardless of
 * insertion order. Generic templates are registered without instantiation
 * (instantiation requires type_args at use sites).
 *
 * Phase C7: under `useNewPipeline()`, raw JSON payloads are lifted to
 * ResolvedProgram via raise → parse → elaborate, then compiled through
 * the strata pipeline. Generic templates land in `genericTemplatesResolved`
 * so that `resolveProgramType` triggers `specializeProgram` (C3) at
 * instantiation time. Otherwise the legacy path runs unchanged.
 */
export function loadStdlibFromMap(
  target: StdlibTarget,
  rawByName: Map<string, unknown> | Record<string, unknown>,
): void {
  const session = toSession(target)
  const index: Map<string, unknown> =
    rawByName instanceof Map ? rawByName : new Map(Object.entries(rawByName))

  if (useNewPipeline()) {
    // Raise each raw v2 payload back to a ParsedProgram, then elaborate
    // against the registry-being-built (fixed-point iteration to handle
    // arbitrary dependency order). Programs without type-params compile
    // directly via compileResolvedToProgramDef; generic ones stash their
    // ResolvedProgram in genericTemplatesResolved.
    //
    // Known limitation: `raiseProgram` drops match-arm payload field
    // labels (substitutes `_unknown` placeholders) because the legacy
    // tropical_program_2 schema doesn't carry them. Programs with sum-
    // type pattern matching (e.g. TriggerRamp, EnvExpDecay) therefore
    // fail to elaborate via this path. The disk-loading `loadStdlib`
    // in `program.ts` bypasses raise — it parses .trop sources directly
    // — and is the supported entry for the new pipeline. The bundled-
    // stdlib path here is left in place for the flag-off case; under
    // flag-on with sum-using stdlib programs it raises an explicit
    // error rather than silently producing a broken registry.
    const parsedByName = new Map<string, ReturnType<typeof raiseProgram>>()
    for (const [name, raw] of index) {
      const { node } = normalizeProgramFile(raw as { schema?: string; [k: string]: unknown })
      parsedByName.set(name, raiseProgram(node))
    }

    const resolvedRegistry = new Map<string, ResolvedProgram>()
    const externalResolver: ExternalProgramResolver = name => resolvedRegistry.get(name)

    const remaining = new Map(parsedByName)
    let progress = true
    while (progress && remaining.size > 0) {
      progress = false
      for (const [name, parsed] of remaining) {
        try {
          const resolved = elaborate(parsed, externalResolver)
          resolvedRegistry.set(name, resolved)
          remaining.delete(name)
          progress = true
        } catch {
          // Sibling not yet elaborated; retry next pass.
        }
      }
    }
    if (remaining.size > 0) {
      const [name, parsed] = remaining.entries().next().value as [string, ReturnType<typeof raiseProgram>]
      elaborate(parsed, externalResolver)
      throw new Error(`loadStdlibFromMap: failed to elaborate '${name}'`)
    }

    for (const [name, prog] of resolvedRegistry) {
      if (prog.typeParams.length > 0) {
        session.genericTemplatesResolved!.set(name, prog)
        continue
      }
      if (session.typeRegistry.has(name)) continue
      const type = compileResolvedToProgramDef(prog, new Map(), session)
      session.typeRegistry.set(name, type)
    }

    if (!session.typeResolver) {
      session.typeResolver = (n: string): ProgramType | undefined => {
        const existing = session.typeRegistry.get(n)
        if (existing) return existing
        if (session.genericTemplatesResolved!.has(n)) return undefined
        return undefined
      }
    }
    return
  }

  const loading = new Set<string>()
  session.typeResolver = (name: string): ProgramType | undefined => {
    const existing = session.typeRegistry.get(name)
    if (existing) return existing
    if (session.genericTemplates.has(name)) return undefined
    if (loading.has(name)) {
      throw new Error(`Circular stdlib dependency: ${[...loading, name].join(' → ')}`)
    }
    const raw = index.get(name)
    if (raw === undefined) return undefined
    loading.add(name)
    const { node } = normalizeProgramFile(raw as { schema?: string; [k: string]: unknown })
    const type = loadProgramAsType(node, session)
    loading.delete(name)
    return type
  }

  for (const name of index.keys()) {
    if (!session.typeRegistry.has(name) && !session.genericTemplates.has(name)) {
      session.typeResolver(name)
    }
  }
}
