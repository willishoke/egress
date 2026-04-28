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
import { specializeProgram } from './specialize.js'
import { sumLower } from './sum_lower.js'
import { traceCycles } from './trace_cycles.js'
import { inlineInstances } from './inline_instances.js'
import { arrayLower } from './array_lower.js'

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
