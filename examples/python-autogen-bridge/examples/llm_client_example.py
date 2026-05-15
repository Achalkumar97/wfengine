#!/usr/bin/env python3
"""
LLMClient example: configuration comes only from the environment (see ``LLMClientConfig`` in ``wfengine_llm.client``).

  export PYTHONPATH="/path/to/examples/python-autogen-bridge"
  export OLLAMA_BASE_URL="http://127.0.0.1:11434/v1"   # your Ollama OpenAI-compatible base
  # optional: OPENAI_API_KEY, OPENAI_MODEL, OLLAMA_MODEL, OLLAMA_API_KEY, …
  python examples/llm_client_example.py
"""

from __future__ import annotations

import asyncio
import os
import sys

_BRIDGE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BRIDGE_ROOT not in sys.path:
    sys.path.insert(0, _BRIDGE_ROOT)

from wfengine_llm import LLMClient, configure_logging


def demo_sync() -> None:
    client = LLMClient()
    messages = [
        {"role": "system", "content": "You reply in one short sentence."},
        {"role": "user", "content": "Say hello and name your backend if obvious."},
    ]

    print("--- sync chat ---")
    print(client.chat(messages, temperature=0.3))

    print("--- sync stream ---")
    for chunk in client.chat_stream(messages, temperature=0.3):
        print(chunk, end="", flush=True)
    print()


async def demo_async() -> None:
    client = LLMClient()
    messages = [{"role": "user", "content": "Count from 1 to 3 in words only."}]

    print("--- async chat ---")
    print(await client.achat(messages, temperature=0.2))

    print("--- async stream ---")
    async for piece in client.achat_stream(messages, temperature=0.2):
        print(piece, end="", flush=True)
    print()


def main() -> None:
    configure_logging()
    demo_sync()
    asyncio.run(demo_async())


if __name__ == "__main__":
    main()
