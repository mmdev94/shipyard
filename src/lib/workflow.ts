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
  /** A lockfile is committed. Without one, installs aren't frozen or cached. Defaults to true. */
  hasLockfile?: boolean
  /**
   * Static sites in a public repo: record a signed build-provenance attestation
   * (Sigstore, via GitHub) for every built file, so anyone can check that the
   * files a site serves came from this repo's workflow at a given commit.
   */
  attest?: boolean
}

/** Bumped whenever generated workflows change, so the dashboard can offer an update. */
export const WORKFLOW_VERSION = 4

const CONFIG_KEYS = ['appName', 'mode', 'branch', 'packageManager', 'nodeVersion', 'buildCommand', 'outputDir', 'workingDir', 'packageManagerPinned', 'hasLockfile', 'attest'] as const

/** Reads the config Shipyard embedded in a workflow it generated (null for other files). */
export function readWorkflowConfig(yaml: string): { version: number; config: WorkflowConfig } | null {
  const v = /^# shipyard-workflow: (\d+)$/m.exec(yaml)
  const c = /^# shipyard-config: (\{.*\})$/m.exec(yaml)
  if (!v || !c) return null
  try {
    const raw = JSON.parse(c[1]) as Record<string, unknown>
    const config = Object.fromEntries(CONFIG_KEYS.filter((k) => k in raw).map((k) => [k, raw[k]])) as unknown as WorkflowConfig
    if (typeof config.appName !== 'string' || (config.mode !== 'static' && config.mode !== 'dynamic')) return null
    return { version: Number(v[1]), config }
  } catch {
    return null
  }
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
          DESC="Deployed by Shipyard"
          [ -z "\${ROLLBACK:-}" ] || DESC="Rolled back by Shipyard"
          ID=$(jq -n --arg sha "$DEPLOY_SHA" --arg dep "$DEP_ID" --arg desc "$DESC" \\
            '{ref: $sha, environment: "ms-computer", auto_merge: false, required_contexts: [],
              production_environment: true, description: $desc,
              payload: {ms_computer_deployment: $dep}}' \\
            | gh api "repos/$GITHUB_REPOSITORY/deployments" --input - --jq .id)
          gh api "repos/$GITHUB_REPOSITORY/deployments/$ID/statuses" -f state=success \\
            -f environment_url="$URL" -f log_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" > /dev/null
          echo "Recorded $DEP_ID — the next push replaces it."
          if [ -n "\${ROLLBACK:-}" ]; then
            echo "::notice title=Rolled back::Live on \${DEPLOY_SHA::7}. The next push to \${GITHUB_REF_NAME} deploys the latest commit again."
          fi

      # The setup token's only job is the save below. Once it's done the token
      # deletes itself, so it never outlives the first deploy — whether or not
      # anyone is watching. A token left by an older workflow is removed too.
      - name: Save the app identity and delete the setup token
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

export function generateWorkflow(input: WorkflowConfig): string {
  const cfg = { ...input, appName: normalizeAppName(input.appName) }
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
  workflow_dispatch:
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
  group: ms-computer-deploy
  cancel-in-progress: false

env:
  APP_NAME: ${cfg.appName}

jobs:
  deploy:
    if: \${{ inputs.action != 'take-down' }}
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
  .join('\n')}${takeDownJob()}`
}
