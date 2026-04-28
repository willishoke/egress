/**
 * feature_flags.ts — runtime opt-ins for compiler pipeline variants.
 *
 * Phase C8 flipped the default: `useNewPipeline()` is now ON unless
 * `TROPICAL_USE_NEW_PIPELINE === '0'` is set explicitly. Callers route
 * through `parse → elaborate → strataPipeline → loadProgramDefFromResolved`
 * before reaching `flatten.ts`. The legacy path remains reachable for
 * comparison and as a parachute until C9 deletes it; setting the env var
 * to `'0'` selects it.
 *
 * Centralised here so we don't sprinkle env-var lookups across the
 * codebase. Tests that need to exercise either pipeline directly can
 * call `loadProgramDefFromResolved` / `loadProgramDef` without involving
 * the flag at all.
 */

export function useNewPipeline(): boolean {
  return process.env.TROPICAL_USE_NEW_PIPELINE !== '0'
}
