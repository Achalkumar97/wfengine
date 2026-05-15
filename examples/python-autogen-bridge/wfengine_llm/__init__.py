"""
Reusable LLM client with OpenAI primary + Ollama (OpenAI-compatible) fallback.

Environment-driven defaults; override via :class:`LLMClient` constructor.
"""

from __future__ import annotations

from wfengine_llm.client import (
    LLMClient,
    LLMClientConfig,
    LLMClientError,
    configure_logging,
)

__all__ = ["LLMClient", "LLMClientConfig", "LLMClientError", "configure_logging"]
