---
id: 1.1
title: Running the web app
---
## Deployments

A Deployment keeps a fixed number of identical pods running and replaces any pod that disappears.
It has run in production since 2014 and scales to 5000 pods.

:::term
❯ kubectl apply -f web.yaml
❯ kubectl get pods
:::

:::quiz
Q: What does a readiness probe control?
- [ ] restarts
- [x] whether the pod gets traffic
Explanation: failing readiness only removes the pod from traffic.
:::

:::callout note
Rolling updates keep the app available.
