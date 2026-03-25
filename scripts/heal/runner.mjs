import { spawn } from 'node:child_process';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const HEAL_JSON_REL = path.join('test-results', 'heal-report.json');

/**
 * Run Playwright tests; JSON report is read from a file (PLAYWRIGHT_JSON_OUTPUT_FILE) so we can use
 * the line reporter on the console and show each test as it runs.
 * Includes the `html` reporter so `npm run heal` still produces playwright-report/ (CLI --reporter replaces config).
 * When lastFailed is true, only tests that failed in the immediately previous run execute
 * (see Playwright --last-failed). Use that after an initial full/grep run so heal retries stay narrow.
 */
export async function runPlaywright(projectRoot, { grep, all, lastFailed = false }) {
  const jsonReportPath = path.join(projectRoot, HEAL_JSON_REL);
  const args = ['playwright', 'test', '--reporter=line,json,html'];

  if (lastFailed) {
    args.push('--last-failed');
  } else if (!all && grep) {
    args.push('--grep', grep);
  }

  const proc = spawn('npx', args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      // JSON to file so line reporter can use stdout (see playwright/lib/reporters/json.js + base resolveOutputFile)
      PLAYWRIGHT_JSON_OUTPUT_FILE: jsonReportPath,
      // Match playwright.config.js html reporter { open: 'never' }
      PLAYWRIGHT_HTML_OPEN: process.env.PLAYWRIGHT_HTML_OPEN ?? 'never',
    },
    shell: process.platform === 'win32',
  });

  let stderr = '';
  proc.stdout?.on('data', (d) => {
    process.stdout.write(d);
  });
  proc.stderr?.on('data', (d) => {
    const chunk = d.toString();
    stderr += chunk;
    process.stderr.write(d);
  });

  const code = await new Promise((resolve) => proc.on('close', resolve));

  let rawJson;
  try {
    rawJson = await readFile(jsonReportPath, 'utf8');
  } catch (e) {
    throw new Error(
      `Could not read Playwright JSON report at ${HEAL_JSON_REL}. Exit ${code}.\n${e.message}\nstderr:\n${stderr.slice(0, 3000)}`
    );
  }

  let report;
  try {
    report = JSON.parse(rawJson);
  } catch (e) {
    throw new Error(`Invalid JSON from Playwright report file: ${e.message}\n${rawJson.slice(0, 800)}`);
  }

  return { report, exitCode: code ?? 0, stderr };
}
