// Generates the GitHub Actions workflow that deploys a repo to ms.computer.
//
// Design notes (from `mscomputer docs agents`):
// - The CLI gets a free 6-hour token by itself, so no account or token setup.
// - The first deploy creates an application key (in mscomputer.toml) and a
//   one-time application secret. The secret is the only lasting authority over
//   the app, so it must survive between runs. We save it to the repo's GitHub
//   secrets (base64, never printed) and the toml to a repo variable, using a
//   one-time setup token. GITHUB_TOKEN can't write secrets, hence the PAT.
// - Static sites can't be replaced in place (APPLICATION_ALREADY_LIVE), so on
//   update we build first, then tear down and redeploy. The hostname stays
//   reserved for the app, so the URL doesn't change.
// - Teardown needs the live deployment's dep_… id, and the CLI keeps it only in
//   a local file that a fresh runner doesn't have. So every successful deploy is
//   recorded as a GitHub Deployment (environment "ms-computer") carrying the id;
//   the next run reads it back. That needs only GITHUB_TOKEN with
//   deployments: write — no long-lived PAT — and gives the repo page a link to
//   the live site. A manual run can pass the id for sites deployed before that.
// - Only `push` and `workflow_dispatch` trigger it — never pull requests — so
//   forks can never reach the secret.

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'none'
export type DeployMode = 'static' | 'dynamic'

export interface WorkflowConfig {
  appName: string
  mode: DeployMode
  branch: string
  packageManager: PackageManager
  nodeVersion: string
  /** Shell command(s) that build the site. Empty for plain HTML. */
  buildCommand: string
  /** Folder that holds the built site (static mode). "." for plain HTML. */
  outputDir: string
  /** Subfolder the app lives in, for monorepos. "." for the repo root. */
  workingDir: string
  /** package.json has a "packageManager" field, so setup actions read the version from it. */
  packageManagerPinned?: boolean
}

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

