/** Stable conversion used when building workflow execute results (Map preserves insertion order). */
export function outputsMapToRecord(
  outputs: Map<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(outputs);
}
