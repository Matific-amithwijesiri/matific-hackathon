/**
 * Collect failed test results from Playwright JSON reporter output.
 */
export function collectFailures(report) {
  const failures = [];
  const visit = (suiteList) => {
    for (const suite of suiteList || []) {
      for (const spec of suite.specs || []) {
        for (const test of spec.tests || []) {
          for (const result of test.results || []) {
            if (result.status === 'failed') {
              failures.push({
                testTitle: spec.title,
                testFile: spec.file,
                errorMessage: result.error?.message || result.errors?.[0]?.message || '',
                stack: result.error?.stack || '',
              });
            }
          }
        }
      }
      visit(suite.suites);
    }
  };
  visit(report.suites);
  return failures;
}
