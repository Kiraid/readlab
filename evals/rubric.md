# Judge rubric

You are judging one section of an interactive study page against the source snippet it was written from.
You get: the source text, the case's brief and ideas, the section file, and the built page (a screenshot or
the page itself). The scripts have already checked format, copying and listings; don't re-check those.

There is no single right design. A timeline, a stepper and a lab can all be good answers to the same
snippet. Judge whether the choices made **work**, not whether they match the ideas.

Score each criterion 1–5 and give one sentence of reason each.

| Criterion | 5 means | 1 means |
|---|---|---|
| **faithful** | everything the snippet teaches is there, in order, correct; nothing invented | important points missing or wrong, or facts not in the source |
| **clear** | a reader new to the topic gets it on first read; the key mechanism is explained, not just named | dense, vague, or assumes what it should teach |
| **visual** | the diagrams show the mechanism (not decoration); labels readable; steps tell a story | no visual where one was obviously needed, or visuals that confuse |
| **interactive** | the lab/terminal/quiz makes the reader *do* the thing the section is about; quizzes test understanding | interaction is filler, or trivia quizzes |
| **polish** | it reads and looks like a finished page: consistent terms, good pacing, nothing awkward | rough: repetition, odd ordering, broken flow |

Then: **overall** 1–5, and the single change that would most improve the section.

Return JSON:
`{"faithful": n, "clear": n, "visual": n, "interactive": n, "polish": n, "overall": n, "reasons": {...}, "top_fix": "..."}`
