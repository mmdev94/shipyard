// Generates the GitHub Actions workflow that deploys a repo to ms.computer.
//
// Design notes (from `mscomputer docs agents`):
// - The CLI gets a free 6-hour token by itself, so no account or token setup.
// - The first deploy creates an application key (in mscomputer.toml) and a
//   one-time application secret. The secret is the only lasting authority over
//   the app, so it must survive between runs. We save it to the repo's GitHub
//   secrets (base64, never printed) and the toml to a repo variable, using a
//   one-time setup token. GITHUB_TOKEN can't write secrets, hence the PAT.
// - A live app can't be replaced in place (APPLICATION_ALREADY_LIVE — static
//   sites and, as measured on 2026-11-27, dynamic apps too), so on update we
//   build first, then tear down and redeploy. The hostname stays
//   reserved for the app, so the URL doesn't change.
// - Teardown needs the live deployment's dep_… id, and the CLI keeps it only in
//   a local file that a fresh runner doesn't have. So every successful deploy is
//   recorded as a GitHub Deployment (environment "ms-computer") carrying the id;
//   the next run reads it back. That needs only GITHUB_TOKEN with
//   deployments: write — no long-lived PAT — and gives the repo page a link to
//   the live site. A manual run can pass the id for sites deployed before that.
// - Only `push` and `workflow_dispatch` trigger it — never pull requests — so
//   forks can never reach the secret.

export type { PackageManager, DeployMode, WorkflowConfig } from './workflowConfig.ts'
export { readWorkflowConfig, SAFE_FROM, SAFE_TO } from './workflowConfig.ts'
import { SAFE_FROM, SAFE_TO, CONFIG_KEYS, type WorkflowConfig, type PackageManager } from './workflowConfig.ts'

/** Bumped whenever generated workflows change, so the dashboard can offer an update. */
export const WORKFLOW_VERSION = 10

/** Resolves `.` and `..` segments, e.g. `frontend/../backend/app` → `backend/app`. */
export function normalizePath(p: string): string {
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/') || '.'
}

/** ms.computer normalizes names into DNS labels; mirror that so the preview URL is honest. */
export function normalizeAppName(raw: string): string {
  const name = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/g, '')
  return name || 'my-site'
}

function installCommand(pm: PackageManager, locked: boolean): string {
  switch (pm) {
    case 'pnpm':
      return locked ? 'pnpm install --frozen-lockfile' : 'pnpm install'
    case 'yarn':
      return locked ? 'yarn install --frozen-lockfile' : 'yarn install'
    case 'bun':
      return locked ? 'bun install --frozen-lockfile' : 'bun install'
    case 'npm':
      return locked ? 'npm ci' : 'npm install'
    default:
      return ''
  }
}

function setupSteps(cfg: WorkflowConfig): string {
  if (cfg.packageManager === 'none') return ''
  const lines: string[] = []
  if (cfg.packageManager === 'pnpm') {
    lines.push(`      - name: Set up pnpm
        uses: pnpm/action-setup@v6${cfg.packageManagerPinned ? '' : '\n        with:\n          version: 10'}
`)
  }
  if (cfg.packageManager === 'bun') {
    lines.push(`      - name: Set up Bun
        uses: oven-sh/setup-bun@v2
`)
  } else {
    const cache = cfg.hasLockfile !== false && (cfg.packageManager === 'npm' || cfg.packageManager === 'pnpm' || cfg.packageManager === 'yarn')
      ? `\n          cache: ${cfg.packageManager}${cfg.workingDir !== '.' ? `\n          cache-dependency-path: ${cfg.workingDir}/**/*lock*` : ''}`
      : ''
    lines.push(`      - name: Set up Node
        uses: actions/setup-node@v7
        with:
          node-version: ${cfg.nodeVersion}${cache}
`)
  }
  return lines.join('\n')
}

function buildStep(cfg: WorkflowConfig): string {
  const cmds = [installCommand(cfg.packageManager, cfg.hasLockfile !== false), cfg.buildCommand.trim()].filter(Boolean)
  if (cmds.length === 0) return ''
  return `      - name: Install and build
        working-directory: ${cfg.workingDir}
        run: |
${cmds.map((c) => `          ${c}`).join('\n')}
`
}

const INSTALL_CLI = `      - name: Install the ms.computer CLI
        run: |
          curl -fsSL https://get.ms.computer/install.sh | sh
          echo "$HOME/.local/bin" >> "$GITHUB_PATH"
`

