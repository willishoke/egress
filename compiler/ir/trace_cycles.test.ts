/**
 * trace_cycles.test.ts — coverage for the Phase C4 cycle-tracer.
 *
 * Properties tested:
 *   1. A program with no instances → identity.
 *   2. Acyclic instance graph → identity.
 *   3. Two-instance cycle → one synthetic `DelayDecl` is added; the
 *      cycle member that is not the break target now reads the
 *      synthetic delay rather than the breaker's NestedOut.
 *   4. Three-instance cycle → SCC detected, single back-edge broken.
 *   5. Stdlib programs are all identity (no inter-instance cycles
 *      pre-inlining).
 */

import { describe, test, expect } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractMarkdown } from '../parse/markdown.js'
import { parseProgram } from '../parse/declarations.js'
import { elaborate, type ExternalProgramResolver } from './elaborator.js'
import { traceCycles } from './trace_cycles.js'
import type {
  ResolvedProgram, BodyDecl, InstanceDecl, DelayDecl,
  ResolvedExpr, NestedOut, DelayRef,
} from './nodes.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const STDLIB_DIR = join(__dirname, '../../stdlib')

function elab(src: string, resolver?: ExternalProgramResolver): ResolvedProgram {
  return elaborate(parseProgram(src), resolver)
}

function instanceDecls(prog: ResolvedProgram): InstanceDecl[] {
  return prog.body.decls.filter((d): d is InstanceDecl => d.op === 'instanceDecl')
}

function delayDecls(prog: ResolvedProgram): DelayDecl[] {
  return prog.body.decls.filter((d): d is DelayDecl => d.op === 'delayDecl')
}

// ─────────────────────────────────────────────────────────────
// 1 + 2: no-op cases
// ─────────────────────────────────────────────────────────────

describe('traceCycles — identity cases', () => {
  test('a program with no instances returns input by identity', () => {
    const p = elab('program X(a: signal) -> (out: signal) { out = a + 1 }')
    expect(traceCycles(p)).toBe(p)
  })

  test('acyclic two-instance graph returns input by identity', () => {
    // a → b: b reads from a's output, a reads only from external input.
    const p = elab(`
      program Top(x: signal) -> (out: signal) {
        program Inner(in_: signal) -> (out_: signal) { out_ = in_ + 1 }
        a = Inner(in_: x)
        b = Inner(in_: a.out_)
        out = b.out_
      }
    `)
    expect(traceCycles(p)).toBe(p)
  })
})

// ─────────────────────────────────────────────────────────────
// 3: two-instance cycle
// ─────────────────────────────────────────────────────────────

