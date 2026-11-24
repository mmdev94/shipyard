# Shipyard

[![Deploy to ms.computer](https://github.com/mmdev94/shipyard/actions/workflows/ms-computer.yml/badge.svg)](https://github.com/mmdev94/shipyard/actions/workflows/ms-computer.yml)

Paste a public GitHub repo and Shipyard tells you whether it runs on [ms.computer](https://ms.computer), scans it for leaked keys, and writes the GitHub Action that deploys it on every push.

- **Checker** (`src/lib/checker`) — rule-based and runs in the browser. Reads the repo through GitHub's public API, detects the framework, build command and output folder, and checks each ms.computer limit (static output, no database, no egress, no runtime env vars, file sizes…). Every finding cites the rule and links to the file and line.
- **Workflow generator** (`src/lib/workflow.ts`) — builds in the user's own GitHub Actions, deploys with the official `mscomputer` CLI, keeps the app's identity in repo secrets, and records each deploy as a GitHub Deployment so the next push can replace it at the same URL.
- **Tracker** (`#/track/owner/repo`) — follows the latest run step by step and shows why it failed, from public run annotations. No login.

There is no Shipyard server. This repo deploys itself with the workflow its own checker generated (`.github/workflows/ms-computer.yml`).

Community-built for the ms.computer website competition — not an official ms.computer product.

```bash
pnpm install
pnpm dev        # local site
pnpm test       # checker tests
```
