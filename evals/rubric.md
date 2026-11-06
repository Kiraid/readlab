# Judge rubric

You are judging one section of an interactive study page against the source snippet it was written from.
You get: the source text, the case's brief and ideas, the section file, and the built page (a screenshot or
the page itself). The scripts have already checked format, copying and listings; don't re-check those.

There is no single right design. A timeline, a stepper and a lab can all be good answers to the same
snippet. Judge whether the choices made **work**, not whether they match the ideas.

Score each criterion 1–5 and give one sentence of reason each.

For **faithful**, read the source paragraph by paragraph next to the section. Padding counts as hard as
omission: a section that adds two paragraphs of the writer's own explanation loses as much as one that drops
two of the author's. The validator's `paragraph` and `budget` warnings point at likely gaps and padding; check
them, don't trust them blindly.

| Criterion | 5 means | 1 means |
|---|---|---|
| **faithful** | nothing cut, nothing added, same order, same depth: every paragraph's point, example, number and caveat is there and correct, each given the weight the author gave it; no explanations, background or asides the author didn't write (one short clarification the brief asked for is fine) | points missing, compressed or wrong; or padded with explanation, background or "why it matters" notes the source doesn't have; or facts not in the source |
| **clear** | a reader new to the topic gets it on first read; the key mechanism is explained, not just named | dense, vague, or assumes what it should teach |
| **visual** | the diagrams show the mechanism (not decoration); labels readable; steps tell a story | no visual where one was obviously needed, or visuals that confuse |
| **interactive** | the lab/terminal/quiz makes the reader *do* the thing the section is about; quizzes test understanding | interaction is filler, or trivia quizzes |
| **polish** | it reads and looks like a finished page: consistent terms, good pacing, nothing awkward | rough: repetition, odd ordering, broken flow |

Then: **overall** 1–5, and the single change that would most improve the section.

Return JSON:
`{"faithful": n, "clear": n, "visual": n, "interactive": n, "polish": n, "overall": n, "reasons": {...}, "top_fix": "..."}`
