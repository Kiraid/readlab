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
    monkeypatch.setattr(main, "load_library", lambda: library.load_library(lib))
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
