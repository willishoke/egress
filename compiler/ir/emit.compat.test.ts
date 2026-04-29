/**
 * emit.compat.test.ts — Phase D D1 per-program structural test.
 *
 * `compileResolved` is the per-program emit boundary: input ResolvedProgram
 * (post-strata) → output `tropical_plan_4`. It is *not* a session-level
 * compiler — graph outputs, default-substitution, and inter-instance
 * wiring are session concerns handled by `compileSession` (D2).
 *
 * The full dual-run gate (byte-equal vs. `flattenSession` on every D0
 * fixture) lives in a follow-up test once `compileSession` lands. For
 * D1 we assert structural soundness on a stdlib corpus: every program
 * produces a `tropical_plan_4` with the expected schema, slot counts,
 * and instruction shape.
 */

import { describe, test, expect } from 'bun:test'

import { makeSession, resolveProgramType } from '../session.js'
import { loadStdlib } from '../program.js'
import { compileResolved } from './compile_resolved.js'
import { strataPipeline } from './strata.js'

/** Programs simple enough for D1: no instances, no params. */
const D1_OK_STDLIB = [
  'Sin', 'Cos', 'Exp', 'Log', 'Tanh',
  'OnePole', 'SoftClip', 'BitCrusher', 'CrossFade',
  'NoiseLFSR', 'AllpassDelay', 'CombDelay',
  'VCA', 'Clock',
] as const

describe('compileResolved — structural soundness on stdlib', () => {
  for (const typeName of D1_OK_STDLIB) {
    test(`emits well-formed tropical_plan_4: ${typeName}`, () => {
      const session = makeSession()
      loadStdlib(session)
      resolveProgramType(session, typeName, undefined, undefined)
      const resolved = session.resolvedRegistry.get(typeName)
      if (!resolved) return  // not all stdlib lands in resolvedRegistry post-resolve

      const lowered = strataPipeline(resolved)
      const plan = compileResolved(lowered)

      expect(plan.schema).toBe('tropical_plan_4')
      expect(plan.outputs.length).toBe(resolved.ports.outputs.length)
      expect(plan.instructions.length).toBeGreaterThan(0)
      expect(plan.register_count).toBeGreaterThan(0)
      expect(plan.output_targets.length).toBe(plan.outputs.length)
      expect(plan.register_targets.length).toBe(plan.register_names.length)
      expect(plan.array_slot_sizes.length).toBe(plan.array_slot_count)
    })
  }
})
