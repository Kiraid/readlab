from pipeline.ingest.blocks import (Block, attach_annotations, finalize_code, join_text, merge_code_across_pages,
                                    merge_paragraphs, page_blocks)
from pipeline.ingest.pdf_lines import Line

from helpers import CFG, line, mixed, span

M = 100  # body margin used by these tests


def kinds(blocks):
    return [b.kind for b in blocks]


def test_hyphenation_is_undone_only_before_lowercase():
    assert join_text("a recon-", "ciled state") == "a reconciled state"
    assert join_text("the Ingress-", "Nginx controller") == "the Ingress- Nginx controller"


def test_wrapped_lines_join_and_an_indent_starts_a_new_paragraph():
    lines = [line("First paragraph runs onto", M, 0), line("a second line.", M, 13),
             line("Second paragraph.", M + 16, 26)]
    blocks, _ = page_blocks(lines, CFG, M)
    assert kinds(blocks) == ["para", "para"]
    assert blocks[0].text == "First paragraph runs onto a second line."
    assert blocks[1].meta["indented"] is True


def test_inline_code_renders_in_backticks():
    blocks, _ = page_blocks([mixed(1, 0, ("Run", M, "body"), ("kubectl get ing", M + 20, "code"),
                                   ("to list them.", M + 100, "body"))], CFG, M)
    assert blocks[0].text == "Run `kubectl get ing` to list them."


def test_code_block_keeps_indentation_and_blank_lines():
    lines = [line("spec:", M, 0, "code", 8), line("rules:", M + 9.6, 10, "code", 8),
             line("- host: x", M + 9.6, 30, "code", 8)]
    blocks, _ = page_blocks(lines, CFG, M)
    assert kinds(blocks) == ["code"]
    finalize_code(blocks[0])
    assert blocks[0].text == "spec:\n  rules:\n\n  - host: x"


def test_callout_collects_its_indented_continuation_lines():
    lines = [mixed(1, 0, ("NOTE", M + 12, "label", 8.5), ("Wait a few seconds", M + 40, "body")),
             line("and try again.", M + 12, 12), line("Back to prose.", M, 40)]
    blocks, _ = page_blocks(lines, CFG, M)
    assert kinds(blocks) == ["callout", "para"]
    assert blocks[0].meta["label"] == "NOTE"
    assert blocks[0].text == "Wait a few seconds and try again."


def test_table_rows_follow_the_caption_and_columns_come_from_the_data():
    caption = Line(1, [span("Table 1.2", M, 0, "label", 9), span("Matching rules", M + 50, 0, "label", 9, lead=1)])
    header = Line(1, [span("Path", 130, 14, "label", 9), span("Meaning", 300, 14, "label", 9)])
    row1 = mixed(1, 28, ("Exact", M, "code"), ("must match exactly", 210, "body"))
    row1b = line("including case", 210, 40)
    row2 = mixed(1, 54, ("Prefix", M, "code"), ("element-wise prefix", 210, "body"))
    prose = line("After the table the text continues at the margin for a while.", M, 80)
    blocks, _ = page_blocks([caption, header, row1, row1b, row2, prose], CFG, M)
    assert kinds(blocks) == ["table", "para"]
    t = blocks[0].meta
    assert t["header"] == ["Path", "Meaning"]
    assert t["rows"] == [["`Exact`", "must match exactly including case"], ["`Prefix`", "element-wise prefix"]]


def test_listing_continued_on_next_page_keeps_its_indentation():
    # page 1 margin 93, page 2 margin 102: the continuation must be re-based on its own margin
    p1 = page_blocks([line("spec:", 93, 0, "code", 8, page=1), line("rules:", 102.6, 10, "code", 8, page=1)], CFG, 93)[0]
    p2 = page_blocks([line("host: x", 121.2, 0, "code", 8, page=2)], CFG, 102)[0]
    (code,) = merge_code_across_pages(p1 + p2)
    finalize_code(code)
    assert code.text == "spec:\n  rules:\n    host: x"


def test_paragraph_interrupted_by_a_figure_is_rejoined():
    blocks = [Block("para", "The proxy forwards the request to", page=1),
              Block("figure", "A figure", page=1),
              Block("para", "one of the pods.", page=2, meta={"indented": False}),
              Block("para", "Next paragraph.", page=2, meta={"indented": True})]
    out = merge_paragraphs(blocks)
    assert [b.text for b in out if b.kind == "para"] == ["The proxy forwards the request to one of the pods.",
                                                         "Next paragraph."]


def test_annotations_attach_to_the_nearest_code_line():
    lines = [line("kind: Service", M, 0, "code", 8), line("metadata:", M, 10, "code", 8),
             line("name: kiada", M + 9.6, 20, "code", 8)]
    blocks, _ = page_blocks(lines, CFG, M)
    finalize_code(blocks[0])
    frag = [{"page": 1, "top": 19, "bottom": 28, "x0": 250, "size": 9, "text": "The Service name"}]
    orphans = attach_annotations(blocks, frag)
    assert orphans == []
    assert blocks[0].meta["annotations"] == [{"line": 3, "text": "The Service name"}]
