/**
 * strata.test.ts — scaffolding correctness for the C1 strata stubs.
 *
 * Each stub passes a "trivial" program through unchanged (the program
 * doesn't exercise the feature the stub eventually lowers) and throws
 * on programs that require its full implementation. These tests
 * sanity-check both branches.
 */

import { describe, test, expect } from 'bun:test'
import { parseProgram } from '../parse/declarations.js'
import { elaborate } from './elaborator.js'
import { specializeProgram } from './specialize.js'
import { sumLower } from './sum_lower.js'
import { traceCycles } from './trace_cycles.js'
import { inlineInstances } from './inline_instances.js'
import { arrayLower } from './array_lower.js'
import { strataPipeline } from './strata.js'
import type { ResolvedProgram, TypeParamDecl } from './nodes.js'

function elab(src: string): ResolvedProgram {
  return elaborate(parseProgram(src))
}

const TRIVIAL = 'program X(a: signal) -> (out: signal) { reg s: float = 0  out = s + a  next s = a }'

describe('strata — pass-through on trivial programs', () => {
  test('specialize: empty type-args returns input unchanged', () => {
    const p = elab(TRIVIAL)
    expect(specializeProgram(p, new Map())).toBe(p)
  })

  test('sumLower: no sums returns input unchanged', () => {
    const p = elab(TRIVIAL)
    expect(sumLower(p)).toBe(p)
  })

  test('traceCycles: stub passes through unchanged', () => {
    const p = elab(TRIVIAL)
    expect(traceCycles(p)).toBe(p)
  })

  test('inlineInstances: no instances returns input unchanged', () => {
    const p = elab(TRIVIAL)
    expect(inlineInstances(p)).toBe(p)
  })

  test('arrayLower: no combinators or arrays returns input unchanged', () => {
    const p = elab(TRIVIAL)
    expect(arrayLower(p)).toBe(p)
  })

  test('strataPipeline: trivial program threads through all five strata', () => {
    const p = elab(TRIVIAL)
    expect(strataPipeline(p)).toBe(p)
  })
})

describe('strata — throws on unsupported features', () => {
  test('specialize: type-arg keyed by an undeclared TypeParamDecl throws', () => {
    // C3 implementation: passing an arg whose key is not one of the
    // program's declared type-params is an error (replaces the C1 stub
    // behavior of "any non-empty args throws").
    const p = elab(TRIVIAL)
    const fakeDecl: TypeParamDecl = { op: 'typeParamDecl', name: 'N' }
    const args = new Map<TypeParamDecl, number>([[fakeDecl, 4]])
    expect(() => specializeProgram(p, args)).toThrow(/not a declared type-param/)
  })

  test('sumLower: program with sum type throws', () => {
    const p = elab(`
      program X(t: signal) -> (out: signal) {
        enum S { A, B }
        out = 0
      }
    `)
    expect(() => sumLower(p)).toThrow(/Phase C4/)
  })

  test('arrayLower: program with let combinator throws', () => {
    const p = elab(`
      program X(a: signal) -> (out: signal) {
        out = let { y: a + 1 } in y * 2
      }
    `)
    expect(() => arrayLower(p)).toThrow(/Phase C6/)
  })

  test('arrayLower: program with array literal throws', () => {
    const p = elab(`
      program X() -> (out: signal) {
        out = fold([1.0, 2.0, 3.0], 0, (a, c) => a + c)
      }
    `)
    expect(() => arrayLower(p)).toThrow(/Phase C6/)
  })

  test('inlineInstances: program with InstanceDecl throws', () => {
    const p = elab(`
      program X(a: signal) -> (out: signal) {
        program Inner(x: signal) -> (y: signal) { y = x + 1 }
        inst = Inner(x: a)
        out = inst.y
      }
    `)
    expect(() => inlineInstances(p)).toThrow(/Phase C5/)
  })
})
