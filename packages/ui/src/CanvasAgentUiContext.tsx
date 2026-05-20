import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import type { AgentLibraryEntryLite } from "./AgentCanvasBucket.js";

export interface CanvasAgentUiValue {
  libraryEntries: readonly AgentLibraryEntryLite[];
  /** Selects the node and optionally lets Studio open Agent Library / inspector. */
  onAddAgentFromBucket?: (nodeId: string) => void;
  /** Edit persona at index (Studio opens dialog). */
  onEditAgentRow?: (nodeId: string, index: number) => void;
  /** Remove persona at index (MAF / multi-agent only; enforced minimum count in canvas). */
  onDeleteAgentRow?: (nodeId: string, index: number) => void;
}

const CanvasAgentUiContext = createContext<CanvasAgentUiValue>({
  libraryEntries: [],
});

export function CanvasAgentUiProvider(props: {
  value: CanvasAgentUiValue;
  children: ReactNode;
}): ReactNode {
  return (
    <CanvasAgentUiContext.Provider value={props.value}>
      {props.children}
    </CanvasAgentUiContext.Provider>
  );
}

export function useCanvasAgentUi(): CanvasAgentUiValue {
  return useContext(CanvasAgentUiContext);
}
