import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectContext, describeBrowser, issueUrl, reportText, scrub, titleFor } from './report.ts'

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const EDGE = CHROME_WIN + ' Edg/131.0.0.0'

test('browsers are named simply', () => {
  assert.equal(describeBrowser(CHROME_WIN), 'Chrome 131 on Windows')
  assert.equal(describeBrowser(SAFARI_IOS), 'Safari 17 on iOS')
  assert.equal(describeBrowser(EDGE), 'Edge 131 on Windows')
})

test('tokens never make it into a report', () => {
  const pat = 'github_pat_' + 'A'.repeat(50)
  assert.equal(scrub(`my token is ${pat} oops`), 'my token is [token removed] oops')
  assert.equal(scrub('ghp_' + 'b'.repeat(36)), '[token removed]')
  const url = issueUrl({ kind: 'bug', what: `It failed with ${pat}`, steps: '', context: collectContext({ hash: '#/', commit: 'abc1234', builtAt: '2026-11-26T10:00:00Z', ua: CHROME_WIN, viewport: [1300, 900], connected: true, preset: { error: `401 for ${pat}` } }) })
  assert.ok(!decodeURIComponent(url).includes('AAAAAAAAAAAA'))
})

test('the link opens the right form with every field filled in', () => {
  const context = collectContext({ hash: '#/check/me/site', commit: 'abc1234', builtAt: '2026-11-26T10:00:00.000Z', ua: CHROME_WIN, viewport: [390, 860], connected: false, preset: { error: 'GitHub answered 502', details: ['Repo: me/site'] } })
  assert.deepEqual(context, [
    'Page: #/check/me/site',
    'Shipyard: abc1234 (built 2026-11-26 10:00 UTC)',
    'Browser: Chrome 131 on Windows · 390×860',
    'GitHub connected: no',
    'Repo: me/site',
    'Error: GitHub answered 502',
  ])
  const url = new URL(issueUrl({ kind: 'bug', what: 'Check never finishes\nIt just spins', steps: 'Pasted my repo', context }))
  assert.equal(url.origin + url.pathname, 'https://github.com/mmdev94/shipyard/issues/new')
  assert.equal(url.searchParams.get('template'), 'bug.yml')
  assert.equal(url.searchParams.get('title'), '[Bug] Check never finishes')
  assert.equal(url.searchParams.get('what'), 'Check never finishes\nIt just spins')
  assert.equal(url.searchParams.get('steps'), 'Pasted my repo')
  assert.match(url.searchParams.get('context')!, /^Page: #\/check\/me\/site\n/)
  assert.equal(new URL(issueUrl({ kind: 'idea', what: 'x', steps: '', context: [] })).searchParams.get('template'), 'idea.yml')
})

test('very long reports are trimmed to a link GitHub accepts, keeping the details', () => {
  const url = issueUrl({ kind: 'bug', what: 'word '.repeat(4000), steps: '', context: ['Page: #/'] })
  assert.ok(url.length <= 7000, String(url.length))
  assert.equal(new URL(url).searchParams.get('context'), 'Page: #/')
})

test('titles and plain text', () => {
  assert.equal(titleFor('idea', ''), '[Idea] An idea')
  assert.equal(titleFor('bug', 'x'.repeat(100)).length, '[Bug] '.length + 68)
  assert.equal(reportText({ kind: 'question', what: 'How do previews work?', steps: '', context: ['Page: #/'] }), '[Question] How do previews work?\n\nHow do previews work?\n\nPage: #/')
})
