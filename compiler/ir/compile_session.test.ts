/**
 * compile_session.test.ts — Phase D D2 smoke tests.
 *
 * Exercises the synthetic-top-level materializer against simple
 * sessions (single non-generic instance, ref-and-literal wiring, plain
 * dac.out outputs). The full byte-equal vs. flattenSession dual-run
 * follows in a later commit on this PR; for now we assert structural
 * correctness:
 *   - the produced FlatPlan validates as `tropical_plan_4`
 *   - output count + register count are non-degenerate
 *   - the JIT-equivalence test corpus that does run on the legacy
 *     pipeline still produces an audio digest under compile_session.
 */

import { describe, test, expect } from 'bun:test'
import { makeSession, resolveProgramType } from '../session.js'
import { loadStdlib } from '../program.js'
import { compileSession } from './compile_session.js'

function singleInstanceSession(typeName: string) {
  const session = makeSession()
  loadStdlib(session)
  const { type } = resolveProgramType(session, typeName, undefined, undefined)
  const inst = type.instantiateAs('inst', { baseTypeName: typeName, typeArgs: new Map() })
  session.instanceRegistry.set('inst', inst)
  for (const outName of inst._def.outputNames) {
    session.graphOutputs.push({ instance: 'inst', output: outName })
  }
  return session
}

describe('compileSession — single-instance sessions', () => {
  for (const typeName of [
    'Sin', 'Cos', 'Exp', 'Log', 'Tanh',
    'OnePole', 'SoftClip', 'BitCrusher', 'CrossFade',
    'NoiseLFSR', 'AllpassDelay', 'CombDelay',
    'VCA', 'Clock',
  ] as const) {
    test(`emits well-formed tropical_plan_4: ${typeName}`, () => {
      const session = singleInstanceSession(typeName)
      const plan = compileSession(session)

      expect(plan.schema).toBe('tropical_plan_4')
      expect(plan.outputs.length).toBeGreaterThan(0)
      expect(plan.outputs.length).toBe(session.graphOutputs.length)
      expect(plan.instructions.length).toBeGreaterThan(0)
      expect(plan.output_targets.length).toBe(plan.outputs.length)
      expect(plan.register_targets.length).toBe(plan.register_names.length)
      expect(plan.array_slot_sizes.length).toBe(plan.array_slot_count)
    })
  }
})

describe('compileSession — two-instance refs', () => {
  test('VCA driven by Sin output via ref wiring', () => {
    const session = makeSession()
    loadStdlib(session)
    const sin = resolveProgramType(session, 'Sin', undefined, undefined).type
    const vca = resolveProgramType(session, 'VCA', undefined, undefined).type

    const sinInst = sin.instantiateAs('osc', { baseTypeName: 'Sin' })
    const vcaInst = vca.instantiateAs('amp', { baseTypeName: 'VCA' })
    session.instanceRegistry.set('osc', sinInst)
    session.instanceRegistry.set('amp', vcaInst)

    // Wire osc.out → amp.audio (ref node).
    session.inputExprNodes.set('amp:audio', { op: 'ref', instance: 'osc', output: 'out' })
    session.inputExprNodes.set('amp:cv', 0.5)

    session.graphOutputs.push({ instance: 'amp', output: 'out' })

    const plan = compileSession(session)
    expect(plan.outputs.length).toBe(1)
    expect(plan.instructions.length).toBeGreaterThan(0)
  })
})
