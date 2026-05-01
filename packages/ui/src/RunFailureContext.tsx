import { createContext, useContext } from "react";

/** Node IDs that failed in the last workflow run (for canvas highlight). */
export const RunFailureContext = createContext<Set<string> | null>(null);

export function useRunFailureHighlight(nodeId: string): boolean {
  const set = useContext(RunFailureContext);
  return set?.has(nodeId) ?? false;
}