const CLI_STEPS = `${INSTALL_CLI}
      - name: Restore the app identity
        env:
          MSCOMPUTER_TOML: \${{ vars.MSCOMPUTER_TOML }}
          APP_SECRET: \${{ secrets.MSCOMPUTER_APP_SECRET }}
        run: |
          set -euo pipefail
          if [ -z "$MSCOMPUTER_TOML" ]; then
            echo "First deploy — a new app will be created."
            exit 0
          fi
          printf '%s\\n' "$MSCOMPUTER_TOML" > "$APP_DIR/mscomputer.toml"
          if [ -z "$APP_SECRET" ]; then
            echo "::error::MSCOMPUTER_APP_SECRET is missing, so this run can't update the existing app. Re-run Shipyard setup."
            exit 1
          fi
          KEY=$(sed -n 's/^key = "\\(.*\\)"/\\1/p' "$APP_DIR/mscomputer.toml")
          umask 077
          mkdir -p "$HOME/.config/mscomputer/applications"
          printf '%s' "$APP_SECRET" | base64 -d > "$HOME/.config/mscomputer/applications/$KEY.secret"
`

// Runs a CLI command, shows its output, and on failure publishes the last lines
// as a GitHub annotation. Annotations are readable through the public API, so
// Shipyard's Track page (and anyone without a GitHub login) can see why.
const RUN_HELPER = `          set +e -uo pipefail
          annotate() {
            local msg
            msg=$(tail -n 25 "$3" | sed -e 's/%/%25/g' -e 's/\\r//g' | awk 'BEGIN{ORS="%0A"} {print}')
            echo "::error title=$1 (exit $2)::$msg"
          }
          # run TITLE CMD...  — TITLE "-" means: don't annotate, the caller decides.
          run() {
            local title="$1"; shift
            "$@" > "$RUNNER_TEMP/last.log" 2>&1
            local rc=$?
            cat "$RUNNER_TEMP/last.log"
            if [ "$rc" -ne 0 ] && [ "$title" != "-" ]; then annotate "$title" "$rc" "$RUNNER_TEMP/last.log"; fi
            return "$rc"
          }
          # deploy_app — mscomputer deploy, waiting while an earlier deploy of this
          # app is still settling on Ms. Computer (APPLICATION_DEPLOYMENT_ACTIVE)
          deploy_app() {
            local n=0 rc
            while :; do
              run - mscomputer deploy --name "$APP_NAME"; rc=$?
              if [ "$rc" -ne 0 ] && grep -q APPLICATION_DEPLOYMENT_ACTIVE "$RUNNER_TEMP/last.log" && [ "$n" -lt 10 ]; then
                n=$((n + 1))
                echo "An earlier deploy of this app is still settling on Ms. Computer — trying again in 30s ($n/10)."
                sleep 30
                continue
              fi
              return "$rc"
            done
          }`

