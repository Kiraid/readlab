# Judge rubric

You are judging one section of an interactive study page against the source snippet it was written from.
You get: the source text, the case's brief and ideas, the section file, and the built page (a screenshot or
the page itself). The scripts have already checked format, copying and listings; don't re-check those.

There is no single right design. A timeline, a stepper and a lab can all be good answers to the same
snippet. Judge whether the choices made **work**, not whether they match the ideas.

Score each criterion 1–5 and give one sentence of reason each.

For **faithful**, read the source paragraph by paragraph next to the section. Every point of the author's must
be there and correct; the writer may reorder within the section and restructure sentences. The writer's own
teaching (an example, an analogy, one layer down) is allowed only in a labelled callout
(`:::callout example|analogy|underneath`) and only when it serves one of the author's points: judge whether it
is correct and consistent with the author. Unlabelled additions, padding, restating, and anything presented as a
fact about the world that the source doesn't say count as hard as omission. The validator's `paragraph` and
`budget` warnings point at likely gaps and padding; check them, don't trust them blindly.

| Criterion | 5 means | 1 means |
|---|---|---|
| **faithful** | every point, example, number and caveat of the author's is there and correct, with the author's weight and conclusions; additions are labelled, correct and earn their place | points missing, compressed or wrong; or padded with restating or unlabelled explanation; or facts not in the source |
| **clear** | this reader gets it on first read: concrete before abstract, one step at a time, the mechanism explained not just named, a likely wrong idea confronted where there is one | dense, vague, assumes what it should teach, or teaches what the reader already knows |
| **visual** | each visual shows a mechanism the reader can follow or work (a process, an interleaving, cases to switch between); labels readable | no visual where a mechanism obviously needed one; or decoration: a visual that only redraws the text (a timeline of dates, a toggle between two claims, a box diagram of an argument) scores 1–2 however well it renders |
| **interactive** | the lab/terminal/quiz makes the reader *do* the thing the section is about; quizzes test reasoning | interaction is filler, or trivia quizzes |
| **polish** | it reads and looks like a finished page: consistent terms, good pacing, nothing awkward | rough: repetition, odd ordering, broken flow |

Then: **overall** 1–5, and the single change that would most improve the section.

Finally, **errors**: every place where the section is wrong, which gets corrected before the page ships. Check the
writer's own examples, quizzes, diagrams and widget configs with care: work the arithmetic of every example, check
that each quiz's marked answer is the right one and the only right one, that every step of a step-through and every
bar of a timeline matches what the text says happens. An error is:
- a statement that contradicts the source, or a fact about the world the source doesn't give;
- a quiz whose marked answer is wrong, or with more than one defensible answer;
- an example, analogy or calculation whose numbers or logic don't work;
- a visual or widget config that shows something false (wrong order of events, a wrong value, a mislabelled part).

Each error names where it is (quote a few words of it), what is wrong, and the correction. Style, emphasis and
missing nice-to-haves are not errors: they belong in the scores and `top_fix`. An empty list is a fine answer.

Return JSON:
`{"faithful": n, "clear": n, "visual": n, "interactive": n, "polish": n, "overall": n, "reasons": {...}, "top_fix": "...", "errors": [{"where": "...", "problem": "...", "fix": "..."}]}`
