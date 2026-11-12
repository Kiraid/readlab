# clarify-misconception

**Pattern:** where the brief names a misconception (or the source corrects one), confront it instead of only
stating the right version. A reader who only sees the correct idea finds it "very clear" and keeps the wrong one.

Four steps, short:
1. **Say it** as the reader would: "You might expect a transaction to lock every row it reads."
2. **Grant it**: why it is a reasonable thing to think (it is often true elsewhere, or half right).
3. **Let it fail on a concrete case**: the author's example, the running example, or a small one of yours in a
   `:::callout example`. Show the step where the wrong idea predicts the wrong outcome; a step-through diagram or
   a quiz option the reader can pick works well here.
4. **Give the right idea**, and say at which step the old one went wrong and which part of it was right.

For a small slip (which component does the work, the order of two steps, a surprising default) one or two
sentences do it, inline or as a `:::callout tip`: "It goes back to *ready*, not straight to *running*: it still
has to be scheduled."

Rules:
- The correct version is the author's. Never invent internals or facts; a toy case only illustrates.
- Put it right where the confusion starts, not at the end of the section.
- One or two per section at most; the brief says which.
