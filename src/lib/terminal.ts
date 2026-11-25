// Terminal mode: the same three things one-click deploy does (setup secret,
// workflow commit, start + follow the run), as a script the visitor runs on
// their own computer with the GitHub CLI. No token ever reaches this page.

export type SetupTokenSource = 'gh' | 'paste'

export interface TerminalInput {
  owner: string
  repo: string
  branch: string
  yaml: string
  /** the tracker link printed at the end */
  trackUrl: string
  /** 'gh': use the CLI's own login as the setup token; 'paste': ask for a one-time token */
  setupToken: SetupTokenSource
}

/** Single-quotes a value for bash. */
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

const WORKFLOW_EOF = 'SHIPYARD_WORKFLOW_EOF'
const SCRIPT_EOF = 'SHIPYARD_SCRIPT_EOF'

/** The script itself — what the Download button saves. */
export function terminalScript(input: TerminalInput): string {
  const { owner, repo, branch, yaml, trackUrl, setupToken } = input
  if (yaml.split('\n').some((l) => l === WORKFLOW_EOF || l === SCRIPT_EOF)) throw new Error('workflow contains a heredoc marker')

  const saveSecret =
    setupToken === 'gh'
      ? `  # your gh login, piped straight into an encrypted repo secret (never printed)
  gh auth token | gh secret set SHIPYARD_SETUP_TOKEN --repo "$REPO"`
      : `  echo "     Paste the one-time setup token (input hidden), then press Enter:"
  IFS= read -rs TOKEN < /dev/tty
  echo
  [ -n "$TOKEN" ] || { echo "     No token pasted — stopping."; exit 1; }
  printf '%s' "$TOKEN" | gh secret set SHIPYARD_SETUP_TOKEN --repo "$REPO"
  unset TOKEN`

  return `# Shipyard — deploy ${owner}/${repo} to ms.computer, using the GitHub CLI.
# It runs on your computer with your own \`gh\` login: no token goes to Shipyard.
# What it does:
#   1. first deploy only: saves a setup token as the encrypted repo secret
#      SHIPYARD_SETUP_TOKEN — the workflow deletes it once the app's key is stored
#   2. commits .github/workflows/ms-computer.yml (or starts a run if it's unchanged)
#   3. follows the run and prints the live address
set -euo pipefail
REPO=${q(`${owner}/${repo}`)}
BRANCH=${q(branch)}
WF=.github/workflows/ms-computer.yml
TRACK=${q(trackUrl)}

command -v gh >/dev/null || { echo "Install the GitHub CLI first: https://cli.github.com"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Sign the GitHub CLI in first: gh auth login"; exit 1; }

echo "1/3  Setup secret"
if gh api "repos/$REPO/actions/variables/MSCOMPUTER_TOML" >/dev/null 2>&1; then
  echo "     Deployed before — the app keeps its key and address. Nothing to do."
else
${saveSecret}
  echo "     Saved as SHIPYARD_SETUP_TOKEN. The first deploy deletes it once the app's key is stored."
fi

echo "2/3  Workflow"
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
cat > "$TMP" <<'${WORKFLOW_EOF}'
${yaml.replace(/\n$/, '')}
${WORKFLOW_EOF}
NEW=$(base64 < "$TMP" | tr -d '\\n')
OLD=$(gh api "repos/$REPO/contents/$WF?ref=$BRANCH" --jq .content 2>/dev/null | tr -d '\\n' || true)
SHA=$(gh api "repos/$REPO/contents/$WF?ref=$BRANCH" --jq .sha 2>/dev/null || true)
PREV=$(gh run list --repo "$REPO" --workflow ms-computer.yml --branch "$BRANCH" --limit 1 --json databaseId --jq '.[0].databaseId // ""' 2>/dev/null || true)
if [ -n "$OLD" ] && [ "$NEW" = "$OLD" ]; then
  echo "     Already up to date — starting a run instead."
  gh workflow run ms-computer.yml --repo "$REPO" --ref "$BRANCH" -f action=deploy < /dev/null
else
  COMMIT=$(gh api -X PUT "repos/$REPO/contents/$WF" \\
    -f message="Deploy to ms.computer on every push (Shipyard)" \\
    -f content="$NEW" -f branch="$BRANCH" \${SHA:+-f sha=$SHA} --jq .commit.sha)
  echo "     Committed \${COMMIT:0:7} to $BRANCH — that push starts the deploy."
fi

echo "3/3  Deploy"
ID=""
for _ in $(seq 1 20); do
  ID=$(gh run list --repo "$REPO" --workflow ms-computer.yml --branch "$BRANCH" --limit 1 --json databaseId --jq '.[0].databaseId // ""' 2>/dev/null || true)
  if [ -n "$ID" ] && [ "$ID" != "$PREV" ]; then break; fi
  ID=""
  sleep 3
done
echo "     Follow it in the browser too: $TRACK"
if [ -z "$ID" ]; then
  echo "     GitHub is still queueing the run — the tracker picks it up."
  exit 0
fi
if ! gh run watch "$ID" --repo "$REPO" --exit-status; then
  echo
  echo "The run stopped. The tracker shows why, in plain words: $TRACK"
  exit 1
fi
DEP=$(gh api "repos/$REPO/deployments?environment=ms-computer&per_page=1" --jq '.[0].id // ""' 2>/dev/null || true)
URL=""
[ -z "$DEP" ] || URL=$(gh api "repos/$REPO/deployments/$DEP/statuses?per_page=1" --jq '.[0].environment_url // ""' 2>/dev/null || true)
echo
echo "Live: \${URL:-see $TRACK}"
`
}

/** The paste-into-a-terminal form: the script fed to a fresh bash, so `set -e` can't close the visitor's shell. */
export function terminalCommand(input: TerminalInput): string {
  return `bash <<'${SCRIPT_EOF}'\n${terminalScript(input)}${SCRIPT_EOF}\n`
}
