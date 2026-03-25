#!/usr/bin/env node
/**
 * Playwright locator heal agent — runs tests, compares failing locators to static app HTML,
 * patches page objects (getByTestId), re-runs failed tests only on follow-up attempts (--last-failed).
 *
 * Usage:
 *   node scripts/heal-agent.mjs --grep "TC01 - valid login lands on dashboard"
 *   node scripts/heal-agent.mjs --all
 *   node scripts/heal-agent.mjs --grep TC01 --dry-run
 *
 * Optional: OPENAI_API_KEY (+ OPENAI_MODEL) for non–data-testid failures or when heuristics skip.
 * Requires: npx playwright install (browsers) and app served via playwright.config webServer.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';

import { runPlaywright } from './heal/runner.mjs';
import { collectFailures } from './heal/report.mjs';
import {
  resolveHealTarget,
  suggestTestIdHeal,
  applyTestIdPatch,
  pageObjectBaseName,
  loadDomForPageObject,
  isBrowserMissingError,
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
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') out.all = true;
    else if (a === '--grep' && argv[i + 1]) out.grep = argv[++i];
    else if (a === '--max-attempts' && argv[i + 1]) out.maxAttempts = Math.max(1, parseInt(argv[++i], 10) || 3);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`
Playwright heal agent

  --grep <pattern>   Run tests matching Playwright grep on the first attempt; later attempts use --last-failed
  --all              Run entire suite on the first attempt; later attempts only re-run last run's failures
  --max-attempts N   Heal/retry cycles (default 3)
  --dry-run          Analyze and print planned patch without writing files
  --help             This message

Examples:
  node scripts/heal-agent.mjs --grep "TC01 - valid login lands on dashboard"
  node scripts/heal-agent.mjs --all

Optional env: OPENAI_API_KEY, OPENAI_MODEL (default gpt-4o-mini)
`);
}

async function replaceLineInFile(absPath, lineNumber, newLine) {
  const raw = await readFile(absPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const idx = lineNumber - 1;
  if (idx < 0 || idx >= lines.length) throw new Error('Line out of range');
  lines[idx] = newLine;
  await writeFile(absPath, lines.join('\n'), 'utf8');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const hasGrep = Boolean(args.grep);
  if (!args.all && !hasGrep) {
    printHelp();
    process.exit(2);
  }
  if (args.all && hasGrep) {
    console.error('Use only one of --all or --grep <pattern>');
    process.exit(2);
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

    const f0 = failures[0];
    if (isBrowserMissingError(f0.errorMessage)) {
      console.error(
        'Playwright browsers are not installed. Run:\n  npx playwright install\n\n' + f0.errorMessage
      );
      process.exit(1);
    }

    console.log(`Failed test: ${f0.testTitle}`);
    console.log(f0.errorMessage.split('\n').slice(0, 8).join('\n'));

    const target = await resolveHealTarget(PROJECT_ROOT, f0);
    if (!target) {
      console.error(
        'Could not map failure to a page object line. Ensure the error includes a Locator: line or a pages/*.js stack frame.'
      );
      process.exit(1);
    }

    if (!target.oldTestId) {
      const failingLine = await readFailingLine(target.pagePath, target.line);
      const { combinedHtml } = await loadDomForPageObject(
        PROJECT_ROOT,
        pageObjectBaseName(target.pagePath)
      );
      if (process.env.OPENAI_API_KEY) {
        console.log('Trying OpenAI-assisted heal (non–getByTestId or ambiguous)...');
        const suggestion = await suggestHealWithOpenAI({
          errorMessage: f0.errorMessage,
          stackSnippet: f0.stack,
          pageObjectPath: path.relative(PROJECT_ROOT, target.pagePath),
          failingLine,
          htmlSnippet: combinedHtml || '<!-- no mapped HTML -->',
        });
        if (suggestion?.replacementLine && !args.dryRun) {
          await replaceLineInFile(target.pagePath, target.line, suggestion.replacementLine.trim());
          console.log(`Patched line ${target.line} via OpenAI (confidence ${suggestion.confidence ?? 'n/a'}).`);
          continue;
        }
        if (args.dryRun && suggestion) {
          console.log('[dry-run] Would apply OpenAI line:', suggestion.replacementLine);
        }
      }
      console.error('No getByTestId to heal and OpenAI did not return a replacement. Edit manually:', target);
      process.exit(1);
    }

    const suggestion = await suggestTestIdHeal(PROJECT_ROOT, {
      oldTestId: target.oldTestId,
      pageObjectPath: target.pagePath,
    });

    if (suggestion.kind === 'noop') {
      console.warn(suggestion.reason);
      if (process.env.OPENAI_API_KEY) {
        const failingLine = await readFailingLine(target.pagePath, target.line);
        const { combinedHtml } = await loadDomForPageObject(
          PROJECT_ROOT,
          pageObjectBaseName(target.pagePath)
        );
        const ai = await suggestHealWithOpenAI({
          errorMessage: f0.errorMessage,
          stackSnippet: f0.stack,
          pageObjectPath: path.relative(PROJECT_ROOT, target.pagePath),
          failingLine,
          htmlSnippet: combinedHtml,
        });
        if (ai?.replacementLine && !args.dryRun) {
          await replaceLineInFile(target.pagePath, target.line, ai.replacementLine.trim());
          console.log('Applied OpenAI replacement after heuristic noop.');
          continue;
        }
      }
      process.exit(1);
    }

    if (suggestion.kind === 'fail') {
      console.error(suggestion.reason);
      process.exit(1);
    }

    console.log(
      `Proposed getByTestId heal: "${suggestion.oldTestId}" -> "${suggestion.newTestId}" (edit distance ${suggestion.distance})`
    );

    if (args.dryRun) {
      console.log('[dry-run] No file written. Re-run without --dry-run to apply.');
      process.exit(1);
    }

    const patch = await applyTestIdPatch(
      target.pagePath,
      target.line,
      suggestion.oldTestId,
      suggestion.newTestId
    );
    if (!patch.ok) {
      console.error('Patch failed:', patch.reason);
      process.exit(1);
    }
    console.log(`Updated ${path.relative(PROJECT_ROOT, target.pagePath)} line ${target.line}`);
  }

  console.error(`Giving up after ${args.maxAttempts} attempts (last exit ${lastExit}).`);
  process.exit(1);
}

async function readFailingLine(absPath, line) {
  const raw = await readFile(absPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  return lines[line - 1] ?? '';
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
