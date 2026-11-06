# rule-tester

**Use when** the text explains how inputs are matched against rules and the details trip people up:
path types (Exact vs Prefix), wildcard hosts, glob patterns in config files, firewall CIDRs, regex
routes, `.gitignore`-style patterns. The reader types an input and sees every rule's verdict and reason.

Matchers: `exact`, `prefix` (plain string prefix), `path-prefix` (whole `/` segments), `glob`
(`*`, `?`), `regex`, `host` (`*.example.com` covers exactly one label), `cidr` (IPv4), `any`.
`pick`: `first` (rule order matters), `longest` (most specific wins), `all`.

```
:::widget rule-tester
title: Exact or Prefix?
input_label: request path
pick: longest
rules:
  - { kind: exact, pattern: /quote, target: quote service }
  - { kind: path-prefix, pattern: /questions, target: quiz service }
presets: [/quote, /quote/, /questions/random, /questionsX]
notes:
  path-prefix: Prefix compares whole segments, so /questionsX does not match.
:::
```

Checklist: include presets that hit each interesting case, especially the trap (the input people
expect to match but doesn't); use the same rule kinds and order the book describes; mention one
preset in the prose ("try `/quote/`").
