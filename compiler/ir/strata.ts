/**
 * strata.ts — runtime IR pipeline orchestrator.
 *
 * Composes the strata passes in order:
 *
 *   specialize → sumLower → traceCycles → inlineInstances → arrayLower
 *
 * After arrayLower, the result is a post-strata `ResolvedProgram`
 * consumed by either `compileResolved` (the JIT path) or
 * `interpret_resolved.ts` (the independent oracle).
 */

import type { ResolvedProgram, TypeParamDecl } from './nodes.js'
import type { ProgramType } from '../program_types.js'
import { specializeProgram } from './specialize.js'
import { sumLower } from './sum_lower.js'
import { traceCycles } from './trace_cycles.js'
import { inlineInstances } from './inline_instances.js'
import { arrayLower } from './array_lower.js'
import { resolvedToProgramType } from './program_type_builder.js'

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

/** Run the full strata pipeline + build a thin ProgramType wrapping the
 *  post-strata `ResolvedProgram`. The returned ProgramType carries
 *  metadata only (port names, port types, register names, default-input
 *  expressions); the runtime IR lives in `_resolved`. */
export function compileResolvedToProgramDef(
  prog: ResolvedProgram,
  typeArgs: ReadonlyMap<TypeParamDecl, number>,
): ProgramType {
  const lowered = strataPipeline(prog, typeArgs)
  return resolvedToProgramType(lowered)
}
