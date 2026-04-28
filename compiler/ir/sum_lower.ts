/**
 * sum_lower.ts — Phase C stratum stub (full impl: Phase C4).
 *
 * Decomposes sum-typed delays into per-variant scalar slots and lowers
 * `match` / `tag` expressions to chained selects.
 *
 * C1 stub: pass through when the program declares no sum types and
 * uses no `match` / `tag` expressions. Throw otherwise so any
 * accidental use surfaces the missing implementation.
 */

import type {
  ResolvedProgram, ResolvedExpr, ResolvedExprOpNode,
  BodyDecl, BodyAssign,
} from './nodes.js'

export function sumLower(prog: ResolvedProgram): ResolvedProgram {
  const sumDef = prog.ports.typeDefs.find(td => td.op === 'sumTypeDef')
  if (sumDef) {
    throw new Error('sumLower: not yet implemented (Phase C4) — program declares a sum type')
  }
  if (bodyUsesSumExpr(prog)) {
    throw new Error('sumLower: not yet implemented (Phase C4) — program uses match/tag expressions')
  }
  return prog
}

function bodyUsesSumExpr(prog: ResolvedProgram): boolean {
  for (const decl of prog.body.decls) {
    if (declUsesSumExpr(decl)) return true
  }
  for (const assign of prog.body.assigns) {
    if (assignUsesSumExpr(assign)) return true
  }
  return false
}

function declUsesSumExpr(decl: BodyDecl): boolean {
  switch (decl.op) {
    case 'regDecl':   return exprUsesSumExpr(decl.init)
    case 'delayDecl': return exprUsesSumExpr(decl.init) || exprUsesSumExpr(decl.update)
    case 'paramDecl': return false
    case 'instanceDecl':
      return decl.inputs.some(i => exprUsesSumExpr(i.value))
    case 'programDecl':
      // Nested programs are independent units; their sum-usage is
      // their own concern. The outer program's sumLower stub only
      // looks at the outer body.
      return false
  }
}

function assignUsesSumExpr(assign: BodyAssign): boolean {
  return exprUsesSumExpr(assign.expr)
}

function exprUsesSumExpr(expr: ResolvedExpr): boolean {
  if (typeof expr === 'number' || typeof expr === 'boolean') return false
  if (Array.isArray(expr)) return expr.some(exprUsesSumExpr)
  return opNodeUsesSumExpr(expr)
}

function opNodeUsesSumExpr(node: ResolvedExprOpNode): boolean {
  switch (node.op) {
    case 'tag':
    case 'match':
      return true
    case 'inputRef': case 'regRef': case 'delayRef': case 'paramRef':
    case 'typeParamRef': case 'bindingRef': case 'nestedOut':
    case 'sampleRate': case 'sampleIndex':
      return false
    case 'fold': case 'scan':
      return exprUsesSumExpr(node.over) || exprUsesSumExpr(node.init) || exprUsesSumExpr(node.body)
    case 'generate':
      return exprUsesSumExpr(node.count) || exprUsesSumExpr(node.body)
    case 'iterate': case 'chain':
      return exprUsesSumExpr(node.count) || exprUsesSumExpr(node.init) || exprUsesSumExpr(node.body)
    case 'map2':
      return exprUsesSumExpr(node.over) || exprUsesSumExpr(node.body)
    case 'zipWith':
      return exprUsesSumExpr(node.a) || exprUsesSumExpr(node.b) || exprUsesSumExpr(node.body)
    case 'let':
      return node.binders.some(b => exprUsesSumExpr(b.value)) || exprUsesSumExpr(node.in)
    // Binary / unary / clamp / select / index / arraySet — uniform
    // `args` shape.
    case 'add': case 'sub': case 'mul': case 'div': case 'mod':
    case 'lt': case 'lte': case 'gt': case 'gte': case 'eq': case 'neq':
    case 'and': case 'or':
    case 'bitAnd': case 'bitOr': case 'bitXor': case 'lshift': case 'rshift':
    case 'pow': case 'floorDiv': case 'ldexp':
    case 'neg': case 'not': case 'bitNot':
    case 'sqrt': case 'abs': case 'floor': case 'ceil': case 'round':
    case 'floatExponent': case 'toInt': case 'toBool': case 'toFloat':
    case 'clamp': case 'select': case 'index':
    case 'arraySet':
      return node.args.some(exprUsesSumExpr)
    case 'zeros':
      return exprUsesSumExpr(node.count)
  }
}
