"""Search across a reader's own library: documents, chapters, and the text of every section they can read.

Full-text (Postgres tsvector, GIN-indexed) with prefix matching, so results come as you type, plus trigram
similarity on titles for typos ("kubernets").
"""
from __future__ import annotations

import html
import re

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from .auth import current_user
from .db import get_db
from .models import User

router = APIRouter(tags=["search"])
SEL_ON, SEL_OFF = "\x02", "\x03"


def tsquery(q: str) -> tuple[str, dict]:
    """Every term as a prefix, matched stemmed (english) or as written (simple): "isolat" finds "isolation", which
    english indexes as "isol"."""
    terms = re.findall(r"[a-z0-9]+", q.lower())[:8]
    sql = " && ".join(f"(to_tsquery('english', :t{i}) || to_tsquery('simple', :t{i}))" for i in range(len(terms)))
    return sql, {f"t{i}": f"{t}:*" for i, t in enumerate(terms)}


def highlight(fragment: str) -> str:
    """ts_headline marks matches with control characters; escape the text, then turn those into <mark>."""
    return html.escape(fragment).replace(SEL_ON, "<mark>").replace(SEL_OFF, "</mark>")


@router.get("/api/search")
def search(q: str = "", user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    q = q.strip()[:200]
    tsq, terms = tsquery(q)
    if len(q) < 2 or not tsq:
        return {"q": q, "documents": [], "chapters": [], "passages": []}
    like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    p = {"u": user.id, "q": q, "like": like, **terms}
    docs = db.execute(text(f"""
        SELECT d.id, d.kind, d.title, d.subtitle, d.authors, d.has_cover, d.updated_at,
               greatest(ts_rank(d.search_tsv, ({tsq})), similarity(d.title, :q)) AS score
        FROM documents d
        WHERE d.owner_id = :u AND (d.search_tsv @@ ({tsq}) OR d.title % :q OR d.title ILIKE :like)
        ORDER BY score DESC LIMIT 6"""), p).mappings().all()
    chapters = db.execute(text(f"""
        SELECT c.id, c.number, c.title, c.status, d.id AS document_id, d.title AS document_title, d.kind,
               greatest(ts_rank(c.search_tsv, ({tsq})), similarity(c.title, :q)) AS score
        FROM chapters c JOIN documents d ON d.id = c.document_id
        WHERE d.owner_id = :u AND (c.search_tsv @@ ({tsq}) OR c.title % :q OR c.title ILIKE :like)
        ORDER BY (c.status = 'ready') DESC, score DESC LIMIT 8"""), p).mappings().all()
    passages = db.execute(text(f"""
        SELECT s.chapter_id, s.part, s.anchor, s.number, s.title, c.number AS chapter_number, c.title AS chapter_title,
               d.id AS document_id, d.title AS document_title, d.kind,
               ts_headline('simple', s.body, ({tsq}),
                           'StartSel={SEL_ON}, StopSel={SEL_OFF}, MaxWords=30, MinWords=14, MaxFragments=1') AS snippet
        FROM (SELECT cs.*, ts_rank_cd(cs.tsv, ({tsq})) AS rank
              FROM content_sections cs JOIN chapters c2 ON c2.id = cs.chapter_id JOIN documents d2 ON d2.id = c2.document_id
              WHERE d2.owner_id = :u AND cs.tsv @@ ({tsq})
              ORDER BY rank DESC LIMIT 12) s
        JOIN chapters c ON c.id = s.chapter_id JOIN documents d ON d.id = c.document_id
        ORDER BY s.rank DESC"""), p).mappings().all()
    return {
        "q": q,
        "documents": [{"id": r["id"], "kind": r["kind"], "title": r["title"], "subtitle": r["subtitle"], "authors": r["authors"] or [],
                       "cover": f"/api/documents/{r['id']}/cover?v={int(r['updated_at'].timestamp())}" if r["has_cover"] else None}
                      for r in docs],
        "chapters": [{"id": r["id"], "number": r["number"], "title": r["title"], "status": r["status"], "document_id": r["document_id"],
                      "document_title": r["document_title"], "kind": r["kind"]} for r in chapters],
        "passages": [{"chapter_id": r["chapter_id"], "part": r["part"], "anchor": r["anchor"], "number": r["number"],
                      "title": r["title"], "chapter_number": r["chapter_number"], "chapter_title": r["chapter_title"],
                      "document_id": r["document_id"], "document_title": r["document_title"], "kind": r["kind"],
                      "snippet": highlight(r["snippet"] or "")} for r in passages],
    }
