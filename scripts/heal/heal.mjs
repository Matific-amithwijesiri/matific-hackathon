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

function normalizeForMatch(s) {
  return String(s).toLowerCase();
}

function tokenOverlap(a, b) {
  const ta = new Set(
    normalizeForMatch(a)
      .split(/[-_\s.]+/)
      .filter((t) => t.length > 0)
  );
  const tb = new Set(
    normalizeForMatch(b)
      .split(/[-_\s.]+/)
      .filter((t) => t.length > 0)
  );
  if (ta.size === 0 || tb.size === 0) return 0;
  let n = 0;
  for (const t of ta) {
    if (tb.has(t)) n += 1;
  }
  return n;
}

function compareSuitability(a, b) {
  if (a.lev !== b.lev) return a.lev - b.lev;
  if (b.overlap !== a.overlap) return b.overlap - a.overlap;
  return a.lenPen - b.lenPen;
}

/**
 * Pick the single best data-testid string for a stale page-object id:
 * lowest case-insensitive Levenshtein distance, then token-overlap tie-break, then length closeness.
 */
export function pickMostSuitableTestId(oldId, candidates) {
  if (!candidates.length) return null;
  const uniq = [...new Set(candidates)];
  const normOld = normalizeForMatch(oldId);
  let best = null;
  for (const c of uniq) {
    if (c === oldId) continue;
    const lev = levenshtein(normOld, normalizeForMatch(c));
    const overlap = tokenOverlap(oldId, c);
    const lenPen = Math.abs(oldId.length - c.length);
    const scored = { testId: c, distance: lev, overlap, lenPen };
    if (!best || compareSuitability(scored, best) < 0) {
      best = scored;
    }
  }
  if (!best) return null;
  return { testId: best.testId, distance: best.distance };
}

/** @deprecated Use pickMostSuitableTestId — kept for compatibility */
export function pickClosestTestId(oldId, candidates) {
  return pickMostSuitableTestId(oldId, candidates);
}

export function pageObjectBaseName(absPath) {
  return path.basename(absPath, '.js');
}

/**
 * If HEAL_MAX_EDIT_DISTANCE is set, log a warning when the chosen match exceeds this Levenshtein distance
 * (replacement is still applied — there is no hard cap).
 */
export function getWarnEditDistanceThreshold() {
  const raw = process.env.HEAL_MAX_EDIT_DISTANCE;
  if (raw === undefined || raw === '') return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Compare one test id to the set of data-testid values from static HTML.
 * When the id is missing from the DOM, always maps to the most suitable candidate (no distance cap).
 */
export function evaluateTestIdAgainstDom(oldTestId, ids, baseName) {
  if (ids.includes(oldTestId)) {
    return {
      kind: 'noop',
      reason: `data-testid "${oldTestId}" exists in ${baseName} DOM snapshot — failure may be timing, navigation, or visibility.`,
    };
  }
  if (!ids.length) {
    return { kind: 'fail', reason: 'No data-testid attributes found in mapped HTML.' };
  }
  const pick = pickMostSuitableTestId(oldTestId, ids);
  if (!pick) {
    return { kind: 'fail', reason: 'Could not choose a data-testid from DOM candidates.' };
  }
  const warnAbove = getWarnEditDistanceThreshold();
  if (warnAbove !== null && pick.distance > warnAbove) {
    console.warn(
      `[heal] ${baseName}: "${oldTestId}" → "${pick.testId}" (string distance ${pick.distance}; ` +
        `HEAL_MAX_EDIT_DISTANCE=${warnAbove} exceeded — still applying best DOM match).`
    );
  }
  return {
    kind: 'replace',
    oldTestId,
    newTestId: pick.testId,
    distance: pick.distance,
  };
}

/**
 * Every getByTestId('…') or getByTestId("…") in source, with 1-based line number.
 */
export function extractGetByTestIdAssignments(content) {
  const lines = content.split(/\r?\n/);
  const entries = [];
  const re = /getByTestId\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    const r = new RegExp(re.source, 'g');
    while ((m = r.exec(line)) !== null) {
      entries.push({ line: i + 1, oldTestId: m[1] });
    }
  }
  return entries;
}

export async function listAllPageObjectPaths(projectRoot) {
  const dir = path.join(projectRoot, PAGES_DIR);
  const names = await readdir(dir);
  return names.filter((n) => n.endsWith('.js')).map((n) => path.join(dir, n)).sort();
}

/**
 * Page objects implicated by failure stacks + resolveHealTarget; if none, all pages/*.js.
 */
export async function resolvePageFilesToScan(projectRoot, failures) {
  const set = new Set();
  for (const f of failures) {
    const frame = extractPageObjectFrame(f.stack, projectRoot);
    if (frame?.absPath) set.add(path.resolve(frame.absPath));
    const target = await resolveHealTarget(projectRoot, f);
    if (target?.pagePath) set.add(path.resolve(target.pagePath));
  }
  if (set.size === 0) {
    for (const p of await listAllPageObjectPaths(projectRoot)) {
      set.add(path.resolve(p));
    }
  }
  return [...set].sort();
}

