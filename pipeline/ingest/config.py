"""Per-book configuration (books/<id>/book.yaml)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
ROLES = {"body", "code", "heading", "label", "annotation", "bullet", "drop"}


def base_font(name: str) -> str:
    """Strip the 6-letter subset prefix: 'OEJELE+NewBaskerville-Roman' -> 'NewBaskerville-Roman'."""
    return name.split("+", 1)[1] if "+" in name else name


@dataclass
class FontRule:
    pattern: re.Pattern
    role: str
    min_size: float | None = None
    max_size: float | None = None

    def matches(self, font: str, size: float) -> bool:
        if not self.pattern.search(font):
            return False
        if self.min_size is not None and size < self.min_size - 0.05:
            return False
        if self.max_size is not None and size > self.max_size + 0.05:
            return False
        return True


@dataclass
class BookConfig:
    id: str
    title: str
    source: Path
    out_dir: Path
    font_rules: list[FontRule]
    margin_top: float = 0.06
    margin_bottom: float = 0.92
    callout_labels: tuple[str, ...] = ("NOTE", "TIP", "WARNING", "DEFINITION", "IMPORTANT", "CAUTION")
    extra_sections: tuple[str, ...] = ("Summary",)
    chunk_min_tokens: int = 250
    chunk_max_tokens: int = 3000
    raw: dict = field(default_factory=dict)

    def role(self, font: str, size: float) -> str:
        for rule in self.font_rules:
            if rule.matches(font, size):
                return rule.role
        return "drop"


def load_book(path: str | Path) -> BookConfig:
    path = Path(path)
    if not path.is_absolute():
        path = ROOT / path
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    rules = []
    for r in data.get("fonts", []):
        if r["role"] not in ROLES:
            raise ValueError(f"{path}: unknown font role {r['role']!r}")
        rules.append(FontRule(re.compile(r["match"]), r["role"], r.get("min_size"), r.get("max_size")))
    margins = data.get("margins", {})
    chunk = data.get("chunk", {})
    cfg = BookConfig(
        id=data["id"],
        title=data.get("title", data["id"]),
        source=ROOT / data["source"],
        out_dir=ROOT / data.get("out_dir", f"sources/{data['id']}"),
        font_rules=rules,
        margin_top=margins.get("top", 0.06),
        margin_bottom=margins.get("bottom", 0.92),
        chunk_min_tokens=chunk.get("min_tokens", 250),
        chunk_max_tokens=chunk.get("max_tokens", 3000),
        raw=data,
    )
    if "callout_labels" in data:
        cfg.callout_labels = tuple(data["callout_labels"])
    if "extra_sections" in data:
        cfg.extra_sections = tuple(data["extra_sections"])
    return cfg