function deployStep(cfg: WorkflowConfig): string {
  // ms.computer won't swap a live app in place — static or dynamic — so an
  // update takes the old version down and ships the new one
  const teardownFallback = `            if grep -q APPLICATION_ALREADY_LIVE "$RUNNER_TEMP/last.log"; then
              echo "ms.computer doesn't swap a live ${cfg.mode === 'static' ? 'site' : 'app'} in place — taking the old version down and shipping the new one."
              DEP="$REPLACE_DEPLOYMENT"
              if [ -z "$DEP" ]; then
                DEP=$(gh api "repos/$GITHUB_REPOSITORY/deployments?environment=ms-computer&per_page=20" \
                  --jq '[.[] | .payload.ms_computer_deployment? // empty] | first // empty' || true)
              fi
              if ! [[ "$DEP" =~ ^dep_[0-9a-f]+$ ]]; then
                echo "::error title=Can't tell which live version to replace::This app is already live, but no earlier deploy from this workflow is on record. Open the log of the run that first deployed it, copy the id on its 'Deployment: dep_…' line, then run this workflow from the Actions tab and paste that id. After that, pushes update the site by themselves."
                exit 1
              fi
              echo "Replacing live deployment $DEP"
              run "Taking the old version down failed" mscomputer teardown "$DEP" || exit 1
              deploy_app || { annotate "Deploy failed after teardown" 1 "$RUNNER_TEMP/last.log"; exit 1; }
            else
              annotate "Deploy failed" "$RC" "$RUNNER_TEMP/last.log"
              exit 1
            fi`
  return `      - name: Plan and build the image
        working-directory: \${{ env.APP_DIR }}
        run: |
${RUN_HELPER}
          run - mscomputer plan --write --json || {
            if grep -q PLAN_INPUT_REQUIRED "$RUNNER_TEMP/last.log"; then
              WHY=$(grep -o '"message": *"[^"]*"' "$RUNNER_TEMP/last.log" | head -1 | sed 's/.*: *"//; s/"$//')
              HINT='Add a Procfile with one line, web: <command that starts the server on 0.0.0.0 at $PORT> — for example web: gunicorn app:app, or web: uvicorn main:app --host 0.0.0.0 --port $PORT. Check the repo on Shipyard for the exact line and a one-click fix.'
              echo "::error title=ms.computer can't tell how to start this app::$WHY $HINT"
            else
              annotate "ms.computer couldn't plan this app" 1 "$RUNNER_TEMP/last.log"
            fi
            exit 1
          }
          run "The image build failed" mscomputer build${cfg.mode === 'static' && !cfg.caddyfile ? ' --static' : ''} || exit 1

      - name: Deploy
        id: deploy
        working-directory: \${{ env.APP_DIR }}
        env:
          GH_TOKEN: \${{ github.token }}
          REPLACE_DEPLOYMENT: \${{ inputs.replace_deployment }}
        run: |
${RUN_HELPER}
          deploy_app; RC=$?
          if [ "$RC" -ne 0 ]; then
${teardownFallback}
          fi
          URL=$(grep -oE 'https://[a-z0-9-]+\\.ms\\.computer' "$RUNNER_TEMP/last.log" | tail -1 || true)
          DEP_ID=$(jq -r '.deployment.id // empty' .mscomputer/state/deploy.json 2>/dev/null || true)
          [ -n "$DEP_ID" ] || DEP_ID=$(grep -oE 'dep_[0-9a-f]{8,}' "$RUNNER_TEMP/last.log" | tail -1 || true)
          echo "url=$URL" >> "$GITHUB_OUTPUT"
          echo "deployment_id=$DEP_ID" >> "$GITHUB_OUTPUT"
          echo "::notice title=Live on ms.computer::$URL (deployment $DEP_ID)"
          printf '### Live on ms.computer\\n%s\\n' "$URL" >> "$GITHUB_STEP_SUMMARY"

      - name: Record the deployment on GitHub
        if: \${{ steps.deploy.outputs.deployment_id != '' }}
        env:
          GH_TOKEN: \${{ github.token }}
          DEP_ID: \${{ steps.deploy.outputs.deployment_id }}
          URL: \${{ steps.deploy.outputs.url }}
        run: |
          set -euo pipefail
          # GitHub's API sometimes answers 5xx for a moment; a lost record would leave
          # the next update unable to tell which deployment to replace, so retry.
          retry() {
            local n=1
            until "$@"; do
              [ "$n" -ge 5 ] && return 1
              echo "GitHub didn't answer — trying again in $((n * n * 3))s" >&2
              sleep $((n * n * 3))
              n=$((n + 1))
            done
          }
          DESC="Deployed by Shipyard"
          [ -z "\${ROLLBACK:-}" ] || DESC="Rolled back by Shipyard"
          create() {
            jq -n --arg sha "$DEPLOY_SHA" --arg dep "$DEP_ID" --arg desc "$DESC" \\
              '{ref: $sha, environment: "ms-computer", auto_merge: false, required_contexts: [],
                production_environment: true, description: $desc,
                payload: {ms_computer_deployment: $dep}}' \\
              | gh api "repos/$GITHUB_REPOSITORY/deployments" --input - --jq .id
          }
          mark() {
            gh api "repos/$GITHUB_REPOSITORY/deployments/$ID/statuses" -f state=success \\
              -f environment_url="$URL" -f log_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" > /dev/null
          }
          if ! ID=$(retry create) || ! retry mark; then
            echo "::error title=Couldn't record this deploy::The site is live as $DEP_ID, but GitHub's API kept failing, so it wasn't recorded. The next update needs that id: Shipyard's tracker has a Repair button, or run this workflow from the Actions tab with replace_deployment = $DEP_ID."
            exit 1
          fi
          echo "Recorded $DEP_ID — the next push replaces it."
          if [ -n "\${ROLLBACK:-}" ]; then
            echo "::notice title=Rolled back::Live on \${DEPLOY_SHA::7}. The next push to \${GITHUB_REF_NAME} deploys the latest commit again."
          fi

      # The setup token's only job is the save below. Once it's done the token
      # deletes itself, so it never outlives the first deploy — whether or not
      # anyone is watching. A token left by an older workflow is removed too.
      - name: Save the app identity and delete the setup token
        if: \${{ !cancelled() && steps.deploy.outcome == 'success' }}
        env:
          GH_TOKEN: \${{ secrets.SHIPYARD_SETUP_TOKEN }}
          HAS_IDENTITY: \${{ vars.MSCOMPUTER_TOML != '' }}
        run: |
          set -euo pipefail
          if [ -z "$GH_TOKEN" ]; then
            echo "No setup token in this repo — nothing to clean up."
            exit 0
          fi
          if [ "$HAS_IDENTITY" != "true" ]; then
            KEY=$(sed -n 's/^key = "\\(.*\\)"/\\1/p' "$APP_DIR/mscomputer.toml")
            base64 -w0 "$HOME/.config/mscomputer/applications/$KEY.secret" \\
              | gh secret set MSCOMPUTER_APP_SECRET --repo "$GITHUB_REPOSITORY"
            gh variable set MSCOMPUTER_TOML --repo "$GITHUB_REPOSITORY" < "$APP_DIR/mscomputer.toml"
            echo "Saved the app identity — future pushes update this same app and URL."
          fi
          if gh secret delete SHIPYARD_SETUP_TOKEN --repo "$GITHUB_REPOSITORY"; then
            echo "::notice title=Setup token deleted::SHIPYARD_SETUP_TOKEN has done its job and is gone from this repo. You can also revoke the token on GitHub."
          else
            echo "::warning title=Setup token left behind::Couldn't delete SHIPYARD_SETUP_TOKEN (it may have expired). Delete it under Settings → Secrets and variables → Actions."
          fi
`
}

