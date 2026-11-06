from pipeline.ingest.pdf_lines import words_to_lines


def w(text, x0, x1, top, size, font):
    return {"text": text, "x0": x0, "x1": x1, "top": top, "bottom": top + size, "size": size, "fontname": "ABCDEF+" + font}


def role_of(font, size):
    return {"Mono": "code", "Demi": "label", "Arial": "drop"}.get(font, "body")


def test_small_caps_glue_back_into_one_word():
    words = [w("C", 10, 16, 0, 9.5, "Demi"), w("REATING", 16.1, 50, 1.9, 7.6, "Demi"),
             w("I", 55, 58, 0, 9.5, "Demi"), w("NGRESS", 58.1, 90, 1.9, 7.6, "Demi")]
    lines = words_to_lines(words, role_of, page=1)
    assert len(lines) == 1
    assert lines[0].plain == "CREATING INGRESS"


def test_inline_code_shares_the_baseline_with_prose():
    words = [w("run", 0, 15, 0, 10, "Serif"), w("kubectl", 18, 51.6, 2, 8, "Mono"), w("now", 54, 70, 0, 10, "Serif")]
    lines = words_to_lines(words, role_of, page=1)
    assert len(lines) == 1
    assert [s.role for s in lines[0].spans] == ["body", "code", "body"]


def test_monospace_gaps_become_the_right_number_of_spaces():
    words = [w("NAME", 0, 19.2, 0, 8, "Mono"), w("CLASS", 33.6, 57.6, 0, 8, "Mono")]
    (line,) = words_to_lines(words, role_of, page=1)
    assert line.plain == "NAME   CLASS"


def test_dropped_fonts_never_reach_a_line():
    words = [w("figure", 0, 30, 0, 7, "Arial"), w("text", 0, 20, 50, 10, "Serif")]
    lines = words_to_lines(words, role_of, page=1)
    assert [ln.plain for ln in lines] == ["text"]