describe('traceCycles — two-instance cycle', () => {
  test('inserts a synthetic delay; later member reads it instead of NestedOut', () => {
    // a reads b.out, b reads a.out — a 2-cycle.
    const p = elab(`
      program Top() -> (out: signal) {
        program Inner(in_: signal) -> (out_: signal) { out_ = in_ + 1 }
        a = Inner(in_: b.out_)
        b = Inner(in_: a.out_)
        out = b.out_
      }
    `)
    const beforeDelays = delayDecls(p).length
    const out = traceCycles(p)
    const afterDelays = delayDecls(out)
    expect(afterDelays.length).toBe(beforeDelays + 1)

    // The break target is the first instance in source order = `a`.
    // So `b`'s input wire to `a.out_` was rewritten to a delayRef on
    // the synthetic delay; `a`'s wire stays as a NestedOut to b.out_.
    const insts = instanceDecls(out)
    const a = insts.find(i => i.name === 'a')!
    const b = insts.find(i => i.name === 'b')!

    // a's wire still references b via NestedOut (the surviving edge).
    expect(opsIn(a.inputs[0].value, 'nestedOut').length).toBeGreaterThan(0)
    expect(opsIn(a.inputs[0].value, 'delayRef').length).toBe(0)
    // b's wire was rewritten — no NestedOut, one DelayRef on the
    // synthetic delay.
    expect(opsIn(b.inputs[0].value, 'nestedOut').length).toBe(0)
    expect(opsIn(b.inputs[0].value, 'delayRef').length).toBe(1)

    // The synthetic delay is named `_feedback_a_out_` (instance "a",
    // output port "out_").
    const synthName = `_feedback_a_out_`
    const synth = afterDelays.find(d => d.name === synthName)
    expect(synth).toBeDefined()
    // Its update reads a.out_ (a NestedOut on the breaker).
    expect(opsIn(synth!.update, 'nestedOut').length).toBe(1)
    // And init is zero.
    expect(synth!.init).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────
// 4: three-instance cycle
// ─────────────────────────────────────────────────────────────

describe('traceCycles — three-instance cycle', () => {
  test('a → b → c → a: a single back-edge is broken', () => {
    const p = elab(`
      program Top() -> (out: signal) {
        program Inner(in_: signal) -> (out_: signal) { out_ = in_ + 1 }
        a = Inner(in_: c.out_)
        b = Inner(in_: a.out_)
        c = Inner(in_: b.out_)
        out = c.out_
      }
    `)
    const beforeDelays = delayDecls(p).length
    const out = traceCycles(p)
    const afterDelays = delayDecls(out)
    // Exactly one synthetic delay added (one output port broken on
    // the chosen breaker).
    expect(afterDelays.length).toBe(beforeDelays + 1)
    expect(afterDelays[afterDelays.length - 1].name).toBe('_feedback_a_out_')
  })
})

// ─────────────────────────────────────────────────────────────
// 5: stdlib is acyclic at the instance level
// ─────────────────────────────────────────────────────────────

describe('traceCycles — stdlib corpus', () => {
  test('every stdlib program is identity through traceCycles', () => {
    const fixtures = loadStdlibFixtures()
    const resolved = elaborateStdlib(fixtures)
    let identityCount = 0
    let totalCount = 0
    for (const [, prog] of resolved.entries()) {
      totalCount++
      // For pre-inlining stdlib programs with no inter-instance
      // cycles, traceCycles should be the identity by reference.
      if (traceCycles(prog) === prog) identityCount++
    }
    expect(identityCount).toBe(totalCount)
    expect(totalCount).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function opsIn(expr: ResolvedExpr, target: string): string[] {
  const out: string[] = []
  const walk = (e: ResolvedExpr): void => {
    if (e === null || typeof e !== 'object') return
    if (Array.isArray(e)) { e.forEach(walk); return }
    if (e.op === target) { out.push(e.op); return }
    walkChildren(e, walk)
  }
  walk(expr)
  return out
}

function walkChildren(node: { op: string } & Record<string, unknown>, k: (e: ResolvedExpr) => void): void {
  // Recurse into structured children but NOT into back-pointers like
  // `delayRef.decl` (which would walk into its update expression).
  switch (node.op) {
    case 'inputRef': case 'regRef': case 'delayRef': case 'paramRef':
    case 'typeParamRef': case 'bindingRef': case 'nestedOut':
    case 'sampleRate': case 'sampleIndex':
      return
    default:
      // Generic recursion for op nodes whose children are direct
      // expression fields. Avoid stepping through `decl` references
      // and arm/payload entries' bookkeeping fields.
      for (const [key, v] of Object.entries(node)) {
        if (key === 'op' || key === 'decl' || key === 'instance' || key === 'output') continue
        if (key === 'variant' || key === 'type' || key === 'parent') continue
        if (key === 'iter' || key === 'acc' || key === 'elem' || key === 'x' || key === 'y' || key === 'binder') continue
        if (Array.isArray(v)) v.forEach(child => recurseValue(child, k))
        else recurseValue(v as ResolvedExpr, k)
      }
  }
}

function recurseValue(v: unknown, k: (e: ResolvedExpr) => void): void {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' || typeof v === 'boolean') k(v as ResolvedExpr)
    return
  }
  if (Array.isArray(v)) { v.forEach(c => recurseValue(c, k)); return }
  // Match-arm entry: { variant, binders, body }; just visit body.
  if ('body' in v && !('op' in v)) { recurseValue((v as { body: ResolvedExpr }).body, k); return }
  if ('value' in v && !('op' in v)) { recurseValue((v as { value: ResolvedExpr }).value, k); return }
  if ('op' in v) k(v as ResolvedExpr)
}

interface Fixture { name: string; source: string }
function loadStdlibFixtures(): Fixture[] {
  return readdirSync(STDLIB_DIR)
    .filter(f => f.endsWith('.trop'))
    .sort()
    .map(file => {
      const text = readFileSync(join(STDLIB_DIR, file), 'utf-8')
      const ext = extractMarkdown(text)
      return { name: file.replace(/\.trop$/, ''), source: ext.blocks[0].source }
    })
}

function elaborateStdlib(fixtures: Fixture[]): Map<string, ResolvedProgram> {
  const resolved = new Map<string, ResolvedProgram>()
  const remaining = new Map(fixtures.map(f => [f.name, f]))
  const resolver: ExternalProgramResolver = name => resolved.get(name)
  let progress = true
  while (progress) {
    progress = false
    for (const [name, fx] of remaining) {
      try {
        const r = elaborate(parseProgram(fx.source), resolver)
        resolved.set(name, r)
        remaining.delete(name)
        progress = true
      } catch { /* try again */ }
    }
  }
  return resolved
}
