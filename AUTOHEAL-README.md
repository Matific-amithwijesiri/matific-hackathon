# Playwright locator auto-heal agent

## Overview

The auto-heal agent runs your Playwright tests, inspects failures, and fixes **`getByTestId(...)` drift** by comparing locators to **`data-testid` values in static HTML** under `app/`.

On each failed run it does **not** only fix the single failing assertion: it picks the relevant `pages/*.js` files (from stacks, or **all** page objects if it cannot infer any), then **scans every `getByTestId` in those files** against the mapped HTML and applies **all** needed replacements in one batch. After that it may add **supplemental** fixes for failures on lines the scan did not touch, then **re-runs** tests until they pass or `--max-attempts` is exceeded.

You can also run **`--scan-all-pages`** with **no Playwright run** to sync every page object file to static HTML in one shot.

Optional **OpenAI** integration can suggest a full replacement line when the heuristic cannot safely change a test id (for example, the id still exists in HTML but the test failed for another reason, or the locator is not a simple `getByTestId`).

**Requirements:** Node.js, `@playwright/test`, Playwright browsers (`npx playwright install`), and the app served as configured in `playwright.config.js` (the heal flow uses the same `webServer` as normal test runs).

---

## Prerequisites

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Install Playwright browsers** (required once per machine or CI image)

   ```bash
   npx playwright install
   ```

3. **Static app + server** — The project serves `app/` via the `webServer` block in `playwright.config.js`. The heal runner invokes `playwright test` the same way as `npm test`, so no extra server step is needed for local use.

---

## How to run

### Using npm script

```bash
# Single test (Playwright --grep; matches test title by regex)
npm run heal -- --grep "TC01 - valid login lands on dashboard"
npm run heal -- --grep TC01

# Entire suite
npm run heal -- --all

# Preview what would be patched (no file writes)
npm run heal -- --grep TC01 --dry-run

# No tests: scan every page object and fix all drifted getByTestId values
npm run heal -- --scan-all-pages
```

Always pass **`--`** before flags so npm forwards them to the script.

### Using Node directly

```bash
node scripts/heal-agent.mjs --grep TC01
node scripts/heal-agent.mjs --all
node scripts/heal-agent.mjs --grep TC01 --dry-run
node scripts/heal-agent.mjs --scan-all-pages
```

### Help

```bash
node scripts/heal-agent.mjs --help
```

---

## CLI options

| Option | Description |
|--------|-------------|
| `--grep <pattern>` | Same as Playwright: run only tests whose title matches the regex. |
| `--all` | Run the full test suite (same as `playwright test` with no grep). |
| `--scan-all-pages` | No tests: scan every `pages/*.js` and fix all drifted `getByTestId` values. |
| `--max-attempts N` | Maximum heal → re-run cycles (default: **3**; not used with `--scan-all-pages`). |
| `--dry-run` | Print planned patches; **does not write** page object files. |
| `--help` / `-h` | Show usage. |

Use **exactly one** of `--grep`, `--all`, or `--scan-all-pages`.

---

## Configuration

### Environment variables

| Variable | Purpose |
|----------|---------|
| `HEAL_MAX_EDIT_DISTANCE` | Optional **warning** threshold only: if set (e.g. `15`), the agent logs a warning when the chosen DOM `data-testid` has a larger case-insensitive Levenshtein distance than this value. **Replacements are always applied** when the old id is missing from the HTML; there is no hard cap. |
| `OPENAI_API_KEY` | If set, enables optional LLM-based line suggestions via OpenAI Chat Completions. |
| `OPENAI_MODEL` | Model name for OpenAI (default: **`gpt-4o-mini`**). |

Example:

```bash
HEAL_MAX_EDIT_DISTANCE=20 npm run heal -- --grep TC02   # warn when match is weaker than distance 20
OPENAI_API_KEY=sk-... npm run heal -- --grep TC01
```

### Page object → HTML map

The agent only knows which `app/*.html` files belong to which page object by the map in:

**`scripts/heal/constants.mjs`**

```js
export const PAGE_OBJECT_TO_HTML = {
  LoginPage: ['index.html'],
  DashboardPage: ['dashboard.html'],
  ContactFormPage: ['forms.html'],
  RegistrationFormPage: ['form2.html'],
  FeedbackFormPage: ['form3.html'],
  HelpPage: ['help.html'],
};
```

When you add a new page object and HTML file, **add an entry here** so DOM analysis includes the right static files. Multiple files per page are supported (array of filenames under `app/`).

### Playwright config

Heal runs **`playwright test`** with the project’s `playwright.config.js` (timeouts, `baseURL`, `webServer`, etc.). To change how tests execute during heal, edit **`playwright.config.js`** (not the heal scripts).

---

## Code structure

```
scripts/
├── heal-agent.mjs          # CLI: tests + full-file DOM scan, batch patch, re-run (or --scan-all-pages)
└── heal/
    ├── constants.mjs       # PAGE_OBJECT_TO_HTML, PAGES_DIR
    ├── runner.mjs          # Spawns Playwright, parses JSON report from stdout
    ├── report.mjs          # Walks JSON report and collects failed tests
    ├── heal.mjs            # Locator parsing, DOM test-id extraction, Levenshtein match, file patch
    └── ai.mjs              # Optional OpenAI chat completion for full-line replacements
```

- **`heal-agent.mjs`** wires everything together and handles `--dry-run`, `--max-attempts`, `--scan-all-pages`, and browser-missing errors.
- **`heal/heal.mjs`** parses **`getByTestId`** usages, scans mapped HTML for `data-testid`, picks the closest new id (within `HEAL_MAX_EDIT_DISTANCE`), and applies batched line edits.

---

## Behavior summary

1. Run Playwright (unless `--scan-all-pages`) and read the JSON report from the configured output file.
2. Determine which **page object files** to scan: from failure stacks / `resolveHealTarget`, or **all** `pages/*.js` if none are found.
3. For each file, **extract every `getByTestId('…')`**, including **`this.propertyName = page.getByTestId(...)`** so the **property name** (e.g. `emailInput`) can be matched to DOM ids like `login-email`. Stale locators on the same page are assigned **unique** DOM `data-testid` values in one pass (greedy by a combined property + string similarity score), so two broken locators do not map to the same DOM id unless there are more fixes than distinct ids (then a warning is logged). **Supplemental** heals from test failures respect the same reserved set per page class.
4. Merge **supplemental** `getByTestId` fixes for failures on lines the scan did not change; queue **OpenAI** full-line fixes for non–`getByTestId` / noop cases when `OPENAI_API_KEY` is set.
5. Apply **all** patches in one batch, then re-run tests (`--last-failed` on later attempts) until success or **`--max-attempts`**.

---

## Limitations

- Optimized for **`page.getByTestId(...)`** anywhere in **`pages/*.js`**. Other locator styles may need manual fixes or the OpenAI path.
- Uses **static files in `app/`**, not a live DOM after heavy client-side mutation; dynamic-only changes are not inferred from HTML alone.
- Page objects **without** an entry in `PAGE_OBJECT_TO_HTML` are skipped in the full-file scan; failures there still get per-failure `suggestTestIdHeal` if possible.

---

## CI / automation (optional)

For GitHub Actions or other pipelines, a typical sequence is:

1. Checkout repository and `npm ci`.
2. `npx playwright install --with-deps` (or the variant your image requires).
3. `npm run heal -- --all` or `npm run heal -- --grep 'Your test title'`.

Exit code **0** means the selected tests passed after healing; non-zero means failure or unrecoverable error. You can upload `test-results/` as artifacts if you enable additional reporters in `playwright.config.js` for those runs.
