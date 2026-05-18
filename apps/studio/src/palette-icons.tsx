import type { PaletteNodeMeta } from "@wfengine/ui";
import {
  Bot,
  CircleDot,
  Clock,
  Database,
  FileInput,
  FileOutput,
  GitBranch,
  Globe,
  Inbox,
  ListTree,
  Mail,
  MessageSquare,
  Network,
  Sparkles,
  TestTube,
  UsersRound,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import type { ReactElement } from "react";

const MAP: Record<string, LucideIcon> = {
  webhook: Webhook,
  clock: Clock,
  globe: Globe,
  "circle-dot": CircleDot,
  mail: Mail,
  inbox: Inbox,
  "message-square": MessageSquare,
  database: Database,
  "file-input": FileInput,
  "file-output": FileOutput,
  github: GitBranch,
  "list-tree": ListTree,
  "test-tube": TestTube,
  sparkles: Sparkles,
  bot: Bot,
  "users-round": UsersRound,
  network: Network,
};

export function PaletteGlyph(props: { meta: PaletteNodeMeta }): ReactElement {
  const key = props.meta.icon ?? "";
  const Icon = MAP[key] ?? CircleDot;
  return <Icon className="h-4 w-4" aria-hidden />;
}
