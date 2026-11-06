# process-stepper

**Pattern:** a flow diagram with `steps`, for anything that happens in a fixed order or a loop: what a
controller does all day, how a build pipeline runs, the phases of a commit, a garbage collection cycle.
Each step highlights the parts involved and shows one sentence; the reader plays or clicks through.

```
:::diagram flow
nodes:
  api: object@0,1 "API server"
  ctrl: controller@1,1 "controller"
  cfg: object@2,0 "config file"
  proxy: gateway@2,2 "proxy"
edges:
  - api > ctrl flow "watch"
  - ctrl > cfg edge "render"
  - cfg > proxy edge "reload"
steps:
  - api, api>ctrl: The controller watches the API server for changes.
  - ctrl, ctrl>cfg, cfg: On every change it renders a new config file.
  - cfg>proxy, proxy: It tells the proxy to reload, and the new routes are live.
  - api>ctrl: Then it goes back to watching. This loop never ends.
caption: The control loop.
:::
```

Rules:
- 3–6 steps; one idea per step; narration ≤ 2 short sentences.
- A loop returns to an earlier element in the last step and says so.
- Everything a step mentions must be highlighted in that step (list its node and edge ids).
- Elements not in any step stay visible the whole time: use that for context (the cluster, the user).
