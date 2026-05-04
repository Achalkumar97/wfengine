# Python AutoGen bridge (demo)

wfengine’s **`python_autogen`** runtime runs:

```bash
<python> -m <pythonModulePath>   # JSON on stdin → JSON on stdout
```

This folder contains a **smoke-test module** `wfengine_bridge_demo` (no `pyautogen` / `autogen` packages required). Use it to verify wiring before you embed real AutoGen code.

## 1. Test the module alone

From **repo root**:

```bash
cd examples/python-autogen-bridge
export PYTHONPATH="$(pwd)"
echo '{"mode":"multi","teamName":"t","agents":[{"name":"a"},{"name":"b"}],"upstream":{"hello":1},"taskInstructions":"demo"}' | python3 -m wfengine_bridge_demo
```

You should see one JSON line with `success`, `transcript`, `finalAnswer`.

## 2. Point the worker at this package

The worker process must resolve `python -m wfengine_bridge_demo`. Add **`PYTHONPATH`** so Python finds the package:

**Option A — `.env` at repo root** (same file as `DATABASE_URL`; worker loads it):

```bash
PYTHONPATH=/absolute/path/to/workflow-engine-sdk/examples/python-autogen-bridge
```

Use your real absolute path (no trailing slash required).

**Option B — shell** (before `npm run worker`):

```bash
export PYTHONPATH=/absolute/path/to/workflow-engine-sdk/examples/python-autogen-bridge
npm run worker -w @wfengine/server
```

## 3. Configure the node in Studio

On **AutoGen: Multi-agent** (or **AutoGen: Single agent** if you use `python_autogen` there):

| Field | Value |
|--------|--------|
| **Runtime** | Python AutoGen bridge |
| **Python executable** | `python3` (or leave empty; defaults to `python3`) |
| **Python module path** | `wfengine_bridge_demo` |

Restart the **worker** after changing `.env`.

## 4. Run the workflow

Use your usual path: Studio **Run**, or `POST /executions` with the workflow version id, with **async** if needed so the worker picks it up.

If the node still fails, check execution logs for `Python bridge exited` — often **`ModuleNotFoundError`** means `PYTHONPATH` is wrong or the module name doesn’t match the folder.

## 5. Production AutoGen

Replace `wfengine_bridge_demo/__main__.py` with code that calls **real** AutoGen/ag2, reads the stdin payload (`mode`: `single` | `multi`, `upstream`, `agents`, …), and prints bridge JSON as in [`packages/nodes-agents/README.md`](../../packages/nodes-agents/README.md).
