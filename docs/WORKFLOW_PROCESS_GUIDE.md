# Workflow Process & Architecture Guide

This document explains the step-by-step execution logic of the Workflow Engine SDK, using the `earphones-under-2000-slack.json` multi-agent workflow as an example. It also clarifies specific architectural decisions regarding agent orchestration and tool usage.

## 1. Step-by-Step Workflow Execution

### A. Initiation & DAG Sorting
When the workflow is triggered:
1. The request enters via the Fastify API (`apps/server/src/main.ts`) and is added to the BullMQ job queue.
2. A worker picks it up and initializes the **Workflow Engine** (`packages/core/src/engine.ts`).
3. The engine parses the `edges` and performs a **Topological Sort** to determine the exact execution order (e.g., `start` ➔ `web-search-tavily` ➔ `gym-autogen-team` ➔ `tool-write-csv` ➔ `tool-send-slack`).

### B. Upstream Data Gathering
1. The `start` node executes, passing the initial payload (`{"runDate": "YYYY-MM-DD", "budgetInr": 2000}`).
2. The `web-search-tavily` node (`http.request`) executes next, fetching web search results from the Tavily API.
3. The API response (`body`) is stored in the engine's state, acting as context for downstream AI agents.

### C. Multi-Agent Orchestration
The engine reaches the `gym-autogen-team` node (`autogen.multi-agent`) and hands off control to the orchestrator (`autogen-orchestrator.ts`).
1. **Round-Robin Turns**: The orchestrator manages the team sequentially:
   - **Turn 1 (researcher)**: Identifies candidate earphones using Tavily data.
   - **Turn 2 (evaluator)**: Filters the list to the top 5 for gym use.
   - **Turn 3 (collector)**: Verifies specs and links.
   - **Turn 4 (validator)**: Quality checks the output.
   - **Turn 5 (excel_writer)**: Formats the data into strict RFC 4180 CSV format.
   - **Turn 6 (action_executor)**: Instructed to execute tools using the CSV.

### D. Agent Tool Dispatch
Instead of the AI running Python or bash scripts, it calls predefined canvas nodes as tools.
1. The `action_executor` agent issues a tool call for `write_csv_report` via the OpenAI API (`openai-tool-loop.ts`).
2. The **Agent Tool Dispatcher** (`packages/core/src/agent-tool-dispatch.ts`) intercepts this.
3. It maps the requested tool (`write_csv_report`) to the actual workflow node (`tool-write-csv`).
4. The engine pauses the agent, executes the `file.write` node, and returns the success status to the agent.
5. The agent then calls the next tool (`send_slack_message`), mapped to the `tool-send-slack` node, which posts the Slack message.

### E. Pub/Sub Real-Time Events
Throughout this process, the Worker publishes real-time events to a Redis Pub/Sub channel (`wfengine:exec:{id}`). The frontend Studio subscribes to this via Server-Sent Events (SSE) to show live progress.

---

## 2. Architectural Clarifications

### Why aren't Agents visible in the Studio UI?
If the agents exist in the JSON configuration but do not appear in the Studio UI canvas, it is due to a frontend/UI bug (specifically related to the recent refactoring of "Agent Bucket Logic" where `agentCanvasBucket.ts` was removed or changed). The engine still successfully reads the JSON and executes the agents perfectly, even if the UI fails to display them.

### Who handles orchestration? Is it an LLM?
**No. Orchestration is handled entirely by deterministic TypeScript (`autogen-orchestrator.ts`).**
There is no "Supervisor LLM" dynamically deciding who speaks next. The TypeScript code acts as a strict referee, forcing agents to speak in a predefined order, limiting their turns, and enforcing validation gates (e.g., ensuring previous agents provided data before allowing the final agent to execute tools). This makes execution faster, cheaper, and more reliable.

### What orchestration patterns are supported?
Currently, the system uses a strict **Round-Robin loop**. It iterates sequentially through the list of agents (Agent 1 ➔ Agent 2 ➔ Agent 3) and loops back if the maximum turns exceed the number of agents. It does **not** natively support dynamic AI-driven routing like Manager/Supervisor patterns, Plan-and-Execute, or Debate/Critic.

### Is it necessary to explicitly link tools?
**Yes, absolutely.**
An AI agent does not have global awareness of your workflow canvas. It only knows what you pass to it in the `tools` array of the API request. 
Furthermore, the `agent-tool-dispatch.ts` module relies on this explicit mapping to know which canvas node to trigger when the LLM asks to use a tool. Without explicitly defining the tool and mapping it to a node, the agent wouldn't know the capability exists, and the engine wouldn't know which node to execute.
