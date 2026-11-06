import os

import pytest

from pipeline.ingest.blocks import Block
from pipeline.ingest.chunk import make_chunks
from pipeline.ingest.features import commands, listing_file, term_candidates, yaml_summary
from pipeline.ingest.outline import Entry, chapter_range
from pipeline.ingest.sections import Section, assign_sections

from helpers import CFG

OUTLINE = [Entry(0, "Part 3", 300), Entry(1, "12 Using Ingress", 421), Entry(2, "12.1 Introducing Ingresses", 422),
           Entry(3, "12.1.1 The object", 422), Entry(2, "12.2 Creating Ingresses", 426),
           Entry(1, "13 Gateway API", 450)]


def test_chapter_range_stops_at_the_next_chapter():
    rng = chapter_range(OUTLINE, "12", 690)
    assert (rng.first_page, rng.last_page) == (421, 449)
    assert [e.number for e in rng.sections] == ["12.1", "12.1.1", "12.2"]


def test_headings_open_outline_sections_and_unknown_headings_become_subheadings():
    rng = chapter_range(OUTLINE, "12", 690)
    blocks = [Block("heading", "Using Ingress"), Block("para", "intro"), Block("heading", "12.1Introducing Ingresses"),
              Block("heading", "This chapter covers"), Block("heading", "12.1.1 The object"), Block("para", "x"),
              Block("heading", "12.2 Creating Ingresses"), Block("heading", "Summary"), Block("item", "s")]
    sections, warnings = assign_sections(blocks, rng, CFG)
    assert [s.id for s in sections] == ["12", "12.1", "12.1.1", "12.2", "12.summary"]
    assert sections[1].blocks[0].kind == "subheading"
    assert warnings == []


def para(n_chars):
    return Block("para", "x" * n_chars)


def test_short_parent_intro_is_carried_into_its_first_child_and_big_sections_split():
    sections = [Section("12.2", "Parent", 2, [para(200)]),
                Section("12.2.1", "Child", 3, [para(2000)]),
                Section("12.2.2", "Big", 3, [para(6000), para(6000), para(6000)])]
    chunks = make_chunks(sections, min_tokens=250, max_tokens=3000)
    assert [c.section_ids for c in chunks] == [["12.2", "12.2.1"], ["12.2.2"], ["12.2.2"]]
    assert all(c.tokens <= 3100 for c in chunks)


def test_commands_count_their_output_and_join_continuations():
    code = Block("code", "$ kubectl get ing\nNAME  HOSTS\nkiada  kiada.example.com\n$ curl \\\n  -k https://x\nok")
    assert commands([code]) == [{"cmd": "kubectl get ing", "output_lines": 2}, {"cmd": "curl -k https://x", "output_lines": 1}]


def test_listing_file_comes_from_inline_code_in_the_text_before_it():
    blocks = [Block("para", "The manifest is in `Chapter12/ing.kiada.yaml` in the repo."), Block("code", "kind: Ingress")]
    assert listing_file(blocks, 1) == "ing.kiada.yaml"


def test_yaml_summary_lists_kinds_and_names():
    assert yaml_summary("kind: Service\napiVersion: v1\nmetadata:\n  name: kiada\n---\nkind: Pod\nmetadata:\n  name: p") == [
        {"kind": "Service", "apiVersion": "v1", "name": "kiada"}, {"kind": "Pod", "apiVersion": None, "name": "p"}]


def test_excerpted_manifest_still_parses():
    text = "kind: Ingress\nmetadata:\n  name: x\nspec:\n  ...\n  rules: []"
    assert yaml_summary(text) == [{"kind": "Ingress", "apiVersion": None, "name": "x"}]


def test_sentence_initial_capitals_are_not_terms():
    c = term_candidates("Kubernetes runs pods. The IngressClass picks a controller run by Kubernetes. Use `kubectl`.")
    assert c["IngressClass"] == 1 and c["kubectl"] == 1 and c["Kubernetes"] == 1 and "The" not in c


@pytest.mark.skipif(not os.environ.get("ITB_INTEGRATION"), reason="set ITB_INTEGRATION=1 (needs the local KiA PDF, ~1 min)")
def test_kia_chapter_12_matches_the_book_outline():
    from pipeline.ingest.config import load_book
    from pipeline.ingest.run import ingest_chapter

    res = ingest_chapter(load_book("books/kia/book.yaml"), "12")
    ids = [s.id for s in res["sections"]]
    assert res["warnings"] == []
    assert ids[:3] == ["12", "12.1", "12.1.1"] and ids[-1] == "12.summary" and len(ids) == 23
    listings = [l for c in res["chunks"] for l in c["features"]["listings"]]
    assert len(listings) == 15 and all(l["yaml"] for l in listings)
