/**
 * feature_flags.ts — runtime opt-ins for compiler pipeline variants.
 *
 * Phase C7 introduces `useNewPipeline()` to gate the strata-based runtime
 * path. When the env var `TROPICAL_USE_NEW_PIPELINE === '1'`, callers
 * route through `parse → elaborate → strataPipeline → loadProgramDefFromResolved`
 * before reaching `flatten.ts`. Default-off; C8 will flip the default.
 *
 * Centralised here so we don't sprinkle env-var lookups across the
 * codebase. Tests that need to exercise the new pipeline directly can
 * call `loadProgramDefFromResolved` and friends without involving the
 * flag at all.
 */

export function useNewPipeline(): boolean {
  return process.env.TROPICAL_USE_NEW_PIPELINE === '1'
}
