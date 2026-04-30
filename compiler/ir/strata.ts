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
import { ProgramType } from '../program_types.js'
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

/** Run the full strata pipeline + wrap the post-strata `ResolvedProgram`
 *  in a `ProgramType`. The wrapper exposes port/register/default metadata
 *  via thin getters over the resolved IR — no slot-indexed flattening
 *  upfront. */
export function programTypeFromResolved(
  prog: ResolvedProgram,
  typeArgs: ReadonlyMap<TypeParamDecl, number>,
): ProgramType {
  return new ProgramType(strataPipeline(prog, typeArgs))
}
