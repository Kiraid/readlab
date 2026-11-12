from collections import Counter

from pipeline.ingest.auto import _letters, rules_from_stats


def role(rules, font, size):
    return next((r.role for r in rules if r.matches(font, size)), "drop")


HIST = Counter({("Serif-Roman", 10.0): 5000, ("Mono", 8.0): 800, ("Sans-DemiItal", 10.5): 120, ("Sans-DemiItal", 12.5): 30,
                ("Sans-Demi", 8.5): 200, ("Notes-BoldCond", 9.0): 400, ("Serif-Italic", 10.0): 300})


def test_size_rules_alone_miss_headings_set_near_body_size():
    rules, body = rules_from_stats(HIST)
    assert body == 10.0
    assert role(rules, "Sans-DemiItal", 10.5) == "body"      # a subsection heading read as prose
    assert role(rules, "Sans-DemiItal", 12.5) == "heading"


def test_outline_titles_captions_and_code_neighbours_teach_the_marker_fonts():
    marks = {"heads": Counter({("Sans-DemiItal", 10.5): 30, ("Sans-DemiItal", 12.5): 8, ("Sans-Demi", 7.6): 1,
                               ("Serif-Italic", 10.0): 5}),
             "labels": Counter({("Sans-Demi", 8.5): 20, ("Serif-Italic", 10.0): 9}),
             "beside": Counter({"Notes-BoldCond": 380, "Serif-Roman": 40}),
             "words": Counter({"Notes-BoldCond": 400, "Serif-Roman": 5000})}
    rules, _ = rules_from_stats(HIST, marks)
    assert role(rules, "Sans-DemiItal", 10.5) == "heading"
    assert role(rules, "Sans-Demi", 7.6) == "label"           # one stray title match is not enough for a heading
    assert role(rules, "Sans-Demi", 8.5) == "label"
    assert role(rules, "Notes-BoldCond", 9.0) == "annotation"
    assert role(rules, "Serif-Italic", 10.0) == "body"        # the body's own italic stays prose (captions, emphasis)
    assert role(rules, "Mono", 8.0) == "code"
    assert role(rules, "Wingdings-Regular", 9.0) == "bullet"


def test_titles_compare_by_letters():
    assert _letters("14.1.1Creating a ReplicaSet") == _letters("14.1.1 Creating a ReplicaSet") == "creatingareplicaset"
    assert _letters("Chapter 7. Transactions") == "transactions"
