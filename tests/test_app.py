import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.backend import library, main

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def tmp_library(tmp_path, monkeypatch):
    """A throwaway library: one book, one built chapter, one missing chapter."""
    ch = tmp_path / "ch1"
    (ch / "sections").mkdir(parents=True)
    (ch / "index.html").write_text('<section class="major" id="s1"></section><div class="quiz"></div>', encoding="utf-8")
    (ch / "sections" / "a.html").write_text('<div class="term"></div><figure class="diagram"></figure>', encoding="utf-8")
    (tmp_path / "secret.txt").write_text("nope", encoding="utf-8")
    lib = tmp_path / "library.yaml"
    lib.write_text(f"""books:
  - id: demo
    title: Demo Book
    chapters:
      - {{id: "1", title: One, path: "{ch.as_posix()}"}}
      - {{id: "2", title: Two, path: "{(tmp_path / 'missing').as_posix()}"}}
""", encoding="utf-8")
    monkeypatch.setattr(main, "load_library", lambda: library.load_library(lib, tmp_path / "jobs"))
    yield


def test_books_list_with_ready_counts():
    r = client.get("/api/books")
    assert r.status_code == 200
    [b] = r.json()
    assert (b["id"], b["chapter_count"], b["ready_count"]) == ("demo", 2, 1)


def test_book_detail_has_stats_and_reader_urls():
    b = client.get("/api/books/demo").json()
    one, two = b["chapters"]
    assert one["available"] and not two["available"]
    assert one["stats"] == {"sections": 1, "quizzes": 1, "terminals": 1, "diagrams": 1, "labs": 0}
    assert one["url"] == "/read/demo/1/"
    assert client.get("/api/books/nope").status_code == 404


def test_chapter_files_are_served_and_traversal_is_blocked():
    assert client.get("/read/demo/1/").text.startswith("<section")
    assert client.get("/read/demo/1/sections/a.html").status_code == 200
    assert client.get("/read/demo/1", follow_redirects=False).status_code == 307
    assert client.get("/read/demo/1/../secret.txt").status_code == 404
    assert client.get("/read/demo/1/%2e%2e/secret.txt").status_code == 404
    assert client.get("/read/demo/2/").status_code == 404


def test_finished_pipeline_runs_are_listed_as_chapters(tmp_path):
    jobs = tmp_path / "jobs"
    for jid, passes in (("20261101-1", True), ("20261102-2", False)):
        jd = jobs / jid
        (jd / "page" / "dist").mkdir(parents=True)
        (jd / "page" / "dist" / "index.html").write_text('<section class="major" id="s"></section>', encoding="utf-8")
        (jd / "job.json").write_text(json.dumps({"upload": "u1", "file": "Some Book, 2nd Edition (Ann Lee, Bo Ma) (site.example)-10-20.pdf",
                                                 "chapter_title": "3 Things", "chapter_id": "3", "started": 0}), encoding="utf-8")
        (jd / "report.json").write_text(json.dumps({"sections": {"c01": {"pass": passes}}, "judges": {"c01": {"overall": 4}},
                                                    "cost_usd": 0.1}), encoding="utf-8")
    (jobs / "20261103-3" / "page").mkdir(parents=True)  # a run whose page was never built is not listed
    [book] = library.job_books(jobs)
    assert (book.id, book.title, book.authors) == ("upload-u1", "Some Book", ["Ann Lee", "Bo Ma"])
    assert [c.id for c in book.chapters] == ["3-02-2", "3-01-1"]  # chapter number + run tag, newest first
    assert all(c.available and c.made == "pipeline" for c in book.chapters)
    assert "0/1 sections pass" in book.chapters[0].summary and "judge 4.0/5" in book.chapters[0].summary
