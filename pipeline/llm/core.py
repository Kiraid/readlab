"""Providers, response cache, and cost ledger.

  Call    what a node asks for: system + user messages, model, thinking on/off, max_tokens
  Result  text + normalised usage + cost + latency, whether it came from the cache

Providers
  deepseek (openai-compatible)  POST {base_url}/chat/completions with a Bearer key from .env
  replay                        returns text from a file or a function; for tests and dry runs

The cache key is a hash of (provider, model, thinking, max_tokens, system, user), so re-running a case after a
code change only pays for calls whose prompt actually changed. The ledger is JSONL, one line per call.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import yaml

from pipeline.ingest.config import ROOT

CONFIG = ROOT / "pipeline" / "config.yaml"
CACHE_DIR = ROOT / ".cache" / "llm"
_LEDGER_LOCK = threading.Lock()  # cases run in parallel threads and share one ledger file


def read_ledger(path: Path) -> list[dict]:
    """All complete rows; a line still being written by another thread is skipped."""
    rows = []
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def load_env(path: Path = ROOT / ".env") -> None:
    """Minimal .env reader: KEY=value lines, # comments. Existing environment variables win."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def load_config(path: Path = CONFIG) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


@dataclass
class Call:
    node: str
    provider: str
    model: str
    system: str
    user: str
    thinking: bool = True
    max_tokens: int = 8000
    json_mode: bool = False
    tag: str = ""  # free text for the ledger, e.g. the case id

    def key(self) -> str:
        blob = json.dumps([self.provider, self.model, self.thinking, self.max_tokens, self.json_mode, self.system, self.user])
        return hashlib.sha256(blob.encode()).hexdigest()


@dataclass
class Usage:
    input: int = 0          # all prompt tokens
    cache_hit: int = 0      # of which served from the provider's prompt cache
    output: int = 0         # all completion tokens, reasoning included
    reasoning: int = 0      # of which reasoning


@dataclass
class Result:
    text: str
    usage: Usage = field(default_factory=Usage)
    cost_usd: float = 0.0
    latency_s: float = 0.0
    cached: bool = False    # served from our response cache (no provider call, no cost)
    model: str = ""
    finish_reason: str = ""


class ProviderError(RuntimeError):
    pass


RETRY_STATUS = {429, 500, 502, 503, 504}


# ---------------------------------------------------------------- providers

def _deepseek(call: Call, cfg: dict) -> Result:
    import httpx

    key = os.environ.get(cfg.get("key_env", "DEEPSEEK_API_KEY"), "")
    if not key:
        raise ProviderError(f"no API key: put {cfg.get('key_env')} in .env")
    body = {
        "model": call.model,
        "messages": [{"role": "system", "content": call.system}, {"role": "user", "content": call.user}],
        "max_tokens": call.max_tokens,
        "thinking": {"type": "enabled" if call.thinking else "disabled"},
        "stream": False,
    }
    if call.json_mode:
        body["response_format"] = {"type": "json_object"}
    t0 = time.time()
    # Transient failures (network down for a moment, 429, 5xx) are retried with backoff: one blip in WSL's network
    # once cost a DDIA run four sections (2026-11-07). Anything else (400, 401, bad JSON) fails at once.
    for attempt, wait in enumerate((5, 20, 60, None)):
        try:
            r = httpx.post(f"{cfg['base_url'].rstrip('/')}/chat/completions", json=body, timeout=600,
                           headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
            if r.status_code not in RETRY_STATUS:
                break
            err = f"deepseek HTTP {r.status_code}: {r.text[:400]}"
        except httpx.TransportError as e:
            err = f"deepseek request failed: {e}"
        if wait is None:
            raise ProviderError(f"{err} (after {attempt + 1} attempts)")
        time.sleep(wait)
    if r.status_code != 200:
        raise ProviderError(f"deepseek HTTP {r.status_code}: {r.text[:400]}")
    data = r.json()
    choice = data["choices"][0]
    u = data.get("usage", {})
    usage = Usage(
        input=u.get("prompt_tokens", 0),
        cache_hit=u.get("prompt_cache_hit_tokens", (u.get("prompt_tokens_details") or {}).get("cached_tokens", 0)),
        output=u.get("completion_tokens", 0),
        reasoning=(u.get("completion_tokens_details") or {}).get("reasoning_tokens", 0),
    )
    return Result(text=choice["message"].get("content") or "", usage=usage, latency_s=round(time.time() - t0, 2),
                  model=data.get("model", call.model), finish_reason=choice.get("finish_reason", ""))


# replay answers: a function (call) -> text, registered by tests or the dry-run command
REPLAY: dict[str, Callable[[Call], str]] = {}


def _replay(call: Call, cfg: dict) -> Result:
    fn = REPLAY.get(call.tag) or REPLAY.get(call.node) or REPLAY.get("*")
    if not fn:
        raise ProviderError(f"replay: nothing registered for tag {call.tag!r} or node {call.node!r}")
    text = fn(call)
    return Result(text=text, usage=Usage(input=len(call.system + call.user) // 4, output=len(text) // 4), model="replay")


PROVIDERS = {"openai-compatible": _deepseek, "replay": _replay}


# ---------------------------------------------------------------- pricing

def is_peak(cfg: dict, when: datetime) -> bool:
    if when.weekday() >= 5:
        return False
    return any(a <= when.hour < b for a, b in cfg.get("peak_utc", []))


def price(call: Call, usage: Usage, cfg: dict, when: datetime | None = None) -> float:
    p = (cfg.get("prices") or {}).get(call.model)
    if not p:
        return 0.0
    when = when or datetime.now(timezone.utc)
    factor = 1.0 if is_peak(cfg, when) else p.get("offpeak_factor", 1.0)
    miss = max(0, usage.input - usage.cache_hit)
    cost = (usage.cache_hit * p["cache_hit"] + miss * p["cache_miss"] + usage.output * p["output"]) / 1e6
    return round(cost * factor, 6)


# ---------------------------------------------------------------- the one entry point

def call(c: Call, *, ledger: Path | None = None, use_cache: bool = True, config: dict | None = None) -> Result:
    config = config or load_config()
    pcfg = config["providers"][c.provider]
    cache_file = CACHE_DIR / f"{c.key()}.json"
    if use_cache and pcfg["kind"] != "replay" and cache_file.exists():
        d = json.loads(cache_file.read_text(encoding="utf-8"))
        res = Result(text=d["text"], usage=Usage(**d["usage"]), cost_usd=0.0, latency_s=0.0, cached=True,
                     model=d.get("model", c.model), finish_reason=d.get("finish_reason", ""))
    else:
        load_env()
        res = PROVIDERS[pcfg["kind"]](c, pcfg)
        res.cost_usd = price(c, res.usage, pcfg)
        if pcfg["kind"] != "replay" and res.finish_reason != "length":
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(json.dumps({"text": res.text, "usage": asdict(res.usage), "model": res.model,
                                              "finish_reason": res.finish_reason}), encoding="utf-8")
    if ledger:
        ledger.parent.mkdir(parents=True, exist_ok=True)
        row = {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"), "node": c.node, "tag": c.tag,
               "provider": c.provider, "model": res.model or c.model, "thinking": c.thinking, **asdict(res.usage),
               "cost_usd": res.cost_usd, "latency_s": res.latency_s, "cached": res.cached, "finish": res.finish_reason,
               "prompt_key": c.key()[:16]}
        with _LEDGER_LOCK, ledger.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")
    return res
