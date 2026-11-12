"""The app's API against a real Postgres (readlab_test): accounts, privacy between users, uploads, the word
allowance, reading progress, search, the chapter pages, and the queue. Skipped when no database is reachable."""
import io
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from dbhelpers import make_user, prepare_database


@pytest.fixture(scope="module", autouse=True)
def database():
    prepare_database()


@pytest.fixture(autouse=True)
def data_dirs(tmp_path, monkeypatch):
    from app.backend import config
    from pipeline.harness import jobs as harness_jobs

    monkeypatch.setattr(config, "UPLOADS", tmp_path / "uploads")
    monkeypatch.setattr(config, "JOBS", tmp_path / "jobs")
    monkeypatch.setattr(harness_jobs, "UPLOADS", tmp_path / "uploads")


def client() -> TestClient:
    from app.backend.main import app

    return TestClient(app)


def email() -> str:
    return f"u{uuid.uuid4().hex[:8]}@example.test"


def blank_pdf(pages: int = 3, title: str = "A Short Paper") -> bytes:
    from pypdf import PdfWriter

    w = PdfWriter()
    for _ in range(pages):
        w.add_blank_page(612, 792)
    w.add_metadata({"/Title": title})
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def add_book(owner_email: str, tmp_path, words=(1000, 3000), ready=True):
    """A book with one chapter whose page has two parts, written straight to the database."""
    from app.backend.db import session
    from app.backend.indexing import _set_ready
    from app.backend.models import Chapter, Document, User

    page = tmp_path / f"page-{uuid.uuid4().hex[:6]}"
    (page / "parts").mkdir(parents=True)
    (page / "assets").mkdir()
    (page / "parts" / "01.html").write_text("<html><body><section class=\"major\" id=\"s1\"></section></body></html>", encoding="utf-8")
    (page / "parts" / "02.html").write_text("<html><body>two</body></html>", encoding="utf-8")
    (page / "assets" / "chapter.0123456789.js").write_text("1", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("nope", encoding="utf-8")
    with session() as db:
        owner = db.query(User).filter(User.email == owner_email).one()
        doc = Document(id=uuid.uuid4().hex[:20], owner_id=owner.id, title="Distributed Things", search_text="Distributed Things")
        ch = Chapter(position=1, number="7", title="Transactions", words=12000, selector="#3")
        doc.chapters = [ch]
        db.add(doc)
        db.flush()
        if ready:
            ch.parts = [{"n": 1, "file": "parts/01.html", "words": words[0], "sections": [{"id": "s1", "num": "7.1", "title": "Isolation"}]},
                        {"n": 2, "file": "parts/02.html", "words": words[1], "sections": [{"id": "s2", "num": "7.2", "title": "Skew"}]}]
            _set_ready(db, ch, page, None, [(1, "s1", "7.1", "Snapshot isolation", "Under snapshot isolation readers see one snapshot, so a < b holds <script>x</script>."),
                                            (2, "s2", "7.2", "Write skew", "Two transactions read the same rows and write different ones.")])
        db.commit()
        return doc.id, ch.id


# ---------------------------------------------------------------- accounts

def test_signup_signin_signout():
    c = client()
    e = email()
    u = make_user(c, e)
    assert u["role"] == "user" and not u["is_admin"]
    assert c.get("/api/auth/me").json()["email"] == e
    assert c.post("/api/auth/signup", json={"email": e.upper(), "password": "another-pass"}).status_code == 409
    assert c.post("/api/auth/signup", json={"email": email(), "password": "short"}).status_code == 422
    assert c.post("/api/auth/signout").status_code == 200
    assert c.get("/api/auth/me").status_code == 401
    assert c.post("/api/auth/signin", json={"email": e, "password": "wrong-password"}).status_code == 401
    assert c.post("/api/auth/signin", json={"email": e.upper(), "password": "correct-horse-1"}).status_code == 200
    assert c.get("/api/documents").status_code == 200


def test_everything_needs_a_session():
    c = client()
    for path in ("/api/documents", "/api/home", "/api/jobs", "/api/search?q=x", "/read/1/parts/01.html"):
        assert c.get(path).status_code == 401, path


# ---------------------------------------------------------------- documents

def test_upload_detects_an_article_and_dedupes():
    c = client()
    make_user(c, email())
    pdf = blank_pdf()
    r = c.post("/api/documents", files={"file": ("A Short Paper (Ann Lee, Bo Ma).pdf", pdf, "application/pdf")}, data={"kind": "auto"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["kind"] == "article" and d["title"] == "A Short Paper" and d["chapter_count"] == 1 and d["cover"]
    assert d["authors"] == ["Ann Lee", "Bo Ma"]
    assert c.get(d["cover"]).headers["content-type"] == "image/webp"
    again = c.post("/api/documents", files={"file": ("copy.pdf", pdf, "application/pdf")}).json()
    assert again["id"] == d["id"] and again["existing"]
    assert c.post("/api/documents", files={"file": ("x.txt", b"hello", "text/plain")}).status_code == 400
    assert [x["id"] for x in c.get("/api/documents?kind=article").json()] == [d["id"]]
    assert c.get("/api/documents?kind=book").json() == []
    assert c.patch(f"/api/documents/{d['id']}", json={"title": "Renamed", "authors": ["X"]}).json()["title"] == "Renamed"
    assert c.delete(f"/api/documents/{d['id']}").status_code == 200
    assert c.get(f"/api/documents/{d['id']}").status_code == 404


def test_other_users_see_nothing(tmp_path):
    a, b = client(), client()
    ea = email()
    make_user(a, ea)
    make_user(b, email())
    doc, ch = add_book(ea, tmp_path)
    assert a.get(f"/api/documents/{doc}").status_code == 200
    for path in (f"/api/documents/{doc}", f"/api/chapters/{ch}", f"/read/{ch}/parts/01.html", f"/api/documents/{doc}/cover"):
        assert b.get(path).status_code == 404, path
    assert b.put(f"/api/chapters/{ch}/progress", json={"part": 1}).status_code == 404
    assert b.post(f"/api/chapters/{ch}/generate", json={}).status_code == 404
    assert b.get("/api/search?q=snapshot").json()["passages"] == []
    assert b.get("/api/admin/overview").status_code == 403


# ---------------------------------------------------------------- pages, progress, search

def test_pages_get_the_bridge_and_stay_inside_their_folder(tmp_path):
    c = client()
    e = email()
    make_user(c, e)
    _, ch = add_book(e, tmp_path)
    r = c.get(f"/read/{ch}/parts/01.html")
    assert r.status_code == 200 and '<script src="/reader-bridge.js" defer></script></body>' in r.text
    assert "immutable" in c.get(f"/read/{ch}/assets/chapter.0123456789.js").headers["cache-control"]
    assert c.get(f"/read/{ch}/../secret.txt").status_code == 404
    assert c.get(f"/read/{ch}/%2e%2e/secret.txt").status_code == 404
    assert c.get("/reader-bridge.js").status_code == 200


def test_progress_is_a_share_of_the_whole_chapter(tmp_path):
    c = client()
    e = email()
    make_user(c, e)
    _, ch = add_book(e, tmp_path, words=(1000, 3000))
    p = c.put(f"/api/chapters/{ch}/progress", json={"part": 2, "anchor": "s2", "offset": 0.5}).json()
    assert p["percent"] == pytest.approx((1000 + 1500) / 4000) and p["furthest"] == p["percent"]
    back = c.put(f"/api/chapters/{ch}/progress", json={"part": 1, "anchor": "s1", "offset": 0}).json()
    assert back["percent"] == 0 and back["furthest"] == pytest.approx(0.625)  # the furthest point is kept
    view = c.get(f"/api/chapters/{ch}").json()
    assert view["chapter"]["progress"]["part"] == 1 and len(view["chapter"]["parts"]) == 2
    home = c.get("/api/home").json()
    assert home["continue"][0]["chapter"]["id"] == ch
    assert c.put(f"/api/chapters/{ch}/progress", json={"part": 99, "offset": 5}).json()["part"] == 2  # clamped


def test_search_matches_word_prefixes_and_escapes_snippets(tmp_path):
    c = client()
    e = email()
    make_user(c, e)
    doc, ch = add_book(e, tmp_path)
    r = c.get("/api/search?q=isolat").json()  # half a word: "isolation" is indexed as "isol" by the english stemmer
    assert [p["anchor"] for p in r["passages"]] == ["s1"]
    snip = r["passages"][0]["snippet"]
    assert "<mark>isolation</mark>" in snip and "a &lt; b" in snip and "<script>" not in snip
    assert r["chapters"] == [] or r["chapters"][0]["id"] == ch
    assert c.get("/api/search?q=distribted").json()["documents"][0]["id"] == doc  # a typo, via trigrams
    assert c.get("/api/search?q=write skew").json()["passages"][0]["part"] == 2
    assert c.get("/api/search?q=a").json()["passages"] == []


# ---------------------------------------------------------------- generating: allowance, options, queue

def test_readers_get_the_defaults_and_an_allowance(tmp_path, monkeypatch):
    from app.backend import config

    monkeypatch.setattr(config, "WORD_QUOTA", 20000)
    c = client()
    e = email()
    make_user(c, e)
    _, ch = add_book(e, tmp_path, ready=False)  # 12,000 words
    r = c.post(f"/api/chapters/{ch}/generate", json={"reader": {"note": "knows SQL"}, "options": {"dry_run": True, "budget": 50}})
    assert r.status_code == 200, r.text
    job = r.json()
    assert job["status"] == "queued" and job["label"] == "Waiting in the queue"
    full = c.get(f"/api/jobs/{job['id']}").json()
    assert "admin" not in full and "run" not in full  # no models, cost or events for readers
    assert c.post(f"/api/chapters/{ch}/generate", json={}).status_code == 409  # already queued
    _, ch2 = add_book(e, tmp_path, ready=False)
    r = c.post(f"/api/chapters/{ch2}/generate", json={})
    assert r.status_code == 429 and "allowance" in r.json()["detail"]
    assert c.get("/api/me/quota").json()["used"] == 12000

    from app.backend.db import session
    from app.backend.models import Job

    with session() as db:
        spec = db.get(Job, job["id"]).spec
    assert spec["budget"] == config.USER_BUDGET_USD and not spec["dry_run"]
    assert all(n["provider"] != "replay" for n in spec["nodes"].values()) and "knows SQL" in spec["reader"]
    assert c.post(f"/api/jobs/{job['id']}/cancel").json()["status"] == "cancelled"
    assert c.get("/api/me/quota").json()["used"] == 0  # cancelled jobs are not charged


def test_admins_choose_the_run_settings(tmp_path):
    c = client()
    e = email()
    make_user(c, e, admin=True)
    _, ch = add_book(e, tmp_path, ready=False)
    job = c.post(f"/api/chapters/{ch}/generate", json={"options": {"dry_run": True, "budget": 0.5, "write_model": "deepseek-v4-pro"}}).json()
    full = c.get(f"/api/jobs/{job['id']}").json()
    assert full["admin"]["dry_run"] and full["admin"]["budget"] == 0.5 and full["admin"]["models"]["write"] == "deepseek-v4-pro"
    assert c.get("/api/me/quota").json()["limit"] is None
    assert any(j["id"] == job["id"] for j in c.get("/api/admin/jobs").json())
    c.post(f"/api/jobs/{job['id']}/cancel")


def test_queue_claims_in_order_and_requeues_stale_jobs(tmp_path, monkeypatch):
    from app.backend import config
    from app.backend.db import session
    from app.backend.models import Job
    from app.backend.queue import claim, requeue_stale

    c = client()
    e = email()
    make_user(c, e, admin=True)
    ids = []
    for _ in range(2):
        _, ch = add_book(e, tmp_path, ready=False)
        ids.append(c.post(f"/api/chapters/{ch}/generate", json={"options": {"dry_run": True}}).json()["id"])
    with session() as db:  # anything queued by other tests goes first; cancel it so the order here is ours
        db.query(Job).filter(Job.status == "queued", Job.id.notin_(ids)).update({"status": "cancelled"})
        db.commit()
        first = claim(db, "w1")
        second = claim(db, "w2")
        assert (first.id, second.id) == tuple(ids) and claim(db, "w3") is None
        assert first.status == "running" and first.worker == "w1" and first.attempts == 1
        second.heartbeat_at = datetime.now(timezone.utc) - timedelta(seconds=config.STALE_AFTER_S + 5)
        db.commit()
        assert requeue_stale(db) == [second.id]
        db.refresh(second)
        assert second.status == "queued" and second.worker is None
        db.query(Job).filter(Job.id.in_(ids)).update({"status": "cancelled"})
        db.commit()


def test_progress_labels_never_go_backwards():
    from app.backend.queue import Tracker

    t = Tracker()
    t.feed("status", {"stage": "digest", "chunks": [{"id": "c1"}, {"id": "c2"}]})
    t.feed("event", {"stage": "digest", "chunk": "c1", "msg": "ok"})
    stage, p1, detail = t.snapshot()
    assert (stage, detail) == ("digest", "1 of 2 passages read")
    t.feed("status", {"stage": "write", "chunks": [{"id": "c1"}, {"id": "c2"}]})
    t.feed("event", {"stage": "write", "chunk": "c1", "msg": "writing"})
    assert t.snapshot()[2] == "0 of 2 sections written"
    for cid in ("c1", "c2"):
        t.feed("event", {"stage": "write", "chunk": cid, "msg": "pass · score 100"})
    assert t.snapshot()[0] == "judge"
    t.feed("event", {"stage": "judge", "chunk": "c1", "msg": "overall 4"})
    t.feed("event", {"stage": "write", "chunk": "c2", "msg": "pass"})  # a late write event does not flip the label back
    stage, p2, detail = t.snapshot()
    assert stage == "judge" and detail == "1 of 2 sections reviewed" and p2 > p1


def test_hand_built_library_still_reads():
    from app.backend.library import _authors, load_library

    books = load_library()
    assert books and all(ch.path for b in books for ch in b.chapters)
    assert _authors("Some Book (Ann Lee, Bo Ma) (site.example).pdf") == ["Ann Lee", "Bo Ma"]
