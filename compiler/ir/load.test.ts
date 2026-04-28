/**
 * compiler/ir/load.test.ts — focused unit tests for `loadProgramDefFromResolved`.
 *
 * The dual-run byte-equality assertion against the legacy pipeline lives
 * in `compiler/phase_c_equiv.test.ts`; this file exercises the slot
 * allocation and reference-lowering invariants directly with hand-built
 * `ResolvedProgram` fixtures. End-to-end tests against the legacy
 * pipeline cover the structural correspondence; these tests cover the
 * slot bookkeeping in isolation.
 */

import { describe, test, expect } from 'bun:test'
import { parseProgram } from '../parse/declarations.js'
import { elaborate } from './elaborator.js'
import { loadProgramDefFromResolved, resolvedToSlotted } from './load.js'
import type { ResolvedProgram, RegDecl, InputDecl, DelayDecl, InstanceDecl, OutputDecl } from './nodes.js'
import { Param, Trigger } from '../runtime/param.js'
import type { ProgramType } from '../program_types.js'

function elab(src: string): ResolvedProgram {
  return elaborate(parseProgram(src))
}

function emptySession() {
  return {
    typeRegistry:        new Map<string, ProgramType>(),
    instanceRegistry:    new Map(),
    paramRegistry:       new Map<string, Param>(),
    triggerRegistry:     new Map<string, Trigger>(),
    specializationCache: new Map(),
    genericTemplates:    new Map(),
  }
}

describe('loadProgramDefFromResolved — basic shape', () => {
  test('empty program has empty slot lists', () => {
    const prog = elab('program X() -> (out: float) { out = 0 }')
    const t = loadProgramDefFromResolved(prog, emptySession())
    expect(t._def.typeName).toBe('X')
    expect(t._def.inputNames).toEqual([])
    expect(t._def.outputNames).toEqual(['out'])
    expect(t._def.registerNames).toEqual([])
    expect(t._def.delayInitValues).toEqual([])
    expect(t._def.nestedCalls).toEqual([])
    expect(t._def.outputExprNodes).toEqual([0])
  })

  test('input + output appear in declaration order', () => {
    const prog = elab('program X(a: float, b: float) -> (sum: float, diff: float) { sum = a + b  diff = a - b }')
    const t = loadProgramDefFromResolved(prog, emptySession())
    expect(t._def.inputNames).toEqual(['a', 'b'])
    expect(t._def.outputNames).toEqual(['sum', 'diff'])
    expect(t._def.outputExprNodes[0]).toEqual({ op: 'add', args: [{ op: 'input', id: 0 }, { op: 'input', id: 1 }] })
    expect(t._def.outputExprNodes[1]).toEqual({ op: 'sub', args: [{ op: 'input', id: 0 }, { op: 'input', id: 1 }] })
  })

  test('reg slot allocation matches declaration order', () => {
    const prog = elab(`
      program X(a: float) -> (out: float) {
        reg s1 = 0
        reg s2 = 0
        out = s1 + s2
        next s1 = a
        next s2 = s1
      }
    `)
    const t = loadProgramDefFromResolved(prog, emptySession())
    expect(t._def.registerNames).toEqual(['s1', 's2'])
    expect(t._def.outputExprNodes[0]).toEqual({
      op: 'add',
      args: [{ op: 'reg', id: 0 }, { op: 'reg', id: 1 }],
    })
    // Register update for s1 references input(0); for s2, reg(0).
    expect(t._def.registerExprNodes).toEqual([
      { op: 'input', id: 0 },
      { op: 'reg', id: 0 },
    ])
  })

  test('register init values pass through as bare literals', () => {
    const prog = elab(`
      program X() -> (out: float) {
        reg s = 7
        out = s
        next s = s
      }
    `)
    const t = loadProgramDefFromResolved(prog, emptySession())
    expect(t._def.registerInitValues).toEqual([7])
  })
})