// Manual "take down" (from the Actions tab or Shipyard's dashboard): stops the
// live deployment on record and marks the GitHub deployment inactive. The
// hostname stays reserved, so the next deploy comes back at the same URL.
function takeDownJob(): string {
  return `
  take-down:
    if: \${{ inputs.action == 'take-down' }}
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
${INSTALL_CLI}
      - name: Take the site down
        env:
          MSCOMPUTER_TOML: \${{ vars.MSCOMPUTER_TOML }}
          APP_SECRET: \${{ secrets.MSCOMPUTER_APP_SECRET }}
          GH_TOKEN: \${{ github.token }}
        run: |
${RUN_HELPER}
          if [ -z "$MSCOMPUTER_TOML" ] || [ -z "$APP_SECRET" ]; then
            echo "::error title=Nothing to take down::This repo has no ms.computer app yet."
            exit 1
          fi
          APP_DIR="$RUNNER_TEMP/app"
          mkdir -p "$APP_DIR" && cd "$APP_DIR"
          printf '%s\\n' "$MSCOMPUTER_TOML" > mscomputer.toml
          git init -q && git add -A
          git -c user.name="Shipyard" -c user.email="shipyard@users.noreply.github.com" commit -qm "Take down"
          KEY=$(sed -n 's/^key = "\\(.*\\)"/\\1/p' mscomputer.toml)
          ( umask 077
            mkdir -p "$HOME/.config/mscomputer/applications"
            printf '%s' "$APP_SECRET" | base64 -d > "$HOME/.config/mscomputer/applications/$KEY.secret" )
          REC=$(gh api "repos/$GITHUB_REPOSITORY/deployments?environment=ms-computer&per_page=20" \\
            --jq '[.[] | select(.payload.ms_computer_deployment? != null)] | first // empty' || true)
          DEP=$(jq -r '.payload.ms_computer_deployment // empty' <<< "\${REC:-null}")
          GH_DEP=$(jq -r '.id // empty' <<< "\${REC:-null}")
          if ! [[ "$DEP" =~ ^dep_[0-9a-f]+$ ]]; then
            echo "::error title=No live deployment on record::Shipyard has no record of a deployment to stop for this repo."
            exit 1
          fi
          run "Taking the site down failed" mscomputer teardown "$DEP" || exit 1
          gh api "repos/$GITHUB_REPOSITORY/deployments/$GH_DEP/statuses" -f state=inactive \\
            -f description="Taken down" > /dev/null || true
          echo "::notice title=Site taken down::$DEP is stopped. The address stays reserved — push or run the workflow to bring it back."
`
}

const PREFLIGHT = `      - name: Check setup
        env:
          MSCOMPUTER_TOML: \${{ vars.MSCOMPUTER_TOML }}
          SETUP_TOKEN: \${{ secrets.SHIPYARD_SETUP_TOKEN }}
          ROLLBACK_TO: \${{ inputs.commit }}
        run: |
          if [ -z "$MSCOMPUTER_TOML" ] && [ -z "$SETUP_TOKEN" ]; then
            echo "::error title=Setup token missing::The first deploy needs the SHIPYARD_SETUP_TOKEN repo secret so it can save the app's identity — without it, later pushes couldn't update the site. Add it under Settings → Secrets and variables → Actions, then re-run. Nothing was deployed."
            exit 1
          fi
          # a rollback deploys an older commit; everything else deploys the pushed one
          if [ -n "$ROLLBACK_TO" ]; then
            if ! [[ "$ROLLBACK_TO" =~ ^[0-9a-f]{40}$ ]]; then
              echo "::error title=Not a commit::Roll back needs the full 40-character SHA of a commit in this repo."
              exit 1
            fi
            echo "DEPLOY_SHA=$ROLLBACK_TO" >> "$GITHUB_ENV"
            echo "ROLLBACK=1" >> "$GITHUB_ENV"
          else
            echo "DEPLOY_SHA=$GITHUB_SHA" >> "$GITHUB_ENV"
          fi
`

