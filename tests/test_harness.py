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


def test_parse_json_tolerates_fences_stray_text_and_trailing_commas():
    from pipeline.harness.chapter import parse_json
    assert parse_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_json('Here: {"a": {"b": [1, 2,], "c": "x",}, "d": 2,} done') == {"a": {"b": [1, 2], "c": "x"}, "d": 2}


def test_deepseek_retries_transient_failures(monkeypatch):
    import httpx

    from pipeline.llm import core

    calls = []

    class Resp:
        status_code = 200
        text = ""

        def json(self):
            return {"choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 3, "completion_tokens": 1}}

    def post(*a, **k):
        calls.append(1)
        if len(calls) == 1:
            raise httpx.ConnectError("[Errno 101] Network is unreachable")
        if len(calls) == 2:
            r = Resp(); r.status_code = 503; r.text = "busy"; return r
        return Resp()

    monkeypatch.setattr(httpx, "post", post)
    monkeypatch.setattr(core.time, "sleep", lambda s: None)
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test")
    c = core.Call(node="judge", provider="deepseek", model="deepseek-flash", system="s", user="u")
    res = core._deepseek(c, {"base_url": "https://example.invalid", "key_env": "DEEPSEEK_API_KEY"})
    assert res.text == "ok" and len(calls) == 3

    calls.clear()
    monkeypatch.setattr(httpx, "post", lambda *a, **k: (_ for _ in ()).throw(httpx.ConnectError("down")))
    import pytest
    with pytest.raises(core.ProviderError, match="after 4 attempts"):
        core._deepseek(c, {"base_url": "https://example.invalid", "key_env": "DEEPSEEK_API_KEY"})


def test_copy_problems_name_the_exact_shared_words():
    from pipeline.harness.section import describe_errors, shared_phrase
    source = "A controller watches two kinds of object and reconciles them by creating or deleting pods as needed."
    mine = "Each controller reconciles them by creating or deleting pods whenever counts drift."
    assert shared_phrase(mine, source) is None  # 7 shared words: under the 8-word threshold
    mine = "The loop reconciles them by creating or deleting pods as needed, all day long."
    assert shared_phrase(mine, source) == "reconciles them by creating or deleting pods as needed"
    score = {"issues": ['error [copy] 9 words in a row match the source ("reconciles them by creating or deleting …"); rewrite in your own words']}
    [p] = describe_errors(score, f"---\nid: x\n---\n{mine}\n", source)
    assert "«The loop reconciles" in p and '"reconciles them by creating or deleting pods as needed"' in p


def test_a_plan_cut_off_at_its_token_limit_keeps_the_complete_briefs():
    from pipeline.harness.chapter import salvage_plan
    cut = '{"chapter_summary": "Recovery, in order.", "sections": [{"chunk": "c01", "brief": "A"}, {"chunk": "c02", "brief": "B, with {braces}"}, {"chunk": "c03", "brief": "Hal'
    p = salvage_plan(cut)
    assert p["chapter_summary"] == "Recovery, in order."
    assert [s["chunk"] for s in p["sections"]] == ["c01", "c02"]
    assert salvage_plan("not json at all") == {"chapter_summary": "", "sections": []}


def test_briefs_carry_the_chapter_design_and_this_sections_part():
    from pipeline.harness.chapter import brief_text
    design = {"reader": "Knows SQL, new to concurrency.", "goal": "Predict which anomalies an isolation level allows.",
              "running_example": {"name": "seat booking", "what": "two users book the last seat", "chunks": ["c03"]},
              "misconceptions": [{"wrong": "a transaction locks everything it reads", "right": "it depends on the isolation level", "chunk": "c03"}],
              "layers_down": [{"concept": "commit", "beneath": "a write is durable once it is in the log on disk", "chunk": "c02"}],
              "mechanisms": [{"name": "lost update", "chunk": "c03", "build": "timeline of two read-modify-write cycles"}]}
    e = {"chunk": "c03", "role": "mechanism", "brief": "Teach the lost update.", "teach": {"analogy": "two editors saving one file"},
         "skills": ["faithful-coverage"], "visuals": ["timeline of the race"]}
    b = brief_text(e, design)
    for want in ("The reader: Knows SQL", "goal: Predict", "seat booking", "use it for this section's concrete case",
                 "role: mechanism", "Confront this misconception", "locks everything it reads", "callout analogy",
                 "Build for the reader to work through: lost update", "80-130%"):
        assert want in b, want
    assert "One layer down" not in b  # that one belongs to c02
    other = brief_text({"chunk": "c01", "role": "context", "brief": "Intro."}, design)
    assert "reuse it only where it helps" in other and "Visuals: none needed" in other


def test_reader_notes_from_the_probe_answers():
    from pipeline.harness.jobs import reader_text
    t = reader_text({"note": "backend engineer", "answers": [
        {"question": "Which are you comfortable with?", "purpose": "prerequisites", "answer": ["SQL", "indexes"]},
        {"question": "What happens if two people book the last seat?", "purpose": "misconception: lost update", "answer": "The database stops it"},
        {"question": "Skipped one", "answer": ""}]})
    assert "In the reader's own words: backend engineer" in t
    assert "-> SQL, indexes  [prerequisites]" in t and "[misconception: lost update]" in t and "Skipped one" not in t
    assert reader_text(None) == "" and reader_text("plain line") == "plain line"