/**
 * Scan one page object file: every getByTestId vs mapped static HTML; emit replace patches for drift.
 */
export async function scanPageObjectFileForDrift(projectRoot, absPath) {
  const base = pageObjectBaseName(absPath);
  if (!PAGE_OBJECT_TO_HTML[base]) {
    return {
      patches: [],
      skipReason: `No HTML map for "${base}" in scripts/heal/constants.mjs — skipping ${path.basename(absPath)}`,
    };
  }
  const content = await readFile(absPath, 'utf8');
  const assignments = extractGetByTestIdAssignments(content);
  const { combinedHtml } = await loadDomForPageObject(projectRoot, base);
  const ids = collectDataTestIds(combinedHtml);
  const patches = [];
  for (const a of assignments) {
    const ev = evaluateTestIdAgainstDom(a.oldTestId, ids, base);
    if (ev.kind === 'replace') {
      patches.push({
        pagePath: absPath,
        line: a.line,
        oldTestId: ev.oldTestId,
        newTestId: ev.newTestId,
        distance: ev.distance,
        testTitle: '(DOM scan)',
      });
    }
  }
  return { patches };
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
  const base = pageObjectBaseName(pageObjectPath);
  const { combinedHtml } = await loadDomForPageObject(projectRoot, base);
  const ids = collectDataTestIds(combinedHtml);
  return evaluateTestIdAgainstDom(oldTestId, ids, base);
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
 * Deduplicate batch patches; same file/line/oldId must agree on newTestId.
 */
export function dedupeTestIdPatches(patches) {
  const map = new Map();
  for (const p of patches) {
    const abs = path.resolve(p.pagePath);
    const key = `${abs}:${p.line}:${p.oldTestId}`;
    const prev = map.get(key);
    if (prev) {
      if (prev.newTestId !== p.newTestId) {
        console.warn(
          `[heal] Conflicting getByTestId replacement for ${path.basename(abs)} line ${p.line} (${p.oldTestId}): ` +
            `"${prev.newTestId}" vs "${p.newTestId}" — keeping first.`
        );
      }
      continue;
    }
    map.set(key, { ...p, pagePath: abs });
  }
  return [...map.values()];
}

/**
 * Apply many getByTestId line edits with one read/write per file.
 */
export async function applyTestIdPatchesBatch(patches) {
  const deduped = dedupeTestIdPatches(patches);
  const byFile = new Map();
  for (const p of deduped) {
    const abs = path.resolve(p.pagePath);
    if (!byFile.has(abs)) byFile.set(abs, []);
    byFile.get(abs).push(p);
  }
  for (const [abs, items] of byFile) {
    const raw = await readFile(abs, 'utf8');
    const lines = raw.split(/\r?\n/);
    for (const p of items) {
      const idx = p.line - 1;
      if (idx < 0 || idx >= lines.length) {
        return { ok: false, reason: `Line ${p.line} out of range in ${path.basename(abs)}` };
      }
      const replaced = replaceGetByTestIdOnLine(lines[idx], p.oldTestId, p.newTestId);
      if (!replaced) {
        return {
          ok: false,
          reason: `Could not replace getByTestId('${p.oldTestId}') on line ${p.line} in ${path.basename(abs)}`,
        };
      }
      lines[idx] = replaced;
    }
    await writeFile(abs, lines.join('\n'), 'utf8');
  }
  return { ok: true, applied: deduped.length };
}

/**
 * Replace whole lines (e.g. OpenAI suggestions). Last edit wins for duplicate line keys.
 */
export async function applyLinePatchesBatch(edits) {
  /** @type {Map<string, Map<number, string>>} */
  const byFile = new Map();
  for (const e of edits) {
    const abs = path.resolve(e.pagePath);
    if (!byFile.has(abs)) byFile.set(abs, new Map());
    const lineMap = byFile.get(abs);
    if (lineMap.has(e.line) && lineMap.get(e.line) !== e.newLine) {
      console.warn(`[heal] OpenAI/full-line conflict at ${path.basename(abs)}:${e.line} — last replacement wins.`);
    }
    lineMap.set(e.line, e.newLine);
  }
  for (const [abs, lineMap] of byFile) {
    const raw = await readFile(abs, 'utf8');
    const lines = raw.split(/\r?\n/);
    for (const [lineNum, newLine] of lineMap) {
      const idx = lineNum - 1;
      if (idx < 0 || idx >= lines.length) {
        return { ok: false, reason: `Line ${lineNum} out of range in ${path.basename(abs)}` };
      }
      lines[idx] = newLine;
    }
    await writeFile(abs, lines.join('\n'), 'utf8');
  }
  return { ok: true, applied: edits.length };
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