describe('loadProgramDefFromResolved — reference identity', () => {
  test('two RegRefs to the same RegDecl resolve to the same slot id', () => {
    const prog = elab(`
      program X(a: float) -> (out: float) {
        reg s = 0
        out = s + s
        next s = a
      }
    `)
    const t = loadProgramDefFromResolved(prog, emptySession())
    const out = t._def.outputExprNodes[0] as { op: 'add'; args: Array<{ op: string; id?: number }> }
    expect(out.op).toBe('add')
    expect(out.args[0]).toEqual({ op: 'reg', id: 0 })
    expect(out.args[1]).toEqual({ op: 'reg', id: 0 })
  })

  test('delays slot-index in declaration order', () => {
    const prog = elab(`
      program X(a: float) -> (out: float) {
        delay d1 = a + 1 init 0
        delay d2 = a + 2 init 0
        out = d1 + d2
      }
    `)
    const t = loadProgramDefFromResolved(prog, emptySession())
    // delayUpdateNodes order matches DelayDecl declaration order
    expect(t._def.delayInitValues).toEqual([0, 0])
    expect(t._def.delayUpdateNodes).toHaveLength(2)
    // The output reads delays via delayValue / node_id.
    const out = t._def.outputExprNodes[0] as { op: 'add'; args: Array<{ op: string; node_id?: number }> }
    expect(out.args[0]).toEqual({ op: 'delayValue', node_id: 0 })
    expect(out.args[1]).toEqual({ op: 'delayValue', node_id: 1 })
  })
})

describe('loadProgramDefFromResolved — bounds', () => {
  test('explicit bounds on InputDecl/OutputDecl carry through', () => {
    // The parser surface doesn't expose bounds today, so we hand-build
    // the resolved IR to exercise the bounds path directly.
    const inDecl: InputDecl  = { op: 'inputDecl',  name: 'a',   type: { kind: 'scalar', scalar: 'float' }, bounds: [-1, 1] }
    const outDecl: OutputDecl = { op: 'outputDecl', name: 'out', type: { kind: 'scalar', scalar: 'float' }, bounds: [0, 1] }
    const prog: ResolvedProgram = {
      op: 'program',
      name: 'X',
      typeParams: [],
      ports: { inputs: [inDecl], outputs: [outDecl], typeDefs: [] },
      body: {
        op: 'block',
        decls: [],
        assigns: [{ op: 'outputAssign', target: outDecl, expr: { op: 'inputRef', decl: inDecl } }],
      },
    }
    const t = loadProgramDefFromResolved(prog, emptySession())
    expect(t._def.inputBounds).toEqual([[-1, 1]])
    expect(t._def.outputBounds).toEqual([[0, 1]])
  })

  test('absent bounds are null', () => {
    const prog = elab('program X(a: float) -> (out: float) { out = a }')
    const t = loadProgramDefFromResolved(prog, emptySession())
    expect(t._def.inputBounds).toEqual([null])
    expect(t._def.outputBounds).toEqual([null])
  })
})

describe('resolvedToSlotted — leaf shapes', () => {
  test('numeric and boolean literals pass through', () => {
    const slots = { inputs: new Map(), regs: new Map(), delays: new Map(), instances: new Map() }
    expect(resolvedToSlotted(0, slots)).toBe(0)
    expect(resolvedToSlotted(3.14, slots)).toBe(3.14)
    expect(resolvedToSlotted(true, slots)).toBe(true)
  })

  test('sample_rate / sample_index lower to nullary leaves', () => {
    const slots = { inputs: new Map(), regs: new Map(), delays: new Map(), instances: new Map() }
    expect(resolvedToSlotted({ op: 'sampleRate' }, slots)).toEqual({ op: 'sampleRate' })
    expect(resolvedToSlotted({ op: 'sampleIndex' }, slots)).toEqual({ op: 'sampleIndex' })
  })

  test('inputRef without slot mapping throws', () => {
    const slots = { inputs: new Map<InputDecl, number>(), regs: new Map(), delays: new Map(), instances: new Map() }
    const fakeDecl: InputDecl = { op: 'inputDecl', name: 'a' }
    expect(() => resolvedToSlotted({ op: 'inputRef', decl: fakeDecl }, slots)).toThrow(/missing from slot table/)
  })

  test('regRef resolves via the slot map', () => {
    const decl: RegDecl = { op: 'regDecl', name: 's', init: 0 }
    const slots = {
      inputs: new Map(),
      regs: new Map([[decl, 7]]),
      delays: new Map(),
      instances: new Map(),
    }
    expect(resolvedToSlotted({ op: 'regRef', decl }, slots)).toEqual({ op: 'reg', id: 7 })
  })

  test('delayRef resolves to delayValue node_id', () => {
    const decl: DelayDecl = { op: 'delayDecl', name: 'd', init: 0, update: 0 }
    const slots = {
      inputs: new Map(),
      regs: new Map(),
      delays: new Map([[decl, 3]]),
      instances: new Map(),
    }
    expect(resolvedToSlotted({ op: 'delayRef', decl }, slots)).toEqual({ op: 'delayValue', node_id: 3 })
  })
})

