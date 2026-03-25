import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { PAGE_OBJECT_TO_HTML, PAGES_DIR } from './constants.mjs';

const LOCATOR_LINE_RE =
  /(page\.(?:getByTestId|getByRole|getByLabel|getByPlaceholder|getByText|locator)\([^)]*\))/;

/**
 * Extract Playwright "Locator: ..." line from error message.
 */
export function extractLocatorFromError(message) {
  if (!message) return null;
  const m = message.match(/Locator:\s*([^\n]+)/);
  if (!m) return null;
  return m[1].trim();
}

/**
 * Parse getByTestId('id') or getByTestId("id") from a locator snippet.
 */
export function parseGetByTestId(locatorStr) {
  const m = locatorStr.match(/getByTestId\(\s*['"]([^'"]+)['"]\s*\)/);
  return m ? m[1] : null;
}

/**
 * Find stack frames pointing at pages/*.js:line
 */
export function extractPageObjectFrame(stack, projectRoot) {
  if (!stack) return null;
  const matches = [...stack.matchAll(/pages\/([^/\s]+\.js):(\d+)/g)];
  if (!matches.length) return null;
  const last = matches[matches.length - 1];
  const fileName = last[1];
  const line = parseInt(last[2], 10);
  const abs = path.join(projectRoot, PAGES_DIR, fileName);
  return { fileName, line, absPath: abs };
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

export function collectDataTestIds(html) {
  const ids = new Set();
  const re = /data-testid\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) ids.add(m[1]);
  return [...ids];
}

export function pickClosestTestId(oldId, candidates) {
  if (!candidates.length) return null;
  let best = candidates[0];
  let bestScore = Infinity;
  for (const c of candidates) {
    const d = levenshtein(oldId, c);
    if (d < bestScore) {
      bestScore = d;
      best = c;
    }
  }
  if (best === oldId) return null;
  return { testId: best, distance: bestScore };
}

export function pageObjectBaseName(absPath) {
  return path.basename(absPath, '.js');
}

export async function loadDomForPageObject(projectRoot, pageFileBase) {
  const htmlNames = PAGE_OBJECT_TO_HTML[pageFileBase];
  if (!htmlNames) return { combinedHtml: '', htmlFiles: [] };
  const parts = [];
  const htmlFiles = [];
  for (const name of htmlNames) {
    const p = path.join(projectRoot, 'app', name);
    try {
      const html = await readFile(p, 'utf8');
      parts.push(html);
      htmlFiles.push(p);
    } catch {
      /* skip missing */
    }
  }
  return { combinedHtml: parts.join('\n'), htmlFiles };
}

/**
 * Find pages/*.js line containing the same getByTestId as in the error.
 */
export async function findPageLineByTestId(projectRoot, testId) {
  const dir = path.join(projectRoot, PAGES_DIR);
  const names = await readdir(dir);
  const files = names.filter((n) => n.endsWith('.js')).map((n) => path.join(dir, n));
  const needle = `getByTestId('${testId}')`;
  const needle2 = `getByTestId("${testId}")`;
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(needle) || lines[i].includes(needle2)) {
        return { absPath: file, line: i + 1, content };
      }
    }
  }
  return null;
}

/**
 * Decide new locator string for a failing getByTestId using static DOM.
 */
export async function suggestTestIdHeal(projectRoot, { oldTestId, pageObjectPath }) {
  const maxDist = Math.max(
    1,
    parseInt(process.env.HEAL_MAX_EDIT_DISTANCE || '15', 10) || 15
  );
  const base = pageObjectBaseName(pageObjectPath);
  const { combinedHtml } = await loadDomForPageObject(projectRoot, base);
  const ids = collectDataTestIds(combinedHtml);
  if (ids.includes(oldTestId)) {
    return {
      kind: 'noop',
      reason: `data-testid "${oldTestId}" exists in ${base} DOM snapshot — failure may be timing, navigation, or visibility.`,
    };
  }
  const pick = pickClosestTestId(oldTestId, ids);
  if (!pick) {
    return { kind: 'fail', reason: 'No data-testid attributes found in mapped HTML.' };
  }
  if (pick.distance > maxDist) {
    return {
      kind: 'fail',
      reason: `Closest data-testid "${pick.testId}" is edit distance ${pick.distance} (max ${maxDist}). Set HEAL_MAX_EDIT_DISTANCE to allow.`,
    };
  }
  return {
    kind: 'replace',
    oldTestId,
    newTestId: pick.testId,
    distance: pick.distance,
  };
}

export function replaceGetByTestIdOnLine(line, oldId, newId) {
  const patterns = [
    [`getByTestId('${oldId}')`, `getByTestId('${newId}')`],
    [`getByTestId("${oldId}")`, `getByTestId("${newId}")`],
  ];
  let out = line;
  for (const [a, b] of patterns) {
    if (out.includes(a)) return out.split(a).join(b);
  }
  return null;
}

export async function applyTestIdPatch(absPath, lineNumber, oldId, newId) {
  const raw = await readFile(absPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const idx = lineNumber - 1;
  if (idx < 0 || idx >= lines.length) return { ok: false, reason: 'Line out of range' };
  const replaced = replaceGetByTestIdOnLine(lines[idx], oldId, newId);
  if (!replaced) return { ok: false, reason: 'Could not replace getByTestId on that line' };
  lines[idx] = replaced;
  const next = lines.join('\n');
  await writeFile(absPath, next, 'utf8');
  return { ok: true, newContent: next };
}

/**
 * Resolve page object file + line + old test id from first failure.
 */
export async function resolveHealTarget(projectRoot, failure) {
  const { errorMessage, stack } = failure;
  const locatorLine = extractLocatorFromError(errorMessage);
  const fromError = locatorLine ? parseGetByTestId(locatorLine) : null;
  const frame = extractPageObjectFrame(stack, projectRoot);

  if (frame && fromError) {
    const raw = await readFile(frame.absPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    const lineStr = lines[frame.line - 1] || '';
    const lineHasSameId =
      lineStr.includes(`'${fromError}'`) ||
      lineStr.includes(`"${fromError}"`);
    if (lineHasSameId) {
      return { pagePath: frame.absPath, line: frame.line, oldTestId: fromError };
    }
    const found = await findPageLineByTestId(projectRoot, fromError);
    if (found) {
      return { pagePath: found.absPath, line: found.line, oldTestId: fromError };
    }
    return { pagePath: frame.absPath, line: frame.line, oldTestId: fromError };
  }

  if (fromError) {
    const found = await findPageLineByTestId(projectRoot, fromError);
    if (found) {
      return { pagePath: found.absPath, line: found.line, oldTestId: fromError };
    }
  }

  if (frame) {
    const raw = await readFile(frame.absPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    const line = lines[frame.line - 1] || '';
    const m = line.match(/getByTestId\(\s*['"]([^'"]+)['"]\s*\)/);
    if (m) {
      return {
        pagePath: frame.absPath,
        line: frame.line,
        oldTestId: m[1],
      };
    }
    const loc = line.match(LOCATOR_LINE_RE);
    return {
      pagePath: frame.absPath,
      line: frame.line,
      oldTestId: null,
      rawLocator: loc ? loc[1] : line.trim(),
    };
  }

  return null;
}

export function isBrowserMissingError(message) {
  return (
    typeof message === 'string' &&
    (message.includes("Executable doesn't exist") || message.includes('npx playwright install'))
  );
}