/** Shell lines run after staging: Caddyfile, SPA fallback, redirect pages. */
function extrasLines(cfg: WorkflowConfig): string {
  const out: string[] = []
  // a site moved from another host: its config files aren't part of the site
  if (cfg.caddyfile || cfg.spa || cfg.redirectPages?.length)
    out.push(`          rm -f "$APP_DIR/_redirects" "$APP_DIR/_headers" "$APP_DIR/netlify.toml" "$APP_DIR/vercel.json"`)
  if (cfg.caddyfile) {
    const file = normalizePath(`${cfg.workingDir}/${cfg.caddyfile}`)
    out.push(`          # served by Caddy with the repo's rules (a dynamic app — see the caddyfile setting)
          cp "${file}" "$APP_DIR/Caddyfile"`)
  } else {
    if (cfg.spa)
      out.push(`          # single-page app: unknown paths get 404.html, so make it the app itself
          [ -f "$APP_DIR/404.html" ] || cp "$APP_DIR/index.html" "$APP_DIR/404.html"`)
    const pages = (cfg.redirectPages ?? []).filter(([from, to]) => SAFE_FROM.test(from) && SAFE_TO.test(to) && from !== '/')
    if (pages.length) {
      out.push(`          # redirects kept from the old host, as small pages (static hosting has no server redirects)
          redirect_page() {
            local file="$APP_DIR$1"
            case "$1" in */) file="\${file}index.html" ;; *.html) ;; *) file="$file/index.html" ;; esac
            [ -e "$file" ] && return 0
            mkdir -p "$(dirname "$file")"
            printf '<!doctype html><meta charset="utf-8"><title>Moved</title><link rel="canonical" href="%s"><meta http-equiv="refresh" content="0; url=%s"><a href="%s">This page has moved.</a>\\n' "$2" "$2" "$2" > "$file"
          }`)
      for (const [from, to] of pages) out.push(`          redirect_page '${from}' '${to}'`)
    }
  }
  return out.length ? `${out.join('\n')}\n` : ''
}

function stageStep(cfg: WorkflowConfig): string {
  const src = normalizePath(`${cfg.workingDir}/${cfg.outputDir}`)
  return `      - name: Stage the built site
        run: |
          set -euo pipefail
          APP_DIR="$RUNNER_TEMP/site"
          rm -rf "$APP_DIR" && mkdir -p "$APP_DIR"
          rsync -a --exclude .git --exclude .github --exclude node_modules \\
            --exclude '.env*' --exclude Procfile --exclude Caddyfile \\
            "${src}/" "$APP_DIR/"
          if [ ! -f "$APP_DIR/index.html" ]; then
            echo "::error::'${src}' has no index.html after the build. Check OUTPUT_DIR in Shipyard."
            exit 1
          fi
${extrasLines(cfg)}          cd "$APP_DIR"
          git init -q
          git add -A
          git -c user.name="Shipyard" -c user.email="shipyard@users.noreply.github.com" commit -qm "Build \${DEPLOY_SHA::7}"
          echo "APP_DIR=$APP_DIR" >> "$GITHUB_ENV"
${cfg.attest && src !== '.' ? attestStep(src) : ''}`
}

// Every built file gets a signed provenance record on GitHub: "this sha256 was
// built by <repo>'s workflow at <commit>". Checkable with
// `gh attestation verify <file> -R <repo>`, and by the page itself.
function attestStep(src: string): string {
  return `
      - name: Sign the built files (build provenance)
        uses: actions/attest-build-provenance@v4
        with:
          subject-path: '${src}/**'
`
}

// ── Pull request previews ────────────────────────────────────────────────────
// Each PR from a branch of this repo gets its own app, "<app>-pr-<n>". Its
// identity (toml + app secret) has to survive until the PR closes, with no
// token that can write secrets. So it's encrypted with a key derived from the
// main app's secret (which only this repo's own runs can read) and kept in the
// payload of a GitHub Deployment in the "ms-computer-preview" environment —
// public, but useless without that key. Fork PRs never run these jobs: they
// get no secrets, and a preview would publish a stranger's code under the
// repo's name.

const PREVIEW_ENV = 'ms-computer-preview'

/** Finds this PR's preview record and restores its app identity, if there is one. */
const PREVIEW_RESTORE = `      - name: Restore the preview's identity
        env:
          GH_TOKEN: \${{ github.token }}
          APP_SECRET: \${{ secrets.MSCOMPUTER_APP_SECRET }}
        run: |
          set -euo pipefail
          [[ "$PR" =~ ^[0-9]+$ ]] || { echo "::error::Unexpected PR number"; exit 1; }
          # exported: openssl reads it with -pass env:KEYMAT
          export KEYMAT=$(printf 'shipyard-preview:%s' "$APP_SECRET" | sha256sum | cut -d' ' -f1)
          echo "::add-mask::$KEYMAT"
          echo "KEYMAT=$KEYMAT" >> "$GITHUB_ENV"
          REC=$(gh api "repos/$GITHUB_REPOSITORY/deployments?environment=${PREVIEW_ENV}&per_page=100" \\
            --jq "[.[] | select(.payload.pr? == $PR)] | first // empty" || true)
          if [ -z "$REC" ]; then
            echo "No preview on record for PR #$PR yet."
            exit 0
          fi
          echo "GH_PREVIEW=$(jq -r '.id' <<< "$REC")" >> "$GITHUB_ENV"
          echo "PREV_DEP=$(jq -r '.payload.ms_computer_deployment // empty' <<< "$REC")" >> "$GITHUB_ENV"
          ID_DIR="$RUNNER_TEMP/preview-id"
          mkdir -p "$ID_DIR"
          if ! jq -r '.payload.identity // empty' <<< "$REC" | base64 -d \\
              | openssl enc -d -aes-256-cbc -pbkdf2 -pass env:KEYMAT | tar -xz -C "$ID_DIR" 2>/dev/null; then
            echo "::warning title=Preview identity unreadable::The main app's key changed since this preview was made, so a new preview app will be created."
            echo "PREV_DEP=" >> "$GITHUB_ENV"
            exit 0
          fi
          umask 077
          mkdir -p "$HOME/.config/mscomputer/applications"
          cp "$ID_DIR"/*.secret "$HOME/.config/mscomputer/applications/"
          echo "PREVIEW_TOML=$ID_DIR/mscomputer.toml" >> "$GITHUB_ENV"
          echo "Restored the preview app for PR #$PR."
`

