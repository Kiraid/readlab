# faithful-coverage

The page should let the reader skip re-reading the section, so it must carry everything the section
carries, and nothing it doesn't. The author's explanation is the source of truth: you retell it, at a
moderate pace, in your own sentences.

**Cover, in the source's order and at its depth:** go paragraph by paragraph. Each paragraph's point,
example, number, caveat and aside appears, in the same order; a paragraph the author develops gets a
paragraph, a remark in passing gets a sentence. That includes every concept and definition; every field,
flag, default and limit; every listing (as `:::code`, highlighting the lines the book annotates); every
command and its output (as `:::term`, or a `:::snippet` for output the shell can't produce); every table
(same rows); every figure (as your own diagram of the same idea, never a redraw of the book's layout);
every note, tip, warning and sidebar (as a callout); "at the time of writing" caveats and version notes;
the author's own examples, analogies and jokes (in your words).

**Don't summarise, compress or skip.** A list of three reasons stays three reasons; a worked example keeps
all its steps and numbers. A diagram or quiz never replaces a paragraph: the prose says it too.

**Don't add.** No explanations, background, comparisons with other chapters or "why it matters" notes the
author didn't give. At most one short clarification per section, and only where the brief asks for one.
Never add facts that aren't in the source (no version numbers, dates, vendor comparisons or product news
from your own knowledge). Padding counts as hard against the page as omission.
This rule is about prose. Diagrams, timelines, labs, terminals and quizzes are not additions: they show
what the author explains, and every section still gets the ones its mechanism needs.

**Write it in your own sentences.** Never reuse the source's sentences or lightly reword them (swapping a
word or two still trips the copy check at eight shared words in a row). Build each sentence yourself from
the idea: change the structure, not just the vocabulary. Technical terms, field names, commands and tool
output stay verbatim.

**Length follows the source.** Your prose should be 85–115% of the source's prose word count (quizzes and
recaps don't count). Below that you have probably cut something; above it you are padding.

Checklist before you finish:
- walk the source paragraph by paragraph: each one's point, example, numbers and caveats are on the page, in order
- nothing on the page that the author didn't say (beyond one clarification the brief asked for)
- every listing, command, table and figure from the brief's inventory appears once
- numbers, names and defaults match the source exactly
- nothing important is only in a diagram; the prose says it too
- no sentence of yours follows a source sentence word for word
- prose length about the same as the source's (85–115%)
