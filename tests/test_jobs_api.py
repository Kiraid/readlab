"""The whole path in dry-run mode (stub model replies, no cost): upload a real PDF, queue a chapter, let a worker
drain the queue, and read the published chapter back: parts, search, progress events. Needs a local book PDF and
the test database, so it is opt-in."""
import json
import os
import uuid

import pytest
from fastapi.testclient import TestClient

from dbhelpers import make_user, prepare_database
from pipeline.ingest.config import ROOT

PDF = ROOT / "sources" / "ostep" / "ostep.pdf"
pytestmark = pytest.mark.skipif(not (os.environ.get("ITB_INTEGRATION") and PDF.exists()), reason="set ITB_INTEGRATION=1 (needs sources/ostep/ostep.pdf)")


@pytest.fixture
def client(tmp_path, monkeypatch):
    prepare_database()
    from app.backend import config
    from app.backend.main import app
    from pipeline.harness import jobs as harness_jobs

    monkeypatch.setattr(config, "UPLOADS", tmp_path / "uploads")
    monkeypatch.setattr(config, "JOBS", tmp_path / "jobs")
    monkeypatch.setattr(harness_jobs, "UPLOADS", tmp_path / "uploads")
    monkeypatch.setattr(harness_jobs, "JOBS", tmp_path / "jobs")
    c = TestClient(app)
    make_user(c, f"admin{uuid.uuid4().hex[:6]}@example.test", admin=True)
    return c


def queue_scheduling_chapter(c) -> tuple[int, str]:
    r = c.post("/api/documents", files={"file": ("ostep.pdf", PDF.read_bytes(), "application/pdf")}, data={"kind": "book"})
    assert r.status_code == 200, r.text
    doc = c.get(f"/api/documents/{r.json()['id']}").json()
    titles = [ch["title"] for ch in doc["chapters"]]
    assert "Scheduling: Introduction" in titles and not any(t.lower().startswith(("preface", "contents")) for t in titles)
    ch = next(x for x in doc["chapters"] if x["title"] == "Scheduling: Introduction")
    assert ch["number"] == "7" and ch["source_words"] > 2000  # the number printed above the title
    job = c.post(f"/api/chapters/{ch['id']}/generate", json={"options": {"dry_run": True}}).json()
    return ch["id"], job["id"]


def drain() -> None:
    from app.backend.worker import Worker

    Worker(1, drain=True).run()


def test_upload_queue_drain_publish(client):
    ch, jid = queue_scheduling_chapter(client)
    drain()
    job = client.get(f"/api/jobs/{jid}").json()
    assert job["status"] == "done" and job["progress"] == 1 and job["chapter"]["ready"], job.get("error")
    assert job["run"]["nodes"]["plan"]["calls"] == 1 and len(job["run"]["chunks"]) >= 5
    stages = [e["stage"] for e in job["events"]]
    assert stages[0] == "ingest" and stages[-1] == "done"
    view = client.get(f"/api/chapters/{ch}").json()
    parts = view["chapter"]["parts"]
    assert view["chapter"]["status"] == "ready" and parts and all(p["sections"] for p in parts)
    page = client.get(f"{view['base']}{parts[0]['file']}").text
    assert "/reader-bridge.js" in page and "../assets/chapter." in page
    assert client.get("/api/search?q=dry run").json()["passages"]  # the stub text is searchable
    stream = client.get(f"/api/jobs/{jid}/stream").text  # a finished job's stream says so and ends
    assert "event: state" in stream and "event: end" in stream


def test_errors_the_judge_finds_are_corrected_and_judged_again(client, monkeypatch):
    """Dry run with a judge that flags one error until the section says 'corrected', and a corrector that fixes it."""
    from pipeline.harness import jobs as harness_jobs
    from pipeline.llm import core

    def judge(c):
        bad = "Dry run, corrected:" not in c.user
        return json.dumps({"faithful": 3 if bad else 5, "clear": 4, "visual": 4, "interactive": 4, "polish": 4, "overall": 3 if bad else 5,
                           "reasons": {}, "top_fix": "", "errors": [{"where": "Dry run: no model", "problem": "stub error", "fix": "say corrected"}] if bad else []})
    correct = lambda c: json.dumps({"edits": [{"find": "Dry run: no model was called", "replace": "Dry run, corrected: no model was called"}]})  # noqa: E731
    install = harness_jobs.install_dry_run

    def install_with_ours():  # the worker reinstalls the default stubs for a dry run; put ours back on top
        install()
        core.REPLAY.update({"judge": judge, "correct": correct})
    monkeypatch.setattr(harness_jobs, "install_dry_run", install_with_ours)
    monkeypatch.setattr(core, "REPLAY", dict(core.REPLAY))  # undone after the test, so other tests see the defaults

    _, jid = queue_scheduling_chapter(client)
    drain()
    s = client.get(f"/api/jobs/{jid}").json()
    assert s["status"] == "done", s.get("error")
    chunks = s["run"]["chunks"]
    assert all(c["judge"]["corrected"] == 1 and c["judge"]["overall"] == 5 and c["judge"]["errors_left"] == 0 for c in chunks)
    assert s["run"]["nodes"]["correct"]["calls"] == len(chunks) and s["run"]["nodes"]["judge"]["calls"] == 2 * len(chunks)
    d = client.get(f"/api/admin/jobs/{jid}/sections/{chunks[0]['id']}").json()
    assert "Dry run, corrected:" in d["markdown"] and d["judge"]["correction"]["before"]["overall"] == 3
