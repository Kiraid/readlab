# faithful-coverage

The page should let the reader skip re-reading the section, so it must carry everything the section carries,
and make it land. The author's explanation is the backbone: you retell it in your own sentences, and teach
around it.

**Cover everything the author says.** Each paragraph's point, example, number, caveat and aside appears, with
the weight the author gives it: a paragraph the author develops gets real room, a remark in passing gets a
sentence. That includes every concept and definition; every field, flag, default and limit; every listing (as
`:::code`, highlighting the lines the book annotates); every command and its output (as `:::term`, or a
`:::snippet` for output the shell can't produce); every table (same rows); every figure (as your own diagram of
the same idea, never a redraw of the book's layout); every note, tip, warning and sidebar (as a callout);
"at the time of writing" caveats and version notes; the author's own examples, analogies and jokes (in your
words).

**Order for understanding.** Follow the author's line of argument. Within the section you may reorder, merge or
split points when that makes the reasoning easier to follow: a concrete case before its general rule, a premise
before the conclusion that needs it. Never change what the author concludes.

**Don't summarise, compress or skip.** A list of three reasons stays three reasons; a worked example keeps all
its steps and numbers. A diagram or quiz never replaces a paragraph: the prose says it too.

**Add only labelled teaching, never facts.** Your own example, analogy or layer-down note goes in
`:::callout example`, `:::callout analogy` or `:::callout underneath`, and only where it makes one of the
author's points land. Never add facts about the world the source doesn't give (versions, dates, vendors,
product behaviour, numbers from memory); toy values inside your own example are fine. No generic "why it
matters" notes, no restating, no filler: padding counts as hard against the page as omission.

**Write it in your own sentences.** Never reuse the source's sentences or lightly reword them (swapping a word or
two still trips the copy check at eight shared words in a row). Build each sentence yourself from the idea:
change the structure, not just the vocabulary. Technical terms, field names, commands and tool output stay
verbatim.

**Length follows the source.** Your retelling (without the labelled callouts, quizzes and recaps) is about
80–130% of the source's prose word count. Below that you have probably cut something; far above it you are
padding.

Checklist before you finish:
- walk the source paragraph by paragraph: each one's point, example, numbers and caveats are on the page
- the author's conclusions are unchanged; anything of yours is in a labelled callout
- every listing, command, table and figure from the brief's inventory appears once
- numbers, names and defaults match the source exactly
- nothing important is only in a diagram; the prose says it too
- no sentence of yours follows a source sentence word for word
