import json
import shutil
from datetime import datetime, timezone

import pytest

from pipeline.harness.section import apply_edits, build_graph, describe_errors
from pipeline.ingest.config import ROOT
from pipeline.llm import Call
from pipeline.llm import core as llm

FIX = ROOT / "tools" / "fixtures" / "validate"
GOOD = (FIX / "good" / "01-good.md").read_text(encoding="utf-8")
COPIED = "A Deployment keeps a fixed number of identical pods running and replaces any pod that disappears."
OWN = "Losing a pod is not a problem: the Deployment starts a replacement by itself."


@pytest.fixture
def case_dir(tmp_path):
    d = tmp_path / "fixture-case"
    d.mkdir()
    shutil.copytree(FIX / "files", d / "files")
    shutil.copy(FIX / "source.json", d / "source.json")
    (d / "case.yaml").write_text('id: fixture\ntitle: Running the web app\nshell: basic\nbrief: "x"\n'
                                 'expect: { visual_min: 1, quiz_min: 0 }\n', encoding="utf-8")
    return d


def test_pricing_peak_and_offpeak():
    cfg = llm.load_config()["providers"]["deepseek"]
    c = Call(node="write", provider="deepseek", model="deepseek-flash", system="", user="")
    usage = llm.Usage(input=1_000_000, cache_hit=500_000, output=1_000_000)
    peak = datetime(2026, 11, 4, 2, tzinfo=timezone.utc)      # Wednesday 02:00 UTC
    off = datetime(2026, 11, 7, 2, tzinfo=timezone.utc)       # Saturday
    assert llm.price(c, usage, cfg, peak) == pytest.approx(0.003 + 0.15 + 1.2)
    assert llm.price(c, usage, cfg, off) == pytest.approx((0.003 + 0.15 + 1.2) / 2)


def test_apply_edits_only_applies_unique_finds():
    text, applied, failed = apply_edits("a b c. a b c.", json.dumps({"edits": [{"find": "a b c.", "replace": "x"}, {"find": "zz", "replace": "y"}]}))
    assert applied == 0 and len(failed) == 2
    text, applied, _ = apply_edits("one. two.", '{"edits": [{"find": "two.", "replace": "2."}]}')
    assert (text, applied) == ("one. 2.", 1)
    assert apply_edits("x", "not json")[1] == 0


def test_copy_error_quotes_the_writers_own_sentence():
    draft = f"---\nid: \"1.1\"\ntitle: T\n---\nIntro line.\n\n{COPIED}\n\nMore."
    score = {"issues": ['error [copy] 16 words in a row match the source ("a deployment keeps a fixed number …"); rewrite in your own words']}
    [msg] = describe_errors(score, draft)
    assert COPIED in msg


def test_graph_writes_validates_fixes_and_passes(case_dir, tmp_path, monkeypatch):
    bad = GOOD.replace("If one vanishes, it makes a\nnew one without you asking.", COPIED)
    assert COPIED in bad
    monkeypatch.setitem(llm.REPLAY, "write", lambda c: bad)
    monkeypatch.setitem(llm.REPLAY, "fix", lambda c: json.dumps({"edits": [{"find": COPIED, "replace": OWN}]}))
    ledger = tmp_path / "ledger.jsonl"
    nodes = {"write": {"provider": "replay", "model": "replay"}, "fix": {"provider": "replay", "model": "replay"}}
    final = build_graph().invoke({"case_dir": str(case_dir), "run": "t1", "tag": "fixture", "system": "S", "user": "U",
                                  "nodes": nodes, "max_fix": 2, "ledger": str(ledger)})
    assert [h["node"] for h in final["history"]] == ["write", "validate", "fix", "validate"]
    assert final["history"][1]["pass"] is False and final["score"]["pass"] is True
    assert final["history"][2]["edits_applied"] == 1
    assert (case_dir / "out" / "t1.v0.md").exists() and (case_dir / "out" / "t1.v1.md").exists()
    assert OWN in (case_dir / "out" / "t1.md").read_text(encoding="utf-8")
    assert [json.loads(l)["node"] for l in ledger.read_text().splitlines()] == ["write", "fix"]


def test_graph_stops_after_max_fix_rounds(case_dir, tmp_path, monkeypatch):
    bad = GOOD.replace("If one vanishes, it makes a\nnew one without you asking.", COPIED)
    monkeypatch.setitem(llm.REPLAY, "write", lambda c: bad)
    monkeypatch.setitem(llm.REPLAY, "fix", lambda c: '{"edits": []}')  # useless fixer -> falls back to rewrite = same text
    nodes = {"write": {"provider": "replay", "model": "replay"}, "fix": {"provider": "replay", "model": "replay"}}
    final = build_graph().invoke({"case_dir": str(case_dir), "run": "t2", "tag": "fixture", "system": "S", "user": "U",
                                  "nodes": nodes, "max_fix": 1, "ledger": str(tmp_path / "l.jsonl")})
    assert final["fixes"] == 1 and final["score"]["pass"] is False
    assert final["history"][2]["mode"] == "rewrite"


def test_deepseek_without_key_fails_clearly(monkeypatch):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.setattr(llm, "load_env", lambda *a, **k: None)
    with pytest.raises(llm.ProviderError, match="no API key"):
        llm.call(Call(node="write", provider="deepseek", model="deepseek-flash", system="s", user="u"), use_cache=False)
