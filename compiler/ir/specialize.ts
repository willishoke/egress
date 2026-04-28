/**
 * specialize.ts — Phase C3: clone-and-rewrite specializer on resolved IR.
 *
 * Substitutes integer values for `TypeParamDecl` references throughout
 * a program (shape dims, expression-position `TypeParamRef` nodes),
 * producing a fresh `ResolvedProgram` per (template, type-args) pair.
 *
 * Algorithm: option-A interleaved clone-with-rewrite via
 * `cloneWithSubst` in `clone.ts`. The cloner:
 *   - rewrites `TypeParamRef.decl ∈ subst` → numeric literal (in expr position)
 *   - rewrites `ShapeDim` that's a `TypeParamDecl ∈ subst` → integer
 *   - drops the root program's `typeParams` list
 *   - clones every reachable decl freshly per call, so `Delay<N=8>`
 *     and `Delay<N=44100>` produce structurally distinct `RegDecl`s
 *     with shapes `[8]` and `[44100]`
 *   - shares sum/struct/alias type defs (preserves variant identity
 *     for match arms; required by Phase C4 sum_lower)
 *
 * Purity: this function does not consult or modify any cache. The
 * cache lives in the loader (Phase C7) — the call site is responsible
 * for memoizing on the (template, args) pair.
 *
 * `InstanceDecl.typeArgs[i].value` is currently typed as `number`
 * (parser only admits integer literals), so no substitution is needed
 * there. The cloner passes the value through unchanged.
 */

import type { ResolvedProgram, TypeParamDecl } from './nodes.js'
import { cloneWithSubst } from './clone.js'

export function specializeProgram(
  prog: ResolvedProgram,
  typeArgs: ReadonlyMap<TypeParamDecl, number>,
): ResolvedProgram {
  const subst = buildSubst(prog, typeArgs)
  // Short-circuit: a non-generic program with no args to substitute
  // is already "specialized." Return the input by identity. This keeps
  // the stratum a no-op for the common stdlib case where every program
  // is non-generic, which the strata orchestrator relies on.
  if (subst.size === 0) return prog
  return cloneWithSubst(prog, subst)
}

/**
 * Validate `typeArgs` against `prog.typeParams` and fill in defaults
 * for any param the caller didn't supply. Throws a clear error for:
 *   - extra args (a key in `typeArgs` that's not a declared type-param)
 *   - missing required args (a declared type-param with no `default`
 *     and no entry in `typeArgs`)
 *   - non-integer values
 */
function buildSubst(
  prog: ResolvedProgram,
  typeArgs: ReadonlyMap<TypeParamDecl, number>,
): ReadonlyMap<TypeParamDecl, number> {
  const declared = new Set(prog.typeParams)
  // Extra-arg check: every key in typeArgs must be a declared type-param.
  for (const param of typeArgs.keys()) {
    if (!declared.has(param)) {
      throw new Error(
        `specializeProgram('${prog.name}'): type-arg '${param.name}' is not a declared ` +
        `type-param (have: ${declaredNames(prog) || '(none)'})`,
      )
    }
  }
  // Build the resolved subst, filling defaults; missing-required-throw.
  const subst = new Map<TypeParamDecl, number>()
  for (const param of prog.typeParams) {
    if (typeArgs.has(param)) {
      const v = typeArgs.get(param) as number
      if (!Number.isInteger(v)) {
        throw new Error(
          `specializeProgram('${prog.name}'): type-arg '${param.name}' must be an integer, got ${v}`,
        )
      }
      subst.set(param, v)
    } else if (param.default !== undefined) {
      subst.set(param, param.default)
    } else {
      throw new Error(
        `specializeProgram('${prog.name}'): missing required type-arg '${param.name}' (no default)`,
      )
    }
  }
  return subst
}

function declaredNames(prog: ResolvedProgram): string {
  return prog.typeParams.map(p => p.name).join(', ')
}
