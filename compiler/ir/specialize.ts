/**
 * specialize.ts — Phase C stratum stub (full impl: Phase C3).
 *
 * Substitutes integer values for `TypeParamDecl` references throughout
 * the program (shapes, defaults, etc.), producing a fresh program per
 * (template, type-args) pair via clone-and-rewrite.
 *
 * C1 stub: pass through when no type-args are supplied. Throw when
 * type-args are present so any accidental use surfaces the missing
 * implementation.
 */

import type { ResolvedProgram, TypeParamDecl } from './nodes.js'

export function specializeProgram(
  prog: ResolvedProgram,
  typeArgs: ReadonlyMap<TypeParamDecl, number>,
): ResolvedProgram {
  if (typeArgs.size > 0) {
    throw new Error('specializeProgram: not yet implemented (Phase C3)')
  }
  return prog
}
