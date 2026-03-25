/**
 * Optional LLM-based locator fix when OPENAI_API_KEY is set.
 * Uses Responses API–compatible chat completions (gpt-4o-mini).
 */

export async function suggestHealWithOpenAI({
  errorMessage,
  stackSnippet,
  pageObjectPath,
  failingLine,
  htmlSnippet,
}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const body = {
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content: `You fix Playwright Page Object Model locators in JavaScript.
Return ONLY valid JSON with shape:
{"replacementLine": "full single line of code replacing the failing locator assignment OR constructor line", "confidence": 0.0-1.0}
The replacementLine must be valid JavaScript for Playwright's page object pattern (this.foo = page.getByTestId(...) or page.getByRole(...) etc.).
Do not include markdown or explanations outside JSON.`,
      },
      {
        role: 'user',
        content: `File: ${pageObjectPath}
Failing line:
${failingLine}

Playwright error:
${errorMessage}

Stack (truncated):
${(stackSnippet || '').slice(0, 2500)}

Relevant HTML (truncated static page — compare with locator):
${htmlSnippet.slice(0, 12000)}`,
      },
    ],
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${t.slice(0, 500)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) return null;

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (typeof parsed.replacementLine === 'string' && parsed.replacementLine.length > 0) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}
