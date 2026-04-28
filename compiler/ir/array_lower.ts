/**
 * array_lower.ts — Phase C stratum stub (full impl: Phase C6).
 *
 * Combinator unrolling (`fold`/`scan`/`generate`/`iterate`/`chain`/
 * `map2`/`zipWith`/`let`) and array-op lowering. After the full
 * implementation, no combinators and no `BindingRef` remain.
 *
 * C1 stub: pass through when the body contains no combinators or
 * array ops. Throw otherwise so any accidental use surfaces the
 * missing implementation.
 *
 * Note: array-ops (zeros / reshape / matmul / arrayPack / etc.) are
 * not in the resolved-IR `ResolvedExprOpNode` union today — they
 * appear post-loadProgramDef as legacy `ExprNode` ops, lowered by
 * `compiler/lower_arrays.ts`. Once Phase C6 lifts them into the
 * resolved IR they'll be checked here too. For C1 the relevant
 * detector is the combinator set, plus array-literal expressions
 * (which are `ResolvedExpr[]`).
 */

import type {
  ResolvedProgram, ResolvedExpr, ResolvedExprOpNode,
  BodyDecl, BodyAssign,
} from './nodes.js'

export function arrayLower(prog: ResolvedProgram): ResolvedProgram {
  if (bodyUsesArrayOrCombinator(prog)) {
    throw new Error('arrayLower: not yet implemented (Phase C6) — program uses combinators or array literals')
  }
  return prog
}

function bodyUsesArrayOrCombinator(prog: ResolvedProgram): boolean {
  for (const decl of prog.body.decls) {
    if (declUsesArrayOrCombinator(decl)) return true
  }
  for (const assign of prog.body.assigns) {
    if (exprUsesArrayOrCombinator(assign.expr)) return true
  }
  return false
}

function declUsesArrayOrCombinator(decl: BodyDecl): boolean {
  switch (decl.op) {
    case 'regDecl':   return exprUsesArrayOrCombinator(decl.init)
    case 'delayDecl': return exprUsesArrayOrCombinator(decl.init) || exprUsesArrayOrCombinator(decl.update)
    case 'paramDecl': return false
    case 'instanceDecl':
      return decl.inputs.some(i => exprUsesArrayOrCombinator(i.value))
    case 'programDecl':
      // Nested programs are independent units (see sum_lower.ts).
      return false
  }
}

function exprUsesArrayOrCombinator(expr: ResolvedExpr): boolean {
  if (typeof expr === 'number' || typeof expr === 'boolean') return false
  if (Array.isArray(expr)) return true   // an array literal — needs lowering
  return opNodeUsesArrayOrCombinator(expr)
}

function opNodeUsesArrayOrCombinator(node: ResolvedExprOpNode): boolean {
  switch (node.op) {
    case 'fold': case 'scan': case 'generate': case 'iterate':
    case 'chain': case 'map2': case 'zipWith': case 'let':
      return true
    case 'inputRef': case 'regRef': case 'delayRef': case 'paramRef':
    case 'typeParamRef': case 'bindingRef': case 'nestedOut':
    case 'sampleRate': case 'sampleIndex':
      return false
    case 'tag':
      return node.payload.some(p => exprUsesArrayOrCombinator(p.value))
    case 'match':
      return exprUsesArrayOrCombinator(node.scrutinee)
        || node.arms.some(a => exprUsesArrayOrCombinator(a.body))
    // Binary / unary / clamp / select / index — uniform `args` shape.
    case 'add': case 'sub': case 'mul': case 'div': case 'mod':
    case 'lt': case 'lte': case 'gt': case 'gte': case 'eq': case 'neq':
    case 'and': case 'or':
    case 'bitAnd': case 'bitOr': case 'bitXor': case 'lshift': case 'rshift':
    case 'neg': case 'not': case 'bitNot':
    case 'sqrt': case 'abs': case 'floor': case 'ceil': case 'round':
    case 'floatExponent': case 'toInt': case 'toBool': case 'toFloat':
    case 'clamp': case 'select': case 'index':
      return node.args.some(exprUsesArrayOrCombinator)
  }
}
