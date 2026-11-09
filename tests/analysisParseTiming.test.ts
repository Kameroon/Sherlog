// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseAnalysis } from '../src/ai/analysis';
import { MAX_ANSWER_CHARS } from '../src/ai/provider';

const hostileAnswers: [string, string][] = [
  ['an open fence and backticks', `\`\`\`json\n${'`'.repeat(MAX_ANSWER_CHARS)}`],
  ['an open fence and line breaks', `\`\`\`\n${'\n'.repeat(MAX_ANSWER_CHARS)}`],
  ['an open fence and carriage returns', `\`\`\`\r\n${'\r\n'.repeat(MAX_ANSWER_CHARS / 2)}`],
  ['many fences', '```\n'.repeat(MAX_ANSWER_CHARS / 4)],
  ['fences that never close', `\`\`\`json\n${'x```\n'.repeat(MAX_ANSWER_CHARS / 5)}`],
  ['spaces after the fence', `\`\`\`${' '.repeat(MAX_ANSWER_CHARS)}`],
  ['deeply nested JSON', `${'['.repeat(MAX_ANSWER_CHARS / 2)}${']'.repeat(MAX_ANSWER_CHARS / 2)}`],
];

// The answer of a model that read a hostile log may be anything, up to the limit: reading it must stay fast.
describe('parseAnalysis on hostile answers of the largest size', () => {
  it.each(hostileAnswers)('should refuse %s in well under a second', (_name, answer) => {
    // Arrange
    const start = performance.now();

    // Act
    const result = parseAnalysis(answer);

    // Assert
    expect(result.ok).toBe(false);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
