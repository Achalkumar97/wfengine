/** Palette entry matching registered workflow node types */
export interface PaletteNodeMeta {
  type: string;
  label: string;
  /** Short description for palette tooltips */
  description?: string;
  /** UI grouping in the node library */
  category?:
    | "Triggers"
    | "Actions"
    | "Data"
    | "Integrations"
    | "GitHub"
    | "Testing"
    | "Multi-Agent"
    | "AI Agents";
  icon?: string;
  /** Default JSON-serializable config */
  defaultConfig?: Record<string, unknown>;
}
