import type { Edge, Node } from "reactflow";
import type { WfNodeData } from "@wfengine/ui";

/** Showcase graph for Turbo Flow–style demo (editable). */
export const STUDIO_DEMO_NODES: Node<WfNodeData>[] = [
  {
    id: "demo-webhook",
    type: "wfNode",
    position: { x: 80, y: 100 },
    data: {
      wfType: "trigger.webhook",
      label: "Webhook",
      config: {},
    },
  },
  {
    id: "demo-http",
    type: "wfNode",
    position: { x: 400, y: 120 },
    data: {
      wfType: "http.request",
      label: "HTTP Request",
      config: {
        method: "POST",
        url: "https://api.example.com/users",
      },
    },
  },
  {
    id: "demo-pg",
    type: "wfNode",
    position: { x: 720, y: 60 },
    data: {
      wfType: "postgres.query",
      label: "Postgres Query",
      config: {
        query: "SELECT * FROM users LIMIT 100",
      },
    },
  },
  {
    id: "demo-slack",
    type: "wfNode",
    position: { x: 620, y: 280 },
    data: {
      wfType: "slack.send",
      label: "Send Slack",
      config: {
        channel: "engineering",
      },
    },
  },
];

export const STUDIO_DEMO_EDGES: Edge[] = [
  {
    id: "demo-e-wh",
    source: "demo-webhook",
    target: "demo-http",
    type: "turboGradient",
    animated: true,
  },
  {
    id: "demo-e-hp",
    source: "demo-http",
    target: "demo-pg",
    type: "turboGradient",
    animated: true,
  },
  {
    id: "demo-e-hs",
    source: "demo-http",
    target: "demo-slack",
    type: "turboGradient",
    animated: true,
  },
];
