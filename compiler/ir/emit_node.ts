/**
 * emit_node.ts — `EmitExprNode`, the post-strata emit-time tree shape.
 *
 * `resolvedToSlotted` (compiler/ir/lower_to_exprnode.ts) produces this
 * shape from a `ResolvedExpr` — slot-indexed refs, post-arrayLower
 * combinator residue, ready for `emit_numeric.ts` to walk.
 *
 * Phase D D4 split: this type is internal to the emit boundary; the
 * MCP wire-format `ExprNode` (compiler/expr.ts) is a strict union over
 * the ~25 ops MCP clients send. The two share the bag-of-fields object
 * shape but live at different semantic layers — keeping them as
 * distinct types makes the IR boundary load-bearing for the type
 * checker.
 */

/** Post-strata emit-time tree. Bag-of-fields by design: `emit_numeric`'s
 *  switch dispatches on `obj.op` strings and reaches into shape-specific
 *  fields (`args`, `id`, `slot`, `node_id`, `output_id`, `name`, `items`,
 *  `shape`, `count`, `over`, `init`, `body`, `acc_var`, `elem_var`,
 *  `var`, `bind`, `in`, `arms`, `gate_expr`, `on_skip`, `payload`,
 *  `type`, `variant`, `rows`, `x_var`, `y_var`).
 *
 *  Survives until `emit_numeric` is rewritten to walk `ResolvedExpr`
 *  directly (PHASE_D_PLAN §2.1; future PR). */
export type EmitExprNode =
  | number
  | boolean
  | EmitExprNode[]
  | { op: string; [key: string]: unknown }
