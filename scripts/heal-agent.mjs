#!/usr/bin/env node
/**
 * Playwright locator heal agent — runs tests, compares failing locators to static app HTML,
 * patches page objects (getByTestId), re-runs failed tests only on follow-up attempts (--last-failed).
 *
 * On each failed run, every `getByTestId` in the implicated page object files is checked against
 * mapped static HTML; all drifted ids are fixed in one batch (not only the failing assertion).
 *
 * Usage:
 *   node scripts/heal-agent.mjs --grep "TC01 - valid login lands on dashboard"
 *   node scripts/heal-agent.mjs --all
 *   node scripts/heal-agent.mjs --grep TC01 --dry-run
 *   node scripts/heal-agent.mjs --scan-all-pages
 *
 * Optional: OPENAI_API_KEY (+ OPENAI_MODEL) for non–data-testid failures or when heuristics skip.
 * Requires: npx playwright install (browsers) and app served via playwright.config webServer (test modes only).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import { runPlaywright } from './heal/runner.mjs';
import { collectFailures } from './heal/report.mjs';
import {
  resolveHealTarget,
  suggestTestIdHeal,
  pageObjectBaseName,
  loadDomForPageObject,
  isBrowserMissingError,
  dedupeTestIdPatches,
  applyTestIdPatchesBatch,
  applyLinePatchesBatch,
  resolvePageFilesToScan,
  scanPageObjectFileForDrift,
  listAllPageObjectPaths,
} from './heal/heal.mjs';
import { suggestHealWithOpenAI } from './heal/ai.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = {
    all: false,
    grep: null,
    maxAttempts: 3,
    dryRun: false,
    scanAllPages: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') out.all = true;
    else if (a === '--grep' && argv[i + 1]) out.grep = argv[++i];
    else if (a === '--max-attempts' && argv[i + 1]) out.maxAttempts = Math.max(1, parseInt(argv[++i], 10) || 3);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--scan-all-pages') out.scanAllPages = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`
Playwright heal agent

  --grep <pattern>   Run tests matching Playwright grep on the first attempt; later attempts use --last-failed
  --all              Run entire suite on the first attempt; later attempts only re-run last run's failures
  --scan-all-pages   No tests: scan every pages/*.js against static HTML and fix all drifted getByTestId values
  --max-attempts N   Heal/retry cycles (default 3; ignored for --scan-all-pages)
  --dry-run          Analyze and print planned patch without writing files
  --help             This message

Use exactly one of: --grep, --all, or --scan-all-pages.

Examples:
  node scripts/heal-agent.mjs --grep "TC01 - valid login lands on dashboard"
  node scripts/heal-agent.mjs --all
  node scripts/heal-agent.mjs --scan-all-pages

Optional env: OPENAI_API_KEY, OPENAI_MODEL (default gpt-4o-mini)
`);
}

function lineKey(pagePath, line) {
  return `${path.resolve(pagePath)}:${line}`;
}

function dedupeOpenAiTasks(tasks) {
  const map = new Map();
  for (const t of tasks) {
    const k = lineKey(t.target.pagePath, t.target.line);
    if (!map.has(k)) map.set(k, t);
  }
  return [...map.values()];
}

/**
 * Full DOM drift scan on selected page files, then supplemental fixes from failures not covered by patched lines.
 */
async function buildHealPlan(projectRoot, failures) {
  for (const f of failures) {
    if (isBrowserMissingError(f.errorMessage)) {
      return { browserError: f.errorMessage };
    }
  }

  const pageFiles = await resolvePageFilesToScan(projectRoot, failures);
  console.log(
    `\nDOM scan: checking every getByTestId in ${pageFiles.length} page object file(s) against static HTML.`
  );

  const testIdPatches = [];
  const skipMsgs = [];
  for (const abs of pageFiles) {
    const { patches, skipReason } = await scanPageObjectFileForDrift(projectRoot, abs);
    if (skipReason) skipMsgs.push(skipReason);
    testIdPatches.push(...patches);
  }
  for (const msg of [...new Set(skipMsgs)]) {
    console.warn('[heal]', msg);
  }

  const linesTouchedByScan = new Set(testIdPatches.map((p) => lineKey(p.pagePath, p.line)));

  const openAiTasks = [];
  const unmapped = [];
  const heuristicFailed = [];

  for (const f of failures) {
    const target = await resolveHealTarget(projectRoot, f);
    if (!target) {
      unmapped.push(f);
      continue;
    }

    if (linesTouchedByScan.has(lineKey(target.pagePath, target.line))) {
      continue;
    }

    if (!target.oldTestId) {
      openAiTasks.push({ type: 'no-testid', target, failure: f });
      continue;
    }

    const suggestion = await suggestTestIdHeal(projectRoot, {
      oldTestId: target.oldTestId,
      pageObjectPath: target.pagePath,
    });

    if (suggestion.kind === 'replace') {
      testIdPatches.push({
        pagePath: target.pagePath,
        line: target.line,
        oldTestId: suggestion.oldTestId,
        newTestId: suggestion.newTestId,
        distance: suggestion.distance,
        testTitle: f.testTitle,
      });
      continue;
    }
    if (suggestion.kind === 'noop') {
      openAiTasks.push({ type: 'noop', target, failure: f, reason: suggestion.reason });
      continue;
    }
    heuristicFailed.push({ target, failure: f, reason: suggestion.reason });
  }

  return { testIdPatches, openAiTasks, unmapped, heuristicFailed };
}

