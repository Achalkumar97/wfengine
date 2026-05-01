import { createContext, useContext, type ReactNode } from "react";

export interface NodeActionHandlers {
  selectAndFocus: (nodeId: string) => void;
  duplicateNode: (nodeId: string) => void;
  deleteNode: (nodeId: string) => void;
  /** When provided, toolbar shows Re-run using cached upstream outputs from the last run */
  reRunWithCachedInputs?: (nodeId: string) => void;
}

const NodeActionsContext = createContext<NodeActionHandlers | null>(null);

export function NodeActionsProvider(props: {
  value: NodeActionHandlers;
  children: ReactNode;
}): ReactNode {
  return (
    <NodeActionsContext.Provider value={props.value}>
      {props.children}
    </NodeActionsContext.Provider>
  );
}

export function useNodeActions(): NodeActionHandlers | null {
  return useContext(NodeActionsContext);
}
