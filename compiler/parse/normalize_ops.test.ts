/**
 * normalize_ops.test.ts — D5 JSON-ingest-boundary normalization.
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import {
  normalizeOpTags, SNAKE_TO_CAMEL_OPS, _resetSnakeWarnedForTests,
} from './normalize_ops.js'

describe('normalizeOpTags', () => {
  beforeEach(() => { _resetSnakeWarnedForTests() })

  test('rewrites top-level decl op', () => {
    const node = { op: 'instance_decl', name: 'a' }
    normalizeOpTags(node)
    expect(node.op).toBe('instanceDecl')
  })

  test('rewrites every snake-case key in the table', () => {
    for (const [snake, camel] of Object.entries(SNAKE_TO_CAMEL_OPS)) {
      _resetSnakeWarnedForTests()
      const node = { op: snake }
      normalizeOpTags(node)
      expect(node.op).toBe(camel)
    }
  })

  test('recurses into arrays and nested objects', () => {
    const node = {
      op: 'program',
      body: {
        op: 'block',
        decls: [
          { op: 'instance_decl', name: 'osc' },
          { op: 'reg_decl', name: 'r', init: { op: 'bit_and', args: [1, 2] } },
        ],
        assigns: [{ op: 'output_assign', name: 'out', expr: 0 }],
      },
    }
    normalizeOpTags(node)
    expect(node.body.decls[0].op).toBe('instanceDecl')
    expect(node.body.decls[1].op).toBe('regDecl')
    // @ts-expect-error narrowing through any
    expect(node.body.decls[1].init.op).toBe('bitAnd')
    expect(node.body.assigns[0].op).toBe('outputAssign')
  })

  test('leaves camelCase ops untouched', () => {
    const node = { op: 'instanceDecl', name: 'a', body: { op: 'block' } }
    const before = JSON.stringify(node)
    normalizeOpTags(node)
    expect(JSON.stringify(node)).toBe(before)
  })

  test('idempotent — second run is a no-op', () => {
    const node: { op: string } = { op: 'instance_decl' }
    normalizeOpTags(node)
    const after = node.op
    normalizeOpTags(node)
    expect(node.op).toBe(after)
  })

  test('non-op fields with snake_case strings are preserved', () => {
    const node = { op: 'instanceDecl', program: 'instance_decl' }  // value, not key
    normalizeOpTags(node)
    expect(node.program).toBe('instance_decl')
  })
})
