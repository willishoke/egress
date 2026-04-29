/**
 * normalize_ops.ts — JSON-ingest-boundary normalization of snake_case
 * decl/assign op tags to camelCase.
 *
 * Pre-Phase-A patches and any third-party JSON that predates the
 * snake-to-camel `op` rename use snake_case tags (`instance_decl`,
 * `output_assign`, etc.). Modern code consistently uses camelCase. This
 * pass is the single coercion point: applied once at the JSON ingest
 * boundary (`loadJSON`, `loadProgramAsType`, `mergeProgramIntoSession`),
 * the rest of the pipeline only sees camelCase.
 *
 * Behavior: deep-walks the input tree, mutating in place. Any `op` field
 * whose value matches a known snake_case key is rewritten. Emits a
 * one-time per-session deprecation warning on first hit.
 *
 * Removal target: documented as deprecated; specific timeline TBD post
 * the wider Phase D cutover. Removing this normalization breaks any
 * pre-Phase-A patch that hasn't been re-saved through
 * `saveProgramFromSession` (which emits camelCase).
 */

/** Decl/assign and expression op tags that pre-Phase-A used in snake_case.
 *  Decl/assign tags (`instance_decl`, `output_assign`, ...) were the bulk
 *  of the rename; a handful of expression-level tags (`bit_and`,
 *  `nested_out`, `str_concat`, `generate_decls`) also slipped through. */
export const SNAKE_TO_CAMEL_OPS: Readonly<Record<string, string>> = {
  // Decls + assigns
  reg_decl:        'regDecl',
  delay_decl:      'delayDecl',
  param_decl:      'paramDecl',
  instance_decl:   'instanceDecl',
  program_decl:    'programDecl',
  output_assign:   'outputAssign',
  next_update:     'nextUpdate',
  // Expression-level
  bit_and:         'bitAnd',
  bit_or:          'bitOr',
  bit_xor:         'bitXor',
  bit_not:         'bitNot',
  nested_out:      'nestedOut',
  str_concat:      'strConcat',
  generate_decls:  'generateDecls',
  float_exponent:  'floatExponent',
  sample_rate:     'sampleRate',
  sample_index:    'sampleIndex',
  param_expr:      'paramExpr',
  trigger_param_expr: 'triggerParamExpr',
  array_pack:      'arrayPack',
  array_set:       'arraySet',
  array_literal:   'arrayLiteral',
  broadcast_to:    'broadcastTo',
  floor_div:       'floorDiv',
  zip_with:        'zipWith',
}

let _warned = false

/** Reset the one-time warning latch. Test-only. */
export function _resetSnakeWarnedForTests(): void { _warned = false }

/** Deep-walk `node`, rewriting any `op: <snake>` field to `op: <camel>`.
 *  Mutates and returns the input. */
export function normalizeOpTags<T>(node: T): T {
  walk(node)
  return node
}

function walk(node: unknown): void {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) walk(item)
    return
  }
  const obj = node as Record<string, unknown>
  const op = obj.op
  if (typeof op === 'string' && op in SNAKE_TO_CAMEL_OPS) {
    if (!_warned) {
      console.warn(
        `tropical: snake_case op tag '${op}' is deprecated; use '${SNAKE_TO_CAMEL_OPS[op]}'. ` +
        `Re-save the file through saveProgramFromSession to migrate. (Warned once per session.)`,
      )
      _warned = true
    }
    obj.op = SNAKE_TO_CAMEL_OPS[op]
  }
  for (const v of Object.values(obj)) walk(v)
}
