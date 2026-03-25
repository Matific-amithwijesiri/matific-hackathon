# Playwright locator auto-heal agent

## Overview

The auto-heal agent runs your Playwright tests, inspects failures, and tries to **fix broken `getByTestId(...)` locators** in page objects by comparing the failing test id to **`data-testid` values in static HTML** under `app/`. After a successful patch, it **saves the file** and **re-runs** the same test selection until the run passes or the retry limit is reached.

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
```

Always pass **`--`** before flags so npm forwards them to the script.

### Using Node directly

```bash
node scripts/heal-agent.mjs --grep TC01
node scripts/heal-agent.mjs --all
node scripts/heal-agent.mjs --grep TC01 --dry-run
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
| `--max-attempts N` | Maximum heal → re-run cycles (default: **3**). |
| `--dry-run` | Analyze failures and print the proposed change; **does not write** page object files. |
| `--help` / `-h` | Show usage. |

Use **either** `--grep` **or** `--all`, not both.

---

## Configuration

### Environment variables

| Variable | Purpose |
|----------|---------|
| `HEAL_MAX_EDIT_DISTANCE` | Maximum [Levenshtein](https://en.wikipedia.org/wiki/Levenshtein_distance) distance between the old `data-testid` and the chosen replacement in HTML (default: **15**). Increase only if you accept riskier renames. |
| `OPENAI_API_KEY` | If set, enables optional LLM-based line suggestions via OpenAI Chat Completions. |
| `OPENAI_MODEL` | Model name for OpenAI (default: **`gpt-4o-mini`**). |

Example:

```bash
HEAL_MAX_EDIT_DISTANCE=20 npm run heal -- --grep TC02
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
├── heal-agent.mjs          # CLI entry: run tests, resolve failure, patch, re-run loop
└── heal/
    ├── constants.mjs       # PAGE_OBJECT_TO_HTML, PAGES_DIR
    ├── runner.mjs          # Spawns Playwright, parses JSON report from stdout
    ├── report.mjs          # Walks JSON report and collects failed tests
    ├── heal.mjs            # Locator parsing, DOM test-id extraction, Levenshtein match, file patch
    └── ai.mjs              # Optional OpenAI chat completion for full-line replacements
```

- **`heal-agent.mjs`** wires everything together and handles `--dry-run`, `--max-attempts`, and browser-missing errors.
- **`heal/heal.mjs`** contains the core heuristic: read failing `getByTestId`, scan mapped HTML for `data-testid`, pick the closest new id (within `HEAL_MAX_EDIT_DISTANCE`), replace **one line** in the page object file.

---

## Behavior summary

1. Run Playwright with **`--reporter=json`** and capture the JSON report from stdout.
2. Take the **first failure**; read **`Locator:`** from the error and **`pages/*.js` stack frames** to find file and line.
3. For **`getByTestId('…')`**: load combined HTML for that page object; if the old id is missing, suggest the **closest** existing `data-testid` and patch that line.
4. If the old id **still appears** in static HTML, the heuristic may **skip** (failure might be timing or navigation); **OpenAI** can be tried if `OPENAI_API_KEY` is set.
5. Re-run the same **`--grep`** or **`--all`** until success or **`--max-attempts`**.

---

## Limitations

- Optimized for **`page.getByTestId(...)`** in **`pages/*.js`**. Other locator styles may need manual fixes or the OpenAI path.
- Uses **static files in `app/`**, not a live DOM after heavy client-side mutation; dynamic-only changes are not inferred from HTML alone.
- Patches **one failure at a time** per attempt; complex multi-locator breaks may need several runs or manual edits.

---

## CI / automation (optional)

For GitHub Actions or other pipelines, a typical sequence is:

1. Checkout repository and `npm ci`.
2. `npx playwright install --with-deps` (or the variant your image requires).
3. `npm run heal -- --all` or `npm run heal -- --grep 'Your test title'`.

Exit code **0** means the selected tests passed after healing; non-zero means failure or unrecoverable error. You can upload `test-results/` as artifacts if you enable additional reporters in `playwright.config.js` for those runs.
