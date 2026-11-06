# diagram-brief

Section writers may hand diagrams to a separate diagram agent with a fresh context (it sees only the
brief, FORMAT.md and this skill, not the chapter). Then the brief is all it gets, so make it complete.

A brief is YAML in the section's plan (the planner writes it; it never goes into the section file). The
diagram agent's output replaces a `{{diagram:ID}}` placeholder the writer leaves where the figure goes:

```
type: flow                     # flow | sequence
purpose: Show that one proxy serves three hosts and picks the backend by Host header.
nodes:                         # every box, with role and a short label
  - client (client): "browser"
  - proxy (gateway): "ingress proxy", sub "11.22.33.44"
  - a, b, c (service): "kiada", "quote", "quiz"
layout: client left, proxy centre, the three services stacked on the right; proxy and services inside "cluster"
edges:
  - client → proxy, flow, "GET / Host: …"
  - proxy → each service, labelled with its host
motion: one packet per host travelling client → proxy → service
steps: none
caption: One entry point, many services.
```

Rules for the brief:
- Name every node and edge; the diagram agent must not invent components.
- Give the layout in words (left/centre/right, stacked, inside a group); it turns that into grid cells.
- Say what moves (journeys) and what the steps are, if any.
- Keep labels within the limits in FORMAT.md; put explanations in the purpose, not the labels.

Rules for the diagram agent: output exactly one `:::diagram` block that follows the brief, nothing else.
