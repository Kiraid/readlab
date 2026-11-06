---
id: "1.1"
title: Running the web app
---
Think of a Deployment as a promise: "keep this many copies of my pod alive". If one vanishes, it makes a
new one without you asking.

:::code src=app.yaml hl=6,12-13
:::

Line 6 sets `replicas: 3`, so three copies of `web` run at once. Lines 12–13 add a readiness probe: the pod only gets
traffic once `/ready` on port 8080 answers, so nobody hits a process that is still starting.

:::term
$ kubectl apply -f app.yaml
$ kubectl get pods
:::

:::callout note
A rolling update swaps pods out a few at a time, which keeps the app reachable while it changes.
:::

| probe | what a failure does |
|---|---|
| readiness | stops traffic |
| liveness | restarts the container |

:::diagram flow
nodes:
  d: controller@0 "Deployment"
  p1: worker@1,0 "pod 1"
  p2: worker@1,1 "pod 2"
  p3: worker@1,2 "pod 3"
edges:
  - d > p1
  - d > p2
  - d > p3
caption: One Deployment, three replicas.
:::
