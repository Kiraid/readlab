from evals.prepare import clip, merge_sections
from pipeline.prompts.assemble import system_prompt, user_prompt, writer_prompt
from pipeline.ingest.config import ROOT


def blk(kind, text, **meta):
    return {"kind": kind, "text": text, "page": 1, "top": 0.0, "bottom": 0.0, "x0": 0.0, "size": 10.0, "meta": meta}


EXTRACT = {"sections": [
    {"id": "3.1", "title": "First", "level": 2, "blocks": [blk("para", "alpha " * 40), blk("code", "a: 1", listing="3.1", saved_as="a.yaml")]},
    {"id": "3.2", "title": "Second", "level": 2, "blocks": [blk("para", "beta " * 400), blk("para", "gamma " * 400)]},
]}


def test_merge_keeps_order_and_marks_later_sections_as_subheadings():
    s = merge_sections(EXTRACT, ["3.1", "3.2"], "Both")
    assert s["id"] == "3.1" and s["title"] == "Both"
    assert [b["kind"] for b in s["blocks"]] == ["para", "code", "subheading", "para", "para"]
    assert s["blocks"][2]["text"] == "Second"


def test_clip_cuts_before_a_prose_block_and_never_drops_the_first():
    s = merge_sections(EXTRACT, ["3.1", "3.2"], None)
    kept = clip(s["blocks"], 600)
    assert [b["kind"] for b in kept] == ["para", "code", "subheading", "para"]
    assert clip(s["blocks"], None) == s["blocks"]


def test_system_prompt_is_the_whole_toolkit_and_stable():
    sp = system_prompt()
    assert sp == system_prompt()
    assert "# Format guide" in sp and ":::diagram flow" in sp
    for w in (ROOT / "engine" / "widgets").iterdir():
        assert f"# {w.name}" in sp, w.name
    assert "faithful-coverage" in sp and "os-cpu-scheduling" in sp


def test_user_prompt_has_source_files_shell_brief_and_output_rule():
    s = merge_sections(EXTRACT, ["3.1"], None)
    up = user_prompt(s, {"a.yaml": "a: 1\nb: 2"}, "basic", "Teach alpha.")
    assert up.index("<source>") < up.index("## Chapter files") < up.index("## Shell") < up.index("## Brief") < up.index("## Output")
    assert "  1  a: 1\n  2  b: 2" in up
    assert "give the output the source shows" in up
    p = writer_prompt(s, {}, "kubectl-ingress", "x")
    assert "Do not write output for them" in p["user"] and len(p["meta"]["system_sha"]) == 12
