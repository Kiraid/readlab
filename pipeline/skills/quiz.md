# quiz

**Pattern:** one or two questions per major section that test whether the reader understood a mechanism,
not whether they remember a word.

```
:::quiz
? A request for `/carts` arrives. The only rule is `Prefix /cart`. What happens?
- It matches, because `/carts` starts with `/cart`
+ It doesn't match: prefixes compare whole path segments
- It matches only with a trailing slash
> Prefix matching splits on `/`, so `carts` and `cart` are different segments.
:::
```

Rules:
- Ask about consequences: "what happens if", "which component", "why does X fail".
- Wrong options are the real misconceptions (the naive reading, the neighbouring concept), not jokes.
- Options of similar length; the right one is not always the longest or the middle one.
- The explanation says *why*, in one or two sentences, and may point at the diagram or lab above.
- Every fact in a quiz must be in the section.
