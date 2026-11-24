---
layout: ../../layouts/Post.astro
title: How this blog ships
date: '{{DATE}}'
---

1. You push to `main`.
2. The workflow in `.github/workflows/ms-computer.yml` runs `npm ci` and `npm run build`.
3. The official `mscomputer` CLI verifies the built files in the same sealed runtime the network uses, then deploys them.

If something breaks, the run stops and the live site keeps serving the previous version.
