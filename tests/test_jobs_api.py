"""The pipeline API end to end, in dry-run mode (stub model replies, no cost): upload a real PDF, pick a chapter,
run the whole graph, and read back status, ledger and sections. Needs a local book PDF, so it is opt-in."""
import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.backend import library
from app.backend.main import app
from pipeline.harness import jobs
from pipeline.ingest.config import ROOT

PDF = ROOT / "sources" / "ostep" / "ostep.pdf"
pytestmark = pytest.mark.skipif(not (os.environ.get("ITB_INTEGRATION") and PDF.exists()), reason="set ITB_INTEGRATION=1 (needs sources/ostep/ostep.pdf)")


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(jobs, "UPLOADS", tmp_path / "uploads")
    monkeypatch.setattr(jobs, "JOBS", tmp_path / "jobs")
    monkeypatch.setattr(library, "JOBS", tmp_path / "jobs")  # the library lists runs from the same folder
    return TestClient(app)


def test_upload_pick_chapter_run_dry(client):
    r = client.post("/api/uploads", files={"file": ("ostep.pdf", PDF.read_bytes(), "application/pdf")})
    assert r.status_code == 200, r.text
    up = r.json()
    titles = [c["title"] for c in up["chapters"]]
    assert "Scheduling: Introduction" in titles and titles[-1].startswith("Whole document")
    assert not any(t.lower().startswith(("preface", "contents")) for t in titles)
    ch = next(c for c in up["chapters"] if c["title"] == "Scheduling: Introduction")

    job = client.post("/api/jobs", json={"upload_id": up["id"], "chapter": ch["selector"], "options": {"dry_run": True}}).json()
    for _ in range(240):
        s = client.get(f"/api/jobs/{job['id']}").json()
        if s["status"].get("stage") in ("done", "error"):
            break
        time.sleep(0.5)
    assert s["status"]["stage"] == "done", s["status"]
    assert len(s["chunks"]) >= 5
    assert set(s["nodes"]) >= {"digest", "plan", "write", "judge"}
    assert s["nodes"]["digest"]["calls"] == len(s["chunks"]) and s["nodes"]["plan"]["calls"] == 1
    assert all(c["digested"] and c["state"] in ("pass", "fail") and c["judge"] for c in s["chunks"])
    stages = [e["stage"] for e in s["events"]]
    assert stages[0] == "ingest" and stages[-1] == "done"
    detail = client.get(f"/api/jobs/{job['id']}/sections/{s['chunks'][0]['id']}").json()
    assert detail["markdown"].startswith("---") and detail["plan"]["brief"] == "Dry run brief."
    assert client.get(f"/api/jobs/{job['id']}/sections/../x").status_code == 404
    assert s["page"]["ok"] and s["page"]["url"]                     # the build step made one chapter page
    assert client.get(s["page"]["url"]).text.lstrip().lower().startswith("<!doctype html")
    assert any(c["url"] == s["page"]["url"] for b in client.get("/api/books").json() if b["id"].startswith("upload-")
               for c in client.get(f"/api/books/{b['id']}").json()["chapters"])  # and the library lists it
    assert client.post("/api/uploads", files={"file": ("x.txt", b"hello", "text/plain")}).status_code == 400


def test_errors_the_judge_finds_are_corrected_and_judged_again(client, monkeypatch):
    """Dry run with a judge that flags one error until the section says 'corrected', and a corrector that fixes it."""
    import json

    from pipeline.llm import core

    up = client.post("/api/uploads", files={"file": ("ostep.pdf", PDF.read_bytes(), "application/pdf")}).json()
    ch = next(c for c in up["chapters"] if c["title"] == "Scheduling: Introduction")
    jobs.install_dry_run()

    def judge(c):
        bad = "Dry run, corrected:" not in c.user
        return json.dumps({"faithful": 3 if bad else 5, "clear": 4, "visual": 4, "interactive": 4, "polish": 4, "overall": 3 if bad else 5,
                           "reasons": {}, "top_fix": "", "errors": [{"where": "Dry run: no model", "problem": "stub error", "fix": "say corrected"}] if bad else []})
    correct = lambda c: json.dumps({"edits": [{"find": "Dry run: no model was called", "replace": "Dry run, corrected: no model was called"}]})  # noqa: E731
    install = jobs.install_dry_run

    def install_with_ours():  # starting a dry-run job reinstalls the default stubs; put ours back on top
        install()
        core.REPLAY.update({"judge": judge, "correct": correct})
    monkeypatch.setattr(jobs, "install_dry_run", install_with_ours)
    monkeypatch.setattr(core, "REPLAY", dict(core.REPLAY))  # undone after the test, so other tests see the defaults

    job = client.post("/api/jobs", json={"upload_id": up["id"], "chapter": ch["selector"], "options": {"dry_run": True}}).json()
    for _ in range(240):
        s = client.get(f"/api/jobs/{job['id']}").json()
        if s["status"].get("stage") in ("done", "error"):
            break
        time.sleep(0.5)
    assert s["status"]["stage"] == "done", s["status"]
    assert all(c["judge"]["corrected"] == 1 and c["judge"]["overall"] == 5 and c["judge"]["errors_left"] == 0 for c in s["chunks"]), \
        ([c["judge"] for c in s["chunks"]][:2], [e["msg"] for e in s["events"] if e["stage"] == "correct"][:4])
    assert s["nodes"]["correct"]["calls"] == len(s["chunks"]) and s["nodes"]["judge"]["calls"] == 2 * len(s["chunks"])
    d = client.get(f"/api/jobs/{job['id']}/sections/{s['chunks'][0]['id']}").json()
    assert "Dry run, corrected:" in d["markdown"] and d["judge"]["correction"]["before"]["overall"] == 3
    assert any(e["stage"] == "correct" and "corrected 1 error" in e["msg"] for e in s["events"])
