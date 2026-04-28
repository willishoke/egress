/**
 * inline_instances.ts — Phase C stratum stub (full impl: Phase C5).
 *
 * Splices each `InstanceDecl`'s body into its parent: rewrites
 * `InputRef`s, replaces `NestedOut` with the resolved output
 * expression, lifts nested register/delay decls into the parent's
 * body. After the full implementation, no `InstanceDecl` and no
 * `NestedOut` remain.
 *
 * C1 stub: pass through when the body contains no `InstanceDecl`.
 * Throw otherwise so any accidental use surfaces the missing
 * implementation.
 */

import type { ResolvedProgram } from './nodes.js'

export function inlineInstances(prog: ResolvedProgram): ResolvedProgram {
  for (const decl of prog.body.decls) {
    if (decl.op === 'instanceDecl') {
      throw new Error(
        `inlineInstances: not yet implemented (Phase C5) — program contains instance '${decl.name}'`,
      )
    }
  }
  return prog
}
