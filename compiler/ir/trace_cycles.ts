/**
 * trace_cycles.ts — Phase C stratum stub (full impl: Phase C4).
 *
 * Tarjan SCC over the inter-instance dep graph; insert a synthetic
 * `DelayDecl` on the chosen back-edge of each cycle. Output is a
 * fresh `ResolvedProgram`.
 *
 * C1 stub: pass through unchanged. Programs with cycles fail
 * downstream anyway in the absence of a real implementation, so a
 * pass-through here is the right pre-implementation behavior.
 */

import type { ResolvedProgram } from './nodes.js'

export function traceCycles(prog: ResolvedProgram): ResolvedProgram {
  return prog
}
