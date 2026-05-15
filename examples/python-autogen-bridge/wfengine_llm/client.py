"""
Production-oriented LLM client: OpenAI first, Ollama (OpenAI-compatible `/v1`) on failure or missing key.

Uses the official ``openai`` Python SDK for both backends by swapping ``base_url`` and credentials.
"""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass, field
from typing import Any

from openai import AsyncOpenAI, OpenAI

# Chat message shape accepted by OpenAI-compatible APIs
ChatMessage = dict[str, Any]


class LLMClientError(RuntimeError):
    """Raised when both OpenAI and Ollama fail for a request."""

    def __init__(
        self,
        message: str,
        *,
        primary_error: BaseException | None = None,
        fallback_error: BaseException | None = None,
    ) -> None:
        super().__init__(message)
        self.primary_error = primary_error
        self.fallback_error = fallback_error


def _env(key: str, default: str | None = None) -> str | None:
    v = os.environ.get(key)
    if v is None or str(v).strip() == "":
        return default
    return v.strip()


@dataclass
class LLMClientConfig:
    """
    Configuration for :class:`LLMClient`.

    Ollama URL should include the ``/v1`` suffix for OpenAI compatibility, e.g.
    ``http://127.0.0.1:11434/v1``. Override ``OLLAMA_BASE_URL`` in your environment.
    """

    openai_api_key: str | None = field(
        default_factory=lambda: _env("OPENAI_API_KEY"),
    )
    openai_base_url: str | None = field(
        default_factory=lambda: _env("OPENAI_BASE_URL", "https://api.openai.com/v1"),
    )
    openai_model: str = field(
        default_factory=lambda: _env("OPENAI_MODEL", "gpt-4o-mini") or "gpt-4o-mini",
    )

    ollama_base_url: str = field(
        default_factory=lambda: _env("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1")
        or "http://127.0.0.1:11434/v1",
    )
    ollama_api_key: str = field(
        default_factory=lambda: _env("OLLAMA_API_KEY", "ollama") or "ollama",
    )
    ollama_model: str = field(
        default_factory=lambda: _env("OLLAMA_MODEL", "llama3.2") or "llama3.2",
    )

    timeout_seconds: float = 120.0
    """HTTP timeout for each provider request."""

    log_name: str = "wfengine_llm"


