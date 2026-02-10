const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { stripComments, stripStrings } = require('../utils/sanitize');

// ─── stripComments ───────────────────────────────────────────

describe('stripComments', () => {
  it('removes single-line block comments', () => {
    const input = 'const x = 1; /* comment */ const y = 2;';
    const result = stripComments(input);
    assert.ok(!result.includes('comment'));
    assert.ok(result.includes('const x = 1;'));
    assert.ok(result.includes('const y = 2;'));
  });

  it('removes multi-line block comments', () => {
    const input = 'const x = 1;\n/* line1\n  line2\n  line3 */\nconst y = 2;';
    const result = stripComments(input);
    assert.ok(!result.includes('line1'));
    assert.ok(!result.includes('line2'));
    assert.ok(result.includes('const x = 1;'));
    assert.ok(result.includes('const y = 2;'));
  });

  it('removes line comments', () => {
    const input = 'const x: any = 1; // type is any\nconst y = 2;';
    const result = stripComments(input);
    assert.ok(!result.includes('type is any'));
    assert.ok(result.includes('const x: any = 1;'));
    assert.ok(result.includes('const y = 2;'));
  });

  it('preserves URLs with double slashes (lookbehind for colon)', () => {
    const input = 'const url = "https://example.com/path";';
    const result = stripComments(input);
    assert.ok(result.includes('https://example.com/path'));
  });

  it('removes multiple line comments on separate lines', () => {
    const input = '// first comment\nconst a = 1;\n// second comment\nconst b = 2;';
    const result = stripComments(input);
    assert.ok(!result.includes('first comment'));
    assert.ok(!result.includes('second comment'));
    assert.ok(result.includes('const a = 1;'));
    assert.ok(result.includes('const b = 2;'));
  });

  it('handles empty input', () => {
    assert.equal(stripComments(''), '');
  });

  it('handles code with no comments', () => {
    const input = 'const x = 1;\nconst y = 2;';
    assert.equal(stripComments(input), input);
  });
});

// ─── stripStrings ────────────────────────────────────────────

describe('stripStrings', () => {
  it('replaces double-quoted strings with empty quotes', () => {
    const input = 'const x = "any value here";';
    const result = stripStrings(input);
    assert.ok(!result.includes('any value here'));
    assert.ok(result.includes('""'));
  });

  it('replaces single-quoted strings with empty quotes', () => {
    const input = "const x = 'any value here';";
    const result = stripStrings(input);
    assert.ok(!result.includes('any value here'));
    assert.ok(result.includes("''"));
  });

  it('replaces template literals with empty quotes', () => {
    const input = 'const x = `any value ${here}`;';
    const result = stripStrings(input);
    assert.ok(!result.includes('any value'));
  });

  it('handles escaped double quotes inside strings', () => {
    const input = 'const x = "contains \\"any\\" inside";';
    const result = stripStrings(input);
    assert.ok(!result.includes('any'));
  });

  it('handles escaped single quotes inside strings', () => {
    const input = "const x = 'it\\'s any';";
    const result = stripStrings(input);
    assert.ok(!result.includes('any'));
  });

  it('handles multiple strings on the same line', () => {
    const input = 'const a = "any"; const b = "other";';
    const result = stripStrings(input);
    assert.ok(!result.includes('any'));
    assert.ok(!result.includes('other'));
  });

  it('handles empty input', () => {
    assert.equal(stripStrings(''), '');
  });

  it('preserves code without strings', () => {
    const input = 'const x: any = 1;';
    assert.equal(stripStrings(input), input);
  });
});

// ─── Combined usage ──────────────────────────────────────────

describe('stripComments + stripStrings combined', () => {
  it('removes any inside both comments and strings', () => {
    const input = [
      'const x: number = 1; // type: any',
      'const y = "as any";',
      '/* any[] */',
      'const z: any = 3;',
    ].join('\n');

    let clean = stripComments(input);
    clean = stripStrings(clean);

    // The real `any` on the last line should survive
    assert.ok(clean.includes(': any'));
    // But comment/string `any` should be gone
    const lines = clean.split('\n');
    assert.ok(!lines[0].includes('type: any'));
    assert.ok(!lines[1].includes('as any'));
  });
});
