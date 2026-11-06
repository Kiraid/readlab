# clarify-misconception

**Pattern:** one or two sentences, right where the confusion starts, that state the thing people get
wrong and the correct picture. It's often the most valuable line on the page.

Shapes that work:
- "You never X here; you Y, and Z does the rest." (what the object is *not*)
- "Step 3 is the one people miss: A doesn't go through B, it goes straight to C. That's why D works."
- "It goes back to *ready*, not straight to *running*: it still has to be scheduled."

Rules:
- Only clarify what the source supports: restate a consequence the book gives or implies, don't invent
  internals.
- Put it inline in the prose or as a `:::callout tip`; never bury it at the end of a long paragraph.
- One per section is plenty; three is a lecture.
- Good targets: which component actually does the work, what is *not* in an object, the difference
  between two similar names, the order of steps, defaults that surprise people.
