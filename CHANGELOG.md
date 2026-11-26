# Changelog

Dates are UTC. Every entry links to the public commit that shipped it; every deploy of the live site is a public GitHub Actions run with signed build files.

## v2.0.0 — 2026-11-27 · released ahead of the Dec 6 deadline

All six planned v2 items shipped. Live roadmap: https://shipyard-h0413.ms.computer/#/roadmap

- **2026-11-27** — Release polish: v2 on the home page and README; pages load on demand (main bundle 259 → 188 KB gzipped) and recover from a deploy while open; workflow v11 puts `node_modules/.bin` on PATH so host build commands run as written; fixes from an independent review (Vercel rewrites and SPA fallback in *Exact rules*, Pages folder and computed commands, CRA/Next base paths, Go side listeners and Gin `r.Run()`, FastAPI `[standard]`)  ([f72ec36](https://github.com/mmdev94/shipyard/commit/f72ec36), [7fd0e2a](https://github.com/mmdev94/shipyard/commit/7fd0e2a))
- **2026-11-27** — More Fix it for me: deep links in single-page apps, GitHub Pages base paths, SvelteKit → adapter-static, Astro → static output ([70135dc](https://github.com/mmdev94/shipyard/commit/70135dc))
- **2026-11-27** — Move my site: GitHub Pages, Netlify and Vercel sites get a move plan and one pull request that switches them; “Exact rules” keeps redirects, rewrites and headers via Caddy ([f14a504](https://github.com/mmdev94/shipyard/commit/f14a504))
- **2026-11-27** — Python and Go apps: the check works out how ms.computer will start the server (it guesses `main:app` for Python), checks Go servers, and Fix it for me writes the Procfile or the `$PORT` change; workflow v9 ([42808d6](https://github.com/mmdev94/shipyard/commit/42808d6))
- **2026-11-26** — “Deploy to Ms. Computer” button for any README: copies a public repo into the visitor’s account and deploys it ([322b257](https://github.com/mmdev94/shipyard/commit/322b257))
- **2026-11-26** — Private repos: with GitHub connected, the check and Fix it for me read private repos through GitHub’s API with your token; their names stay out of problem reports ([7a375fc](https://github.com/mmdev94/shipyard/commit/7a375fc))
- **2026-11-26** — Report a problem: a filled-in GitHub issue (or Discord text) from any page and next to every error ([eadc823](https://github.com/mmdev94/shipyard/commit/eadc823))

## v1.1.0 — 2026-11-26 · the version announced to the community

Frozen on the [`v1` branch](https://github.com/mmdev94/shipyard/tree/v1); v2 work continues on `main`.

- **Link preview:** sharing the link on Discord or X now shows a card with a 1200×630 image ([5755bcf](https://github.com/mmdev94/shipyard/commit/5755bcf))
- **“New here? 30 seconds” guide** on the home page: four looping clips (check a repo, turn on auto-deploy, push and it’s live, Fix it for me), drawn by React so they stay sharp and load instantly ([5755bcf](https://github.com/mmdev94/shipyard/commit/5755bcf))
- **Ad GIFs** in `media/` and at the top of the README, exported from the same components ([5755bcf](https://github.com/mmdev94/shipyard/commit/5755bcf))

## v1.0.0 — 2026-11-26

First public version, live at https://shipyard-h0413.ms.computer.

- **Release:** an “Everything in v1” section on the home page; a roadmap page with what shipped (linked to its commits) and the plan to the Dec 6 deadline; a menu for phones and tablets; README and MIT license.

### Shipped on the way

- **2026-11-25** — Re-check: Check again, same-repo re-check, watch mode with GitHub connected; checks pinned to a commit ([6162fff](https://github.com/mmdev94/shipyard/commit/6162fff))
- **2026-11-25** — Survive GitHub API outages when recording a deploy (workflow v7); Repair from the tracker ([2f00904](https://github.com/mmdev94/shipyard/commit/2f00904))
- **2026-11-25** — Pull request previews: reuse the preview app on later pushes; cleanup takes down every app a PR left (workflow v6) ([bc1b482](https://github.com/mmdev94/shipyard/commit/bc1b482))
- **2026-11-25** — GitHub's API limit explained as GitHub's rule; checks use the connected token ([942ff7d](https://github.com/mmdev94/shipyard/commit/942ff7d))
- **2026-11-25** — Fix it for me: safe fixes opened as pull requests ([61ff7d3](https://github.com/mmdev94/shipyard/commit/61ff7d3))
- **2026-11-25** — Pull request previews, opt-in (workflow v5) ([194acd8](https://github.com/mmdev94/shipyard/commit/194acd8))
- **2026-11-25** — Showcase of repos tagged `ms-computer` ([0e8ac4e](https://github.com/mmdev94/shipyard/commit/0e8ac4e), [1c8f885](https://github.com/mmdev94/shipyard/commit/1c8f885))
- **2026-11-25** — Roll back and deploy history (workflow v4) ([da00ed4](https://github.com/mmdev94/shipyard/commit/da00ed4))
- **2026-11-25** — Trust: self-deleting setup token, token activity log, terminal mode, signed builds (workflow v3) ([d4ed71b](https://github.com/mmdev94/shipyard/commit/d4ed71b))
- **2026-11-25** — Tracker follows Redeploy / Take down; back links return to the previous page ([6ada2d7](https://github.com/mmdev94/shipyard/commit/6ada2d7))
- **2026-11-24** — One-click deploy, templates and My sites (workflow v2) ([1277696](https://github.com/mmdev94/shipyard/commit/1277696))
- **2026-11-24** — Repo checker, auto-deploy workflow, tracker and rules page ([b0d39b8](https://github.com/mmdev94/shipyard/commit/b0d39b8), [3d49b7a](https://github.com/mmdev94/shipyard/commit/3d49b7a))