class LLMClient:
    """
    Chat completions with automatic fallback from OpenAI to Ollama.

    **Primary:** OpenAI when ``OPENAI_API_KEY`` is set (or ``openai_api_key`` passed to config).

    **Fallback:** Ollama at ``OLLAMA_BASE_URL`` when the key is missing *or* the OpenAI call raises.

    Thread-safe for sync usage; create a separate instance per event loop for async-heavy apps if needed.
    """

    def __init__(self, config: LLMClientConfig | None = None) -> None:
        self._cfg = config or LLMClientConfig()
        self._log = logging.getLogger(self._cfg.log_name)

        timeout = self._cfg.timeout_seconds
        key = self._cfg.openai_api_key
        base = (self._cfg.openai_base_url or "").rstrip("/")

        self._openai_enabled = bool(key)
        self._sync_openai: OpenAI | None = None
        self._sync_ollama: OpenAI | None = None
        self._async_openai: AsyncOpenAI | None = None
        self._async_ollama: AsyncOpenAI | None = None

        if self._openai_enabled:
            self._sync_openai = OpenAI(
                api_key=key,
                base_url=base or "https://api.openai.com/v1",
                timeout=timeout,
            )
            self._async_openai = AsyncOpenAI(
                api_key=key,
                base_url=base or "https://api.openai.com/v1",
                timeout=timeout,
            )

        obase = self._cfg.ollama_base_url.rstrip("/")
        self._sync_ollama = OpenAI(
            api_key=self._cfg.ollama_api_key,
            base_url=obase,
            timeout=timeout,
        )
        self._async_ollama = AsyncOpenAI(
            api_key=self._cfg.ollama_api_key,
            base_url=obase,
            timeout=timeout,
        )

    @property
    def config(self) -> LLMClientConfig:
        return self._cfg

    # --- Sync ---

    def chat(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float | None = 0.7,
        max_tokens: int | None = None,
        **extra: Any,
    ) -> str:
        """
        Non-streaming chat completion. Returns assistant message content as a single string.

        Tries OpenAI first (if configured), then Ollama.
        """
        primary_exc: BaseException | None = None

        if self._sync_openai is not None:
            try:
                return self._complete_sync(
                    self._sync_openai,
                    self._cfg.openai_model,
                    messages,
                    stream=False,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    **extra,
                )
            except Exception as e:
                primary_exc = e
                self._log.warning(
                    "OpenAI chat failed (%s: %s); falling back to Ollama.",
                    type(e).__name__,
                    e,
                    exc_info=self._log.isEnabledFor(logging.DEBUG),
                )

        try:
            return self._complete_sync(
                self._sync_ollama,
                self._cfg.ollama_model,
                messages,
                stream=False,
                temperature=temperature,
                max_tokens=max_tokens,
                **extra,
            )
        except Exception as fe:
            raise LLMClientError(
                "Both OpenAI and Ollama failed for chat().",
                primary_error=primary_exc,
                fallback_error=fe,
            ) from fe

    def chat_stream(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float | None = 0.7,
        max_tokens: int | None = None,
        **extra: Any,
    ) -> Iterator[str]:
        """
        Streaming chat: yields content deltas (typically token or chunk strings).

        If OpenAI is configured, streams from OpenAI until an error; then falls back and streams from Ollama.
        """
        primary_exc: BaseException | None = None

        if self._sync_openai is not None:
            try:
                yield from self._stream_sync(
                    self._sync_openai,
                    self._cfg.openai_model,
                    messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    **extra,
                )
                return
            except Exception as e:
                primary_exc = e
                self._log.warning(
                    "OpenAI stream failed (%s: %s); falling back to Ollama stream.",
                    type(e).__name__,
                    e,
                    exc_info=self._log.isEnabledFor(logging.DEBUG),
                )

        try:
            yield from self._stream_sync(
                self._sync_ollama,
                self._cfg.ollama_model,
                messages,
                temperature=temperature,
                max_tokens=max_tokens,
                **extra,
            )
        except Exception as fe:
            raise LLMClientError(
                "Both OpenAI and Ollama failed for chat_stream().",
                primary_error=primary_exc,
                fallback_error=fe,
            ) from fe

    def _complete_sync(
        self,
        client: OpenAI,
        model: str,
        messages: list[ChatMessage],
        *,
        stream: bool,
        temperature: float | None,
        max_tokens: int | None,
        **extra: Any,
    ) -> str:
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": stream,
        }
        if temperature is not None:
            kwargs["temperature"] = temperature
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens
        kwargs.update(extra)

        resp = client.chat.completions.create(**kwargs)
        if stream:
            raise RuntimeError("internal: use stream path")
        choice = resp.choices[0]
        msg = choice.message
        content = msg.content
        if content is None:
            return ""
        return content

    def _stream_sync(
        self,
        client: OpenAI,
        model: str,
        messages: list[ChatMessage],
        *,
        temperature: float | None,
        max_tokens: int | None,
        **extra: Any,
    ) -> Iterator[str]:
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": True,
        }
        if temperature is not None:
            kwargs["temperature"] = temperature
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens
        kwargs.update(extra)

        stream = client.chat.completions.create(**kwargs)
        for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta is None:
                continue
            text = delta.content
            if text:
                yield text

    # --- Async ---

    async def achat(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float | None = 0.7,
        max_tokens: int | None = None,
        **extra: Any,
    ) -> str:
        """Async non-streaming chat."""
        primary_exc: BaseException | None = None

        if self._async_openai is not None:
            try:
                return await self._complete_async(
                    self._async_openai,
                    self._cfg.openai_model,
                    messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    **extra,
                )
            except Exception as e:
                primary_exc = e
                self._log.warning(
                    "OpenAI achat failed (%s: %s); falling back to Ollama.",
                    type(e).__name__,
                    e,
                    exc_info=self._log.isEnabledFor(logging.DEBUG),
                )

        try:
            return await self._complete_async(
                self._async_ollama,
                self._cfg.ollama_model,
                messages,
                temperature=temperature,
                max_tokens=max_tokens,
                **extra,
            )
        except Exception as fe:
            raise LLMClientError(
                "Both OpenAI and Ollama failed for achat().",
                primary_error=primary_exc,
                fallback_error=fe,
            ) from fe

    async def achat_stream(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float | None = 0.7,
        max_tokens: int | None = None,
        **extra: Any,
    ) -> AsyncIterator[str]:
        """Async streaming: yields content deltas."""
        primary_exc: BaseException | None = None

        if self._async_openai is not None:
            try:
                async for piece in self._stream_async(
                    self._async_openai,
                    self._cfg.openai_model,
                    messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    **extra,
                ):
                    yield piece
                return
            except Exception as e:
                primary_exc = e
                self._log.warning(
                    "OpenAI achat_stream failed (%s: %s); falling back to Ollama.",
                    type(e).__name__,
                    e,
                    exc_info=self._log.isEnabledFor(logging.DEBUG),
                )

        try:
            async for piece in self._stream_async(
                self._async_ollama,
                self._cfg.ollama_model,
                messages,
                temperature=temperature,
                max_tokens=max_tokens,
                **extra,
            ):
                yield piece
        except Exception as fe:
            raise LLMClientError(
                "Both OpenAI and Ollama failed for achat_stream().",
                primary_error=primary_exc,
                fallback_error=fe,
            ) from fe

    async def _complete_async(
        self,
        client: AsyncOpenAI,
        model: str,
        messages: list[ChatMessage],
        *,
        temperature: float | None,
        max_tokens: int | None,
        **extra: Any,
    ) -> str:
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": False,
        }
        if temperature is not None:
            kwargs["temperature"] = temperature
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens
        kwargs.update(extra)

        resp = await client.chat.completions.create(**kwargs)
        choice = resp.choices[0]
        msg = choice.message
        content = msg.content
        if content is None:
            return ""
        return content

    async def _stream_async(
        self,
        client: AsyncOpenAI,
        model: str,
        messages: list[ChatMessage],
        *,
        temperature: float | None,
        max_tokens: int | None,
        **extra: Any,
    ) -> AsyncIterator[str]:
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": True,
        }
        if temperature is not None:
            kwargs["temperature"] = temperature
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens
        kwargs.update(extra)

        stream = await client.chat.completions.create(**kwargs)
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta is None:
                continue
            text = delta.content
            if text:
                yield text


def configure_logging(level: int = logging.INFO) -> None:
    """Optional helper so library logs are visible when running examples."""
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


__all__ = ["LLMClient", "LLMClientConfig", "LLMClientError", "configure_logging"]