async function readFailingLine(absPath, line) {
  const raw = await readFile(absPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  return lines[line - 1] ?? '';
}

async function collectOpenAiLineEdits(projectRoot, openAiTasks, patchedLineKeys) {
  const tasks = dedupeOpenAiTasks(openAiTasks).filter(
    (t) => !patchedLineKeys.has(lineKey(t.target.pagePath, t.target.line))
  );
  if (!tasks.length) return [];

  if (!process.env.OPENAI_API_KEY) {
    return [];
  }

  const edits = [];
  for (const task of tasks) {
    const failingLine = await readFailingLine(task.target.pagePath, task.target.line);
    const { combinedHtml } = await loadDomForPageObject(
      projectRoot,
      pageObjectBaseName(task.target.pagePath)
    );
    const suggestion = await suggestHealWithOpenAI({
      errorMessage: task.failure.errorMessage,
      stackSnippet: task.failure.stack,
      pageObjectPath: path.relative(projectRoot, task.target.pagePath),
      failingLine,
      htmlSnippet: combinedHtml || '<!-- no mapped HTML -->',
    });
    if (suggestion?.replacementLine) {
      edits.push({
        pagePath: task.target.pagePath,
        line: task.target.line,
        newLine: suggestion.replacementLine.trim(),
      });
    }
  }
  return edits;
}

async function runScanAllPages(projectRoot, args) {
  const files = await listAllPageObjectPaths(projectRoot);
  console.log(`\n--scan-all-pages: scanning ${files.length} file(s) under pages/.`);

  const testIdPatches = [];
  const skipMsgs = [];
  for (const abs of files) {
    const { patches, skipReason } = await scanPageObjectFileForDrift(projectRoot, abs);
    if (skipReason) skipMsgs.push(skipReason);
    testIdPatches.push(...patches);
  }
  for (const msg of [...new Set(skipMsgs)]) {
    console.warn('[heal]', msg);
  }

  const deduped = dedupeTestIdPatches(testIdPatches);

  if (!deduped.length) {
    console.log('No drifted getByTestId locators found (or nothing mapped in constants.mjs).');
    process.exit(0);
  }

  console.log('\nPlanned getByTestId fixes (DOM scan):');
  for (const p of deduped) {
    console.log(
      `  • ${path.relative(projectRoot, p.pagePath)}:${p.line}  "${p.oldTestId}" → "${p.newTestId}" (Δ${p.distance})`
    );
  }

  if (args.dryRun) {
    console.log('\n[dry-run] No files written.');
    process.exit(0);
  }

  const batch = await applyTestIdPatchesBatch(deduped);
  if (!batch.ok) {
    console.error('Batch patch failed:', batch.reason);
    process.exit(1);
  }
  console.log(`\nApplied ${batch.applied} getByTestId edit(s).`);
  process.exit(0);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const hasGrep = Boolean(args.grep);
  const modeCount = Number(args.all) + Number(hasGrep) + Number(args.scanAllPages);
  if (modeCount === 0) {
    printHelp();
    process.exit(2);
  }
  if (modeCount > 1) {
    console.error('Use only one of --all, --grep <pattern>, or --scan-all-pages');
    process.exit(2);
  }

  if (args.scanAllPages) {
    await runScanAllPages(PROJECT_ROOT, args);
    return;
  }

  let attempt = 0;
  let lastExit = 1;

  while (attempt < args.maxAttempts) {
    attempt += 1;
    console.log(`\n--- Heal attempt ${attempt}/${args.maxAttempts} ---`);
    const { report, exitCode } = await runPlaywright(PROJECT_ROOT, {
      grep: args.grep,
      all: args.all,
      lastFailed: attempt > 1,
    });
    lastExit = exitCode;

    if (exitCode === 0) {
      console.log('All matching tests passed.');
      process.exit(0);
    }

    const failures = collectFailures(report);
    if (!failures.length) {
      console.error('Tests failed but no failure entries in JSON report.');
      process.exit(1);
    }

    console.log(`\n${failures.length} failed test result(s) in this run.`);

    const plan = await buildHealPlan(PROJECT_ROOT, failures);
    if (plan.browserError) {
      console.error(
        'Playwright browsers are not installed. Run:\n  npx playwright install\n\n' + plan.browserError
      );
      process.exit(1);
    }

    const dedupedTestId = dedupeTestIdPatches(plan.testIdPatches);
    console.log(
      `\nDOM drift: ${dedupedTestId.filter((p) => p.testTitle === '(DOM scan)').length} locator(s) from full-file scan, ` +
        `${dedupedTestId.length} total after merge/dedupe.`
    );
    const patchedLineKeys = new Set(dedupedTestId.map((p) => lineKey(p.pagePath, p.line)));

    let openAiEdits = [];
    const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY);
    if (plan.openAiTasks.length && hasOpenAiKey) {
      console.log(
        `\nOpenAI: resolving ${plan.openAiTasks.length} task(s) ` +
          `(${dedupeOpenAiTasks(plan.openAiTasks).length} unique line(s), skipping lines already patched)...`
      );
      openAiEdits = await collectOpenAiLineEdits(PROJECT_ROOT, plan.openAiTasks, patchedLineKeys);
    }

    if (dedupedTestId.length) {
      console.log('\nPlanned getByTestId batch fixes:');
      for (const p of dedupedTestId) {
        const tag = p.testTitle === '(DOM scan)' ? '[scan]' : `[${p.testTitle}]`;
        console.log(
          `  • ${path.relative(PROJECT_ROOT, p.pagePath)}:${p.line}  "${p.oldTestId}" → "${p.newTestId}" ` +
            `(Δ${p.distance})  ${tag}`
        );
      }
    }
    if (openAiEdits.length) {
      console.log('\nPlanned full-line (OpenAI) fixes:');
      for (const e of openAiEdits) {
        console.log(`  • ${path.relative(PROJECT_ROOT, e.pagePath)}:${e.line}`);
      }
    }
    if (plan.unmapped.length) {
      console.log(`\nCould not map ${plan.unmapped.length} failure(s) to a page object line (no Locator/pages stack).`);
    }
    if (plan.heuristicFailed.length) {
      console.log(`\nHeuristic could not propose a test id for ${plan.heuristicFailed.length} failure(s):`);
      for (const h of plan.heuristicFailed.slice(0, 5)) {
        console.log(`  • ${h.failure.testTitle}: ${h.reason}`);
      }
    }
    if (plan.openAiTasks.length && !hasOpenAiKey) {
      console.log(
        `\n${plan.openAiTasks.length} failure(s) need OpenAI or manual fix (set OPENAI_API_KEY for assisted line replacement).`
      );
    }

    const noApplicablePatches = dedupedTestId.length === 0 && openAiEdits.length === 0;
    if (noApplicablePatches) {
      console.error('\nNo automatic patches to apply this attempt.');
      process.exit(1);
    }

    if (args.dryRun) {
      console.log('\n[dry-run] No files written. Re-run without --dry-run to apply.');
      process.exit(1);
    }

    if (dedupedTestId.length) {
      const batch = await applyTestIdPatchesBatch(dedupedTestId);
      if (!batch.ok) {
        console.error('Batch getByTestId patch failed:', batch.reason);
        process.exit(1);
      }
      console.log(`\nApplied ${batch.applied} getByTestId line edit(s).`);
    }

    if (openAiEdits.length) {
      const lineBatch = await applyLinePatchesBatch(openAiEdits);
      if (!lineBatch.ok) {
        console.error('Batch line patch failed:', lineBatch.reason);
        process.exit(1);
      }
      console.log(`Applied ${openAiEdits.length} full-line edit(s).`);
    }
  }

  console.error(`Giving up after ${args.maxAttempts} attempts (last exit ${lastExit}).`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