function installCommand(pm: PackageManager): string {
  switch (pm) {
    case 'pnpm':
      return 'pnpm install --frozen-lockfile'
    case 'yarn':
      return 'yarn install --frozen-lockfile'
    case 'bun':
      return 'bun install --frozen-lockfile'
    case 'npm':
      return 'npm ci'
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
    const cache = cfg.packageManager === 'npm' || cfg.packageManager === 'pnpm' || cfg.packageManager === 'yarn'
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
  const cmds = [installCommand(cfg.packageManager), cfg.buildCommand.trim()].filter(Boolean)
  if (cmds.length === 0) return ''
  return `      - name: Install and build
        working-directory: ${cfg.workingDir}
        run: |
${cmds.map((c) => `          ${c}`).join('\n')}
`
}

const CLI_STEPS = `      - name: Install the ms.computer CLI
        run: |
          curl -fsSL https://get.ms.computer/install.sh | sh
          echo "$HOME/.local/bin" >> "$GITHUB_PATH"

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
          }`

function deployStep(cfg: WorkflowConfig): string {
  const teardownFallback =
    cfg.mode === 'static'
      ? `            if grep -q APPLICATION_ALREADY_LIVE "$RUNNER_TEMP/last.log"; then
              echo "Static sites can't be swapped in place — taking the old version down and shipping the new one."
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
              run "Deploy failed after teardown" mscomputer deploy --name "$APP_NAME" || exit 1
            else
              annotate "Deploy failed" "$RC" "$RUNNER_TEMP/last.log"
              exit 1
            fi`
      : `            annotate "Deploy failed" "$RC" "$RUNNER_TEMP/last.log"
            exit 1`
  return `      - name: Plan and build the image
        working-directory: \${{ env.APP_DIR }}
        run: |
${RUN_HELPER}
          run "ms.computer couldn't plan this app" mscomputer plan --write --json || exit 1
          run "The image build failed" mscomputer build${cfg.mode === 'static' ? ' --static' : ''} || exit 1

      - name: Deploy
        id: deploy
        working-directory: \${{ env.APP_DIR }}
        env:
          GH_TOKEN: \${{ github.token }}
          REPLACE_DEPLOYMENT: \${{ inputs.replace_deployment }}
        run: |
${RUN_HELPER}
          run - mscomputer deploy --name "$APP_NAME"; RC=$?
          if [ "$RC" -ne 0 ]; then
${teardownFallback}
          fi
          URL=$(grep -oE 'https://[a-z0-9-]+\\.ms\\.computer' "$RUNNER_TEMP/last.log" | tail -1 || true)
          DEP_ID=$(jq -r '.deployment.id // empty' .mscomputer/state/deploy.json 2>/dev/null || true)
          [ -n "$DEP_ID" ] || DEP_ID=$(grep -oE 'dep_[0-9a-f]{8,}' "$RUNNER_TEMP/last.log" | tail -1 || true)
          echo "url=$URL" >> "$GITHUB_OUTPUT"
          echo "deployment_id=$DEP_ID" >> "$GITHUB_OUTPUT"
          echo "::notice title=Live on ms.computer::$URL"
          printf '### Live on ms.computer\\n%s\\n' "$URL" >> "$GITHUB_STEP_SUMMARY"

      - name: Record the deployment on GitHub
        if: \${{ steps.deploy.outputs.deployment_id != '' }}
        env:
          GH_TOKEN: \${{ github.token }}
          DEP_ID: \${{ steps.deploy.outputs.deployment_id }}
          URL: \${{ steps.deploy.outputs.url }}
        run: |
          set -euo pipefail
          ID=$(jq -n --arg sha "$GITHUB_SHA" --arg dep "$DEP_ID" \
            '{ref: $sha, environment: "ms-computer", auto_merge: false, required_contexts: [],
              production_environment: true, description: "Deployed by Shipyard",
              payload: {ms_computer_deployment: $dep}}' \
            | gh api "repos/$GITHUB_REPOSITORY/deployments" --input - --jq .id)
          gh api "repos/$GITHUB_REPOSITORY/deployments/$ID/statuses" -f state=success \
            -f environment_url="$URL" -f log_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" > /dev/null
          echo "Recorded $DEP_ID — the next push replaces it."

      - name: Save the app identity (first deploy only)
        if: \${{ vars.MSCOMPUTER_TOML == '' }}
        env:
          GH_TOKEN: \${{ secrets.SHIPYARD_SETUP_TOKEN }}
        run: |
          set -euo pipefail
          KEY=$(sed -n 's/^key = "\\(.*\\)"/\\1/p' "$APP_DIR/mscomputer.toml")
          base64 -w0 "$HOME/.config/mscomputer/applications/$KEY.secret" \\
            | gh secret set MSCOMPUTER_APP_SECRET --repo "$GITHUB_REPOSITORY"
          gh variable set MSCOMPUTER_TOML --repo "$GITHUB_REPOSITORY" < "$APP_DIR/mscomputer.toml"
          echo "Saved — future pushes update this same app and URL. You can delete SHIPYARD_SETUP_TOKEN now."
`
}

const PREFLIGHT = `      - name: Check setup
        env:
          MSCOMPUTER_TOML: \${{ vars.MSCOMPUTER_TOML }}
          SETUP_TOKEN: \${{ secrets.SHIPYARD_SETUP_TOKEN }}
        run: |
          if [ -z "$MSCOMPUTER_TOML" ] && [ -z "$SETUP_TOKEN" ]; then
            echo "::error::First deploy needs the SHIPYARD_SETUP_TOKEN secret so it can save the app's identity. Without it, later pushes couldn't update the site. See the Shipyard setup guide."
            exit 1
          fi
`

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
          cd "$APP_DIR"
          git init -q
          git add -A
          git -c user.name="Shipyard" -c user.email="shipyard@users.noreply.github.com" commit -qm "Build \${GITHUB_SHA::7}"
          echo "APP_DIR=$APP_DIR" >> "$GITHUB_ENV"
`
}

export function generateWorkflow(input: WorkflowConfig): string {
  const cfg = { ...input, appName: normalizeAppName(input.appName) }
  const appDirLine =
    cfg.mode === 'dynamic'
      ? `      - name: Locate the app
        run: echo "APP_DIR=$GITHUB_WORKSPACE/${cfg.workingDir === '.' ? '' : cfg.workingDir}" | sed 's#/$##' >> "$GITHUB_ENV"
`
      : stageStep(cfg)

  return `# Deploys this repo to ms.computer on every push to ${cfg.branch}.
# Generated by Shipyard. Setup guide: https://shipyard.ms.computer
name: Deploy to ms.computer

on:
  push:
    branches: [${cfg.branch}]
  workflow_dispatch:
    inputs:
      replace_deployment:
        description: Only if a failed run asks for it — the dep_… id of the live deployment to replace
        required: false

permissions:
  contents: read
  deployments: write

concurrency:
  group: ms-computer-deploy
  cancel-in-progress: false

env:
  APP_NAME: ${cfg.appName}

jobs:
  deploy:
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    steps:
${PREFLIGHT}
      - name: Check out
        uses: actions/checkout@v7
        with:
          persist-credentials: false

${[setupSteps(cfg), cfg.mode === 'static' ? buildStep(cfg) : '', appDirLine, CLI_STEPS, deployStep(cfg)]
  .filter(Boolean)
  .join('\n')}`
}