function previewJobs(cfg: WorkflowConfig): string {
  const stage =
    cfg.mode === 'dynamic'
      ? `      - name: Locate the app
        run: echo "APP_DIR=$GITHUB_WORKSPACE/${cfg.workingDir === '.' ? '' : cfg.workingDir}" | sed 's#/$##' >> "$GITHUB_ENV"
`
      : stageStep({ ...cfg, attest: false })
  return `
  # Previews need the main app deployed once (its key encrypts theirs), and
  # only run for branches of this repo — never for forks.
  preview-ready:
    if: \${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository }}
    runs-on: ubuntu-24.04
    outputs:
      ready: \${{ steps.check.outputs.ready }}
    steps:
      - id: check
        env:
          MSCOMPUTER_TOML: \${{ vars.MSCOMPUTER_TOML }}
          APP_SECRET: \${{ secrets.MSCOMPUTER_APP_SECRET }}
        run: |
          if [ -n "$MSCOMPUTER_TOML" ] && [ -n "$APP_SECRET" ]; then
            echo "ready=true" >> "$GITHUB_OUTPUT"
          else
            echo "::notice title=No preview yet::Previews start once ${cfg.branch} has been deployed once."
            echo "ready=false" >> "$GITHUB_OUTPUT"
          fi

  preview:
    needs: preview-ready
    if: \${{ needs.preview-ready.outputs.ready == 'true' && github.event.action != 'closed' }}
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    env:
      PR: \${{ github.event.pull_request.number }}
      APP_NAME: ${cfg.appName}-pr-\${{ github.event.pull_request.number }}
      DEPLOY_SHA: \${{ github.event.pull_request.head.sha }}
    steps:
      - name: Check out the pull request
        uses: actions/checkout@v7
        with:
          ref: \${{ github.event.pull_request.head.sha }}
          persist-credentials: false

${[setupSteps(cfg), cfg.mode === 'static' ? buildStep(cfg) : '', stage, INSTALL_CLI, PREVIEW_RESTORE].filter(Boolean).join('\n')}
      - name: Deploy the preview
        id: deploy
        working-directory: \${{ env.APP_DIR }}
        run: |
${RUN_HELPER}
          if [ -n "\${PREVIEW_TOML:-}" ]; then cp "$PREVIEW_TOML" mscomputer.toml; fi
          run - mscomputer plan --write --json || {
            if grep -q PLAN_INPUT_REQUIRED "$RUNNER_TEMP/last.log"; then
              WHY=$(grep -o '"message": *"[^"]*"' "$RUNNER_TEMP/last.log" | head -1 | sed 's/.*: *"//; s/"$//')
              HINT='Add a Procfile with one line, web: <command that starts the server on 0.0.0.0 at $PORT> — for example web: gunicorn app:app, or web: uvicorn main:app --host 0.0.0.0 --port $PORT. Check the repo on Shipyard for the exact line and a one-click fix.'
              echo "::error title=ms.computer can't tell how to start this app::$WHY $HINT"
            else
              annotate "ms.computer couldn't plan this app" 1 "$RUNNER_TEMP/last.log"
            fi
            exit 1
          }
          run "The image build failed" mscomputer build${cfg.mode === 'static' && !cfg.caddyfile ? ' --static' : ''} || exit 1
          deploy_app; RC=$?
          if [ "$RC" -ne 0 ]; then
            if grep -q APPLICATION_ALREADY_LIVE "$RUNNER_TEMP/last.log" && [[ "\${PREV_DEP:-}" =~ ^dep_[0-9a-f]+$ ]]; then
              echo "Replacing the previous preview ($PREV_DEP)."
              run "Taking the old preview down failed" mscomputer teardown "$PREV_DEP" || exit 1
              deploy_app || { annotate "Preview deploy failed after teardown" 1 "$RUNNER_TEMP/last.log"; exit 1; }
            else
              annotate "Preview deploy failed" "$RC" "$RUNNER_TEMP/last.log"
              exit 1
            fi
          fi
          URL=$(grep -oE 'https://[a-z0-9-]+\\.ms\\.computer' "$RUNNER_TEMP/last.log" | tail -1 || true)
          DEP_ID=$(jq -r '.deployment.id // empty' .mscomputer/state/deploy.json 2>/dev/null || true)
          [ -n "$DEP_ID" ] || DEP_ID=$(grep -oE 'dep_[0-9a-f]{8,}' "$RUNNER_TEMP/last.log" | tail -1 || true)
          echo "url=$URL" >> "$GITHUB_OUTPUT"
          echo "deployment_id=$DEP_ID" >> "$GITHUB_OUTPUT"
          echo "::notice title=Preview of PR #$PR::$URL"
          printf '### Preview of PR #%s\\n%s\\n' "$PR" "$URL" >> "$GITHUB_STEP_SUMMARY"

      - name: Record the preview on GitHub
        if: \${{ steps.deploy.outputs.deployment_id != '' }}
        working-directory: \${{ env.APP_DIR }}
        env:
          GH_TOKEN: \${{ github.token }}
          DEP_ID: \${{ steps.deploy.outputs.deployment_id }}
          URL: \${{ steps.deploy.outputs.url }}
        run: |
          set -euo pipefail
          KEY=$(sed -n 's/^key = "\\(.*\\)"/\\1/p' mscomputer.toml)
          PACK="$RUNNER_TEMP/preview-pack"
          rm -rf "$PACK" && mkdir -p "$PACK"
          cp mscomputer.toml "$PACK/"
          cp "$HOME/.config/mscomputer/applications/$KEY.secret" "$PACK/"
          IDENTITY=$(tar -cz -C "$PACK" . | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:KEYMAT | base64 -w0)
          rm -rf "$PACK"
          ID=$(jq -n --arg sha "$DEPLOY_SHA" --arg dep "$DEP_ID" --arg id "$IDENTITY" --argjson pr "$PR" \\
            '{ref: $sha, environment: "${PREVIEW_ENV}", auto_merge: false, required_contexts: [],
              production_environment: false, transient_environment: true,
              description: ("Preview of PR #" + ($pr | tostring) + " by Shipyard"),
              payload: {pr: $pr, ms_computer_deployment: $dep, identity: $id}}' \\
            | gh api "repos/$GITHUB_REPOSITORY/deployments" --input - --jq .id)
          # auto_inactive off: all PRs share one environment, and one PR's preview mustn't retire another's
          gh api "repos/$GITHUB_REPOSITORY/deployments/$ID/statuses" -f state=success -F auto_inactive=false \\
            -f environment_url="$URL" -f log_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" > /dev/null
          if [ -n "\${GH_PREVIEW:-}" ] && [ "$GH_PREVIEW" != "$ID" ]; then
            gh api "repos/$GITHUB_REPOSITORY/deployments/$GH_PREVIEW/statuses" -f state=inactive -F auto_inactive=false > /dev/null || true
          fi
          echo "Recorded the preview — it shows on the pull request as a deployment."

  preview-cleanup:
    needs: preview-ready
    if: \${{ needs.preview-ready.outputs.ready == 'true' && github.event.action == 'closed' }}
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    env:
      PR: \${{ github.event.pull_request.number }}
    steps:
${INSTALL_CLI}
      # Every record this PR left, newest first; each distinct app is taken down
      # once with its own key (from its newest record). Records of an app that's
      # already gone just get marked inactive.
      - name: Take the preview down
        env:
          GH_TOKEN: \${{ github.token }}
          APP_SECRET: \${{ secrets.MSCOMPUTER_APP_SECRET }}
        run: |
${RUN_HELPER}
          [[ "$PR" =~ ^[0-9]+$ ]] || { echo "::error::Unexpected PR number"; exit 1; }
          export KEYMAT=$(printf 'shipyard-preview:%s' "$APP_SECRET" | sha256sum | cut -d' ' -f1)
          echo "::add-mask::$KEYMAT"
          gh api "repos/$GITHUB_REPOSITORY/deployments?environment=${PREVIEW_ENV}&per_page=100" \\
            --jq "[.[] | select(.payload.pr? == $PR)]" | jq -c '.[]' > "$RUNNER_TEMP/records.jsonl" || true
          if [ ! -s "$RUNNER_TEMP/records.jsonl" ]; then
            echo "No preview on record for PR #$PR."
            exit 0
          fi
          SEEN=" "
          DOWN=0
          FAILED=0
          while IFS= read -r REC; do
            GH_ID=$(jq -r '.id' <<< "$REC")
            DEP=$(jq -r '.payload.ms_computer_deployment // empty' <<< "$REC")
            ID_DIR="$RUNNER_TEMP/id-$GH_ID"
            mkdir -p "$ID_DIR"
            if jq -r '.payload.identity // empty' <<< "$REC" | base64 -d \\
                | openssl enc -d -aes-256-cbc -pbkdf2 -pass env:KEYMAT | tar -xz -C "$ID_DIR" 2>/dev/null; then
              KEY=$(sed -n 's/^key = "\\(.*\\)"/\\1/p' "$ID_DIR/mscomputer.toml")
              if [[ "$SEEN" != *" $KEY "* ]] && [[ "$DEP" =~ ^dep_[0-9a-f]+$ ]]; then
                SEEN="$SEEN$KEY "
                ( umask 077; mkdir -p "$HOME/.config/mscomputer/applications"; cp "$ID_DIR"/*.secret "$HOME/.config/mscomputer/applications/" )
                APP="$RUNNER_TEMP/app-$GH_ID"
                mkdir -p "$APP"
                cp "$ID_DIR/mscomputer.toml" "$APP/"
                ( cd "$APP" && git init -q && git add -A \\
                  && git -c user.name="Shipyard" -c user.email="shipyard@users.noreply.github.com" commit -qm "Take the preview down" )
                if ( cd "$APP" && run - mscomputer teardown "$DEP" ); then
                  DOWN=$((DOWN + 1))
                else
                  FAILED=$((FAILED + 1))
                  annotate "Taking a preview down failed" 1 "$RUNNER_TEMP/last.log"
                fi
              fi
            else
              echo "::warning title=Preview key unreadable::Record $GH_ID was made with a different main app key; its preview may need taking down by hand."
            fi
            gh api "repos/$GITHUB_REPOSITORY/deployments/$GH_ID/statuses" -f state=inactive -F auto_inactive=false > /dev/null || true
          done < "$RUNNER_TEMP/records.jsonl"
          [ "$FAILED" -eq 0 ] || exit 1
          echo "::notice title=Preview taken down::PR #$PR is closed, so its preview is offline ($DOWN app$([ "$DOWN" -eq 1 ] || echo s))."
`
}

