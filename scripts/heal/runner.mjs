import { spawn } from 'node:child_process';

/**
 * Run Playwright tests; parse JSON from stdout (json reporter).
 */
export async function runPlaywright(projectRoot, { grep, all }) {
  const args = ['playwright', 'test', '--reporter=json'];

  if (!all && grep) {
    args.push('--grep', grep);
  }

  const proc = spawn('npx', args, {
    cwd: projectRoot,
    env: { ...process.env, FORCE_COLOR: '0' },
    shell: process.platform === 'win32',
  });

  let stdout = '';
  let stderr = '';
  proc.stdout?.on('data', (d) => {
    stdout += d.toString();
  });
  proc.stderr?.on('data', (d) => {
    stderr += d.toString();
  });

  const code = await new Promise((resolve) => proc.on('close', resolve));

  const jsonSlice = extractJsonObject(stdout);
  if (!jsonSlice) {
    throw new Error(
      `Could not parse Playwright JSON report from stdout. Exit ${code}.\nstderr:\n${stderr.slice(0, 3000)}`
    );
  }

  let report;
  try {
    report = JSON.parse(jsonSlice);
  } catch (e) {
    throw new Error(`Invalid JSON from Playwright: ${e.message}\n${jsonSlice.slice(0, 800)}`);
  }

  return { report, exitCode: code ?? 0, stderr };
}

function extractJsonObject(stdout) {
  const trimmed = stdout.trim();
  const start = trimmed.indexOf('{');
  if (start === -1) return null;
  return trimmed.slice(start);
}
