# recap-and-callouts

**Callouts** carry the book's notes, tips, warnings, definitions and sidebars, as their own blocks so
they stand out from the prose.

| Book element | Block |
|---|---|
| NOTE | `:::callout note` |
| TIP | `:::callout tip` |
| WARNING / CAUTION | `:::callout warn` |
| DEFINITION | `:::callout definition` |
| Sidebar (boxed aside with a title) | `:::callout sidebar title="About Kustomize"` |

Keep each callout to what the book's callout says, in your words; one paragraph is typical.

**Tables:** reproduce the book's tables with the same rows and columns as GFM tables (the content in
your words where it is prose, exact where it is values). If a table classifies examples along two axes
and benefits from clicking, consider `matrix-explorer`.

**Recap:** at the end of a long section (or the chapter summary), a `:::recap` with 3–6 bullets, each a
takeaway the reader should be able to say back, not a table of contents.

```
:::recap
- An Ingress names hosts, paths and Services; it never lists pods.
- The controller turns Ingress objects into proxy configuration and keeps doing it.
- Prefix compares path segments, not characters.
:::
```
