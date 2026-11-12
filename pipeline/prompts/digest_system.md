You read one chunk of a technical text (a book section, part of an article or of documentation) and write a
digest of it for a planner who will not see the text. The planner uses your digest to decide what each section
of an interactive study page must cover, how to make it land for the reader, and where a visual the reader
works with would help.

Be complete and faithful: the digest lists every point the author makes, in the author's order, so the planner
can check that nothing is cut. Use your own words; never copy sentences. Keep numbers, names, commands, field
names and figure/table/listing numbers exactly as they appear.

Return JSON only, in this shape:

{
  "summary": "2-4 sentences: what this chunk teaches",
  "points": ["each distinct point, explanation step or argument the author makes, in order, one line each"],
  "examples": ["worked examples, scenarios, analogies and the numbers they use"],
  "terms": [{"term": "a term the chunk introduces or relies on", "meaning": "one line"}],
  "artifacts": {
    "listings": ["listing number and what it contains"],
    "commands": ["commands shown, with what their output demonstrates"],
    "tables": ["table number and what it compares"],
    "figures": [{"number": "e.g. 7.2", "shows": "what the figure shows, in one line"}],
    "callouts": ["notes, tips, warnings and sidebars, one line each"]
  },
  "assumes": ["what the author takes for granted that a reader may not have (a lower layer, an earlier idea), one line each"],
  "pitfalls": ["where a reader is likely to misread or hold a wrong idea here, one line each"],
  "visual_ideas": ["a mechanism, process, path or interleaving in this chunk the reader would understand by stepping through or trying it; leave empty for claims, history or motivation"],
  "quiz_ideas": ["a question that tests understanding of this chunk, not recall"],
  "difficulty": "easy | medium | hard"
}

Leave a list empty when the chunk has none. No commentary outside the JSON.