export function generateWorkflow(input: WorkflowConfig): string {
  const cfg: WorkflowConfig = { ...input, appName: normalizeAppName(input.appName) }
  if (cfg.redirectPages) {
    cfg.redirectPages = cfg.redirectPages.filter(([from, to]) => SAFE_FROM.test(from) && SAFE_TO.test(to) && from !== '/')
    if (!cfg.redirectPages.length) delete cfg.redirectPages
  }
  if (cfg.caddyfile && !/^[A-Za-z0-9._\/-]+$/.test(cfg.caddyfile)) delete cfg.caddyfile
  const appDirLine =
    cfg.mode === 'dynamic'
      ? `      - name: Locate the app
        run: echo "APP_DIR=$GITHUB_WORKSPACE/${cfg.workingDir === '.' ? '' : cfg.workingDir}" | sed 's#/$##' >> "$GITHUB_ENV"
`
      : stageStep(cfg)

  const embedded = JSON.stringify(Object.fromEntries(CONFIG_KEYS.filter((k) => cfg[k] !== undefined).map((k) => [k, cfg[k]])))
  return `# Deploys this repo to ms.computer on every push to ${cfg.branch}.
# Generated by Shipyard — https://github.com/mmdev94/shipyard
# shipyard-workflow: ${WORKFLOW_VERSION}
# shipyard-config: ${embedded}
name: Deploy to ms.computer
run-name: \${{ inputs.action == 'take-down' && 'Take the site down' || inputs.commit && format('Roll back to {0}', inputs.commit) || '' }}

on:
  push:
    branches: [${cfg.branch}]
${cfg.previews ? `  pull_request:\n    branches: [${cfg.branch}]\n    types: [opened, synchronize, reopened, closed]\n` : ''}  workflow_dispatch:
    inputs:
      action:
        description: What to do
        type: choice
        options: [deploy, take-down]
        default: deploy
      commit:
        description: Roll back — deploy this older commit (full SHA) until the next push
        required: false
      replace_deployment:
        description: Only if a failed run asks for it — the dep_… id of the live deployment to replace
        required: false

permissions:
  contents: read
  deployments: write
${cfg.attest ? '  id-token: write\n  attestations: write\n' : ''}
concurrency:
  group: ${cfg.previews ? "\${{ github.event_name == 'pull_request' && format('ms-computer-pr-{0}', github.event.pull_request.number) || 'ms-computer-deploy' }}" : 'ms-computer-deploy'}
  cancel-in-progress: false

env:
  APP_NAME: ${cfg.appName}

jobs:
  deploy:
    if: \${{ github.event_name != 'pull_request' && inputs.action != 'take-down' }}
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    steps:
${PREFLIGHT}
      - name: Check out
        uses: actions/checkout@v7
        with:
          ref: \${{ env.DEPLOY_SHA }}
          persist-credentials: false

${[setupSteps(cfg), cfg.mode === 'static' ? buildStep(cfg) : '', appDirLine, CLI_STEPS, deployStep(cfg)]
  .filter(Boolean)
  .join('\n')}${takeDownJob()}${cfg.previews ? previewJobs(cfg) : ''}`
}
