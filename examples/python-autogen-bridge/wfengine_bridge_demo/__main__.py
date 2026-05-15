"""
Demo stdin/stdout bridge for wfengine `python_autogen` runtime.

No AutoGen/ag2 dependency — simulates a multi-agent transcript so you can test
the Node → Python subprocess wiring. Replace this body with real AutoGen code later.

Contract: read one JSON object from stdin, print one JSON object to stdout.
"""

from __future__ import annotations

import json
import sys


def main() -> None:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        print(
            json.dumps(
                {"success": False, "error": f"invalid stdin JSON: {e}", "finalAnswer": ""}
            )
        )
        sys.exit(1)

    mode = payload.get("mode")
    team = payload.get("teamName") or "team"
    agents = payload.get("agents") or []
    upstream = payload.get("upstream")
    if not isinstance(upstream, dict):
        upstream = {}
    task = (payload.get("taskInstructions") or "")[:500]

    transcript = []
    for i, a in enumerate(agents):
        if not isinstance(a, dict):
            continue
        name = str(a.get("name") or f"agent{i}")
        transcript.append(
            {
                "agent": name,
                "content": (
                    f"[wfengine_bridge_demo] Stub turn for **{name}**. "
                    f"Upstream keys: {list(upstream.keys())[:8]}. "
                    f"Task hint: {task or '(none)'}"
                ),
            }
        )

    out = {
        "success": True,
        "transcript": transcript,
        "finalAnswer": (
            f"[wfengine_bridge_demo] Team “{team}” finished {len(transcript)} stub turns. "
            "Replace __main__.py with real AutoGen/ag2 code when ready."
        ),
        "output": {"mode": mode, "demo": True},
    }
    print(json.dumps(out))


if __name__ == "__main__":
    main()