describe('resolvedToSlotted — combinator shapes', () => {
  test('let lowers to legacy bind/in shape', () => {
    const prog = elab(`
      program X(a: float) -> (out: float) {
        out = let { y: a + 1 } in y * 2
      }
    `)
    // The body assigns `out = let { y: a+1 } in y*2`. Walk the resolved
    // form through resolvedToSlotted and verify the legacy shape.
    const slots = { inputs: new Map<InputDecl, number>(), regs: new Map(), delays: new Map(), instances: new Map() }
    const inDecl = prog.ports.inputs[0]
    slots.inputs.set(inDecl, 0)
    const expr = (prog.body.assigns[0] as { expr: import('./nodes.js').ResolvedExpr }).expr
    const out = resolvedToSlotted(expr, slots) as { op: 'let'; bind: Record<string, unknown>; in: unknown }
    expect(out.op).toBe('let')
    expect(out.bind).toEqual({ y: { op: 'add', args: [{ op: 'input', id: 0 }, 1] } })
    expect(out.in).toEqual({ op: 'mul', args: [{ op: 'binding', name: 'y' }, 2] })
  })
})

describe('loadProgramDefFromResolved — instance decls (not yet supported)', () => {
  test('throws for programs containing nested instances (Phase C5 territory)', () => {
    const prog = elab(`
      program X(a: float) -> (out: float) {
        program Inner(x: float) -> (y: float) { y = x + 1 }
        inst = Inner(x: a)
        out = inst.y
      }
    `)
    expect(() => loadProgramDefFromResolved(prog, emptySession())).toThrow(/Phase C5/)
  })
})

describe('loadProgramDefFromResolved — nestedOut (synthetic graph)', () => {
  test('nestedOut lowers to {op:nestedOutput, node_id, output_id}', () => {
    // A synthetic ResolvedProgram with one InstanceDecl and a NestedOut
    // referencing it. We hand-build the nested program so we can pin
    // the output_id deterministically without going through C5.
    const innerOut0: OutputDecl = { op: 'outputDecl', name: 'first' }
    const innerOut1: OutputDecl = { op: 'outputDecl', name: 'second' }
    const innerProg: ResolvedProgram = {
      op: 'program',
      name: 'Inner',
      typeParams: [],
      ports: { inputs: [], outputs: [innerOut0, innerOut1], typeDefs: [] },
      body: { op: 'block', decls: [], assigns: [] },
    }
    const inst: InstanceDecl = {
      op: 'instanceDecl',
      name: 'i0',
      type: innerProg,
      typeArgs: [],
      inputs: [],
    }
    const slots = {
      inputs: new Map(),
      regs: new Map(),
      delays: new Map(),
      instances: new Map([[inst, 5]]),
    }
    expect(resolvedToSlotted({ op: 'nestedOut', instance: inst, output: innerOut0 }, slots))
      .toEqual({ op: 'nestedOutput', node_id: 5, output_id: 0 })
    expect(resolvedToSlotted({ op: 'nestedOut', instance: inst, output: innerOut1 }, slots))
      .toEqual({ op: 'nestedOutput', node_id: 5, output_id: 1 })
  })
})
