/**
 * strata.ts — Phase C runtime IR pipeline orchestrator.
 *
 * Composes the strata passes in order:
 *
 *   specialize → sumLower → traceCycles → inlineInstances → arrayLower
 *
 * After arrayLower, the result is consumed by loadProgramDef (Phase C2)
 * to produce a slot-indexed ProgramDef, which emit_numeric.ts compiles
 * to tropical_plan_4. Phase C1 leaves loadProgramDef unwired; this
 * orchestrator is reachable only from tests until Phase C7's flag-
 * gated wiring lands.
 *
 * Each stratum stub passes its input through unchanged when the
 * relevant feature is absent, and throws `not yet implemented` when
 * the feature is present. C1 establishes the pipeline shape; later
 * sub-phases (C3–C6) fill in real implementations.
 */

import type { ResolvedProgram, TypeParamDecl } from './nodes.js'
import type { SessionState } from '../session.js'
import type { ProgramType } from '../program_types.js'
import { specializeProgram } from './specialize.js'
import { sumLower } from './sum_lower.js'
import { traceCycles } from './trace_cycles.js'
import { inlineInstances } from './inline_instances.js'
import { arrayLower } from './array_lower.js'
import { loadProgramDefFromResolved } from './load.js'

export function strataPipeline(
  prog: ResolvedProgram,
  typeArgs: ReadonlyMap<TypeParamDecl, number> = new Map(),
): ResolvedProgram {
  const specialized = specializeProgram(prog, typeArgs)
  const summed = sumLower(specialized)
  const cyclic = traceCycles(summed)
  const inlined = inlineInstances(cyclic)
  return arrayLower(inlined)
}

/** Compile a `ResolvedProgram` end-to-end through the strata pipeline,
 *  yielding a `ProgramType` (wrapping a slot-indexed `ProgramDef`) that the
 *  legacy `flatten.ts` consumes unchanged. The new pipeline produces a flat
 *  `ProgramDef` (no `nestedCalls`) — `flatten.ts` skips its nested-call
 *  branch when `nestedCalls.length === 0`, so no flatten changes are
 *  required. */
export function compileResolvedToProgramDef(
  prog: ResolvedProgram,
  typeArgs: ReadonlyMap<TypeParamDecl, number>,
  session: Pick<
    SessionState,
    'typeRegistry' | 'instanceRegistry' | 'paramRegistry' | 'triggerRegistry'
    | 'specializationCache' | 'genericTemplatesResolved'
  > & Partial<Pick<SessionState, 'typeAliasRegistry' | 'typeResolver'>>,
): ProgramType {
  const lowered = strataPipeline(prog, typeArgs)
  return loadProgramDefFromResolved(lowered, session)
}
