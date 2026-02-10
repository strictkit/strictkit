const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CLI_PATH = path.join(__dirname, '..', 'index.js');

// ─── Helpers ─────────────────────────────────────────────────

let tmpDirs = [];

function createFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-test-'));
  tmpDirs.push(dir);
  return dir;
}

function writeFile(dir, relativePath, content) {
  const fullPath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function runAudit(fixturePath) {
  try {
    const output = execFileSync(process.execPath, [CLI_PATH, 'audit', fixturePath, '--json'], {
      encoding: 'utf8',
      env: { ...process.env, STRICTKIT_TELEMETRY: 'off' },
      timeout: 15000,
    });
    return JSON.parse(output);
  } catch (e) {
    // CLI exits with code 1 on failure but still outputs JSON to stdout
    if (e.stdout) return JSON.parse(e.stdout);
    throw e;
  }
}

function gate(report, name) {
  return report.results.find(r => r.gate === name);
}

afterEach(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  tmpDirs = [];
});

// ═════════════════════════════════════════════════════════════
// GATE 1: NO_ANY
// ═════════════════════════════════════════════════════════════

describe('NO_ANY gate', () => {
  it('PASS — clean TypeScript file with no any', () => {
    const dir = createFixture();
    writeFile(dir, 'app.ts', 'const x: number = 1;\nconst y: string = "hello";');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'NO_ANY').status, 'PASS');
  });

  it('FAIL — detects : any type annotation', () => {
    const dir = createFixture();
    writeFile(dir, 'app.ts', 'const x: any = 1;');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'NO_ANY').status, 'FAIL');
    assert.ok(gate(report, 'NO_ANY').message.includes('1 usages'));
  });

  it('FAIL — detects as any assertion', () => {
    const dir = createFixture();
    writeFile(dir, 'app.ts', 'const x = someValue as any;');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'NO_ANY').status, 'FAIL');
  });

  it('FAIL — detects any[] array type', () => {
    const dir = createFixture();
    writeFile(dir, 'app.ts', 'const items: any[] = [];');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'NO_ANY').status, 'FAIL');
  });

  it('FAIL — detects <any> generic', () => {
    const dir = createFixture();
    writeFile(dir, 'app.ts', 'const p = new Promise<any>(resolve => resolve(1));');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'NO_ANY').status, 'FAIL');
  });

  it('FAIL — counts multiple any usages across files', () => {
    const dir = createFixture();
    writeFile(dir, 'a.ts', 'const x: any = 1;');
    writeFile(dir, 'b.tsx', 'const y = z as any;');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'NO_ANY').status, 'FAIL');
    assert.ok(gate(report, 'NO_ANY').message.includes('2 usages'));
    assert.ok(gate(report, 'NO_ANY').message.includes('2 file(s)'));
  });

  it('PASS — ignores "any" inside a string literal (no false positive)', () => {
    const dir = createFixture();
    writeFile(dir, 'app.ts', 'const msg: string = "type: any is bad";\nconst x: string = `as any`;');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'NO_ANY').status, 'PASS');
  });

  it('PASS — ignores "any" inside a comment (no false positive)', () => {
    const dir = createFixture();
    writeFile(dir, 'app.ts', '// TODO: remove any\nconst x: number = 1;\n/* any[] */');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'NO_ANY').status, 'PASS');
  });

  it('PASS — does not match words containing "any" (e.g. company, anything)', () => {
    const dir = createFixture();
    writeFile(dir, 'app.ts', 'const company: string = "ACME";\nfunction anything(): void {}');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'NO_ANY').status, 'PASS');
  });

  it('WARN — no TypeScript files found', () => {
    const dir = createFixture();
    writeFile(dir, 'app.js', 'const x = 1;');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'NO_ANY').status, 'WARN');
  });

  // AST-specific tests (cases regex would miss)

  it('FAIL — detects any in union type (AST advantage)', () => {
    const dir = createFixture();
    writeFile(dir, 'app.ts', 'type Flexible = string | any;');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'NO_ANY').status, 'FAIL');
  });

  it('FAIL — detects any in function return type', () => {
    const dir = createFixture();
    writeFile(dir, 'app.ts', 'function parse(input: string): any { return JSON.parse(input); }');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'NO_ANY').status, 'FAIL');
  });

  it('FAIL — detects any in mapped type', () => {
    const dir = createFixture();
    writeFile(dir, 'app.ts', 'type Loose<T> = { [K in keyof T]: any };');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'NO_ANY').status, 'FAIL');
  });

  it('FAIL — detects any in .tsx file', () => {
    const dir = createFixture();
    writeFile(dir, 'App.tsx', 'const props: any = {};\nexport default function App() { return <div />; }');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'NO_ANY').status, 'FAIL');
  });
});

// ═════════════════════════════════════════════════════════════
// GATE 2: SECRETS
// ═════════════════════════════════════════════════════════════

describe('SECRETS gate', () => {
  it('PASS — clean files with no secrets', () => {
    const dir = createFixture();
    writeFile(dir, 'config.ts', 'export const API_URL = process.env.API_URL;');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'SECRETS').status, 'PASS');
  });

  it('FAIL — detects Stripe live key', () => {
    const dir = createFixture();
    const fakeStripeKey = 'sk_live' + '_' + 'a]b[c'.repeat(10).replace(/\W/g, 'x').slice(0, 24);
    writeFile(dir, 'config.ts', `const key = "${fakeStripeKey}";`);
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'SECRETS').status, 'FAIL');
  });

  it('FAIL — detects AWS access key', () => {
    const dir = createFixture();
    writeFile(dir, 'config.js', 'const awsKey = "AKIAIOSFODNN7EXAMPLE";');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'SECRETS').status, 'FAIL');
  });

  it('FAIL — detects GitHub personal access token', () => {
    const dir = createFixture();
    writeFile(dir, 'config.ts', 'const ghToken = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'SECRETS').status, 'FAIL');
  });

  it('FAIL — detects OpenAI API key', () => {
    const dir = createFixture();
    writeFile(dir, 'ai.ts', 'const key = "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuv";');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'SECRETS').status, 'FAIL');
  });

  it('FAIL — detects private key PEM header', () => {
    const dir = createFixture();
    writeFile(dir, 'cert.json', '{"key": "-----BEGIN RSA PRIVATE KEY-----"}');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'SECRETS').status, 'FAIL');
  });

  it('PASS — ignores secrets inside test files', () => {
    const dir = createFixture();
    const fakeStripeKey2 = 'sk_live' + '_' + 'a]b[c'.repeat(10).replace(/\W/g, 'x').slice(0, 24);
    writeFile(dir, 'auth.test.ts', `const key = "${fakeStripeKey2}";`);
    writeFile(dir, 'auth.spec.js', 'const key = "AKIAIOSFODNN7EXAMPLE";');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'SECRETS').status, 'PASS');
  });

  it('PASS — ignores secrets inside __tests__ directory', () => {
    const dir = createFixture();
    const fakeStripeKey3 = 'sk_live' + '_' + 'a]b[c'.repeat(10).replace(/\W/g, 'x').slice(0, 24);
    writeFile(dir, '__tests__/helpers.ts', `const key = "${fakeStripeKey3}";`);
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'SECRETS').status, 'PASS');
  });
});

// ═════════════════════════════════════════════════════════════
// GATE 3: DOCKER
// ═════════════════════════════════════════════════════════════

describe('DOCKER gate', () => {
  it('PASS — all images pinned with specific tags', () => {
    const dir = createFixture();
    writeFile(dir, 'Dockerfile', 'FROM node:20-alpine AS builder\nRUN npm ci\nFROM node:20-alpine\nCOPY --from=builder /app .');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'DOCKER').status, 'PASS');
  });

  it('FAIL — unpinned image (no tag)', () => {
    const dir = createFixture();
    writeFile(dir, 'Dockerfile', 'FROM node\nRUN npm ci');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'DOCKER').status, 'FAIL');
    assert.ok(gate(report, 'DOCKER').message.includes('node'));
  });

  it('FAIL — image tagged as :latest', () => {
    const dir = createFixture();
    writeFile(dir, 'Dockerfile', 'FROM node:latest\nRUN npm ci');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'DOCKER').status, 'FAIL');
  });

  it('PASS — image pinned to SHA digest', () => {
    const dir = createFixture();
    writeFile(dir, 'Dockerfile', 'FROM node:20-alpine@sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890\nRUN npm ci');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'DOCKER').status, 'PASS');
  });

  it('WARN — no Dockerfile found', () => {
    const dir = createFixture();
    writeFile(dir, 'app.js', 'const x = 1;');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'DOCKER').status, 'WARN');
  });

  it('PASS — multi-stage build with all images pinned', () => {
    const dir = createFixture();
    const dockerfile = [
      'FROM node:20-alpine AS deps',
      'RUN npm ci',
      'FROM node:20-alpine AS builder',
      'COPY --from=deps /app/node_modules .',
      'RUN npm run build',
      'FROM gcr.io/distroless/nodejs20-debian12:nonroot',
      'COPY --from=builder /app .',
    ].join('\n');
    writeFile(dir, 'Dockerfile', dockerfile);
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'DOCKER').status, 'PASS');
  });
});

// ═════════════════════════════════════════════════════════════
// GATE 4: CONSOLE
// ═════════════════════════════════════════════════════════════

describe('CONSOLE gate', () => {
  it('PASS — no console.log in code', () => {
    const dir = createFixture();
    writeFile(dir, 'app.ts', 'const x: number = 1;\nconsole.error("fatal");');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'CONSOLE').status, 'PASS');
  });

  it('FAIL — detects console.log()', () => {
    const dir = createFixture();
    writeFile(dir, 'app.ts', 'console.log("debug");');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'CONSOLE').status, 'FAIL');
    assert.ok(gate(report, 'CONSOLE').message.includes('1 console.log()'));
  });

  it('FAIL — counts multiple console.log across files', () => {
    const dir = createFixture();
    writeFile(dir, 'a.js', 'console.log("one");');
    writeFile(dir, 'b.tsx', 'console.log("two");\nconsole.log("three");');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'CONSOLE').status, 'FAIL');
    assert.ok(gate(report, 'CONSOLE').message.includes('3 console.log()'));
    assert.ok(gate(report, 'CONSOLE').message.includes('2 file(s)'));
  });

  it('PASS — ignores console.log inside a comment (no false positive)', () => {
    const dir = createFixture();
    writeFile(dir, 'app.ts', '// console.log("debug")\n/* console.log("x") */\nconst x: number = 1;');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'CONSOLE').status, 'PASS');
  });

  it('PASS — ignores console.log inside a string (no false positive)', () => {
    const dir = createFixture();
    writeFile(dir, 'app.ts', 'const msg: string = "do not use console.log()";');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'CONSOLE').status, 'PASS');
  });

  it('PASS — ignores console.log in test files', () => {
    const dir = createFixture();
    writeFile(dir, 'app.test.ts', 'console.log("test output");');
    writeFile(dir, 'app.spec.js', 'console.log("spec output");');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'CONSOLE').status, 'PASS');
  });
});

// ═════════════════════════════════════════════════════════════
// GATE 5: LOCKFILE
// ═════════════════════════════════════════════════════════════

describe('LOCKFILE gate', () => {
  it('PASS — package-lock.json exists', () => {
    const dir = createFixture();
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(gate(report, 'LOCKFILE').status, 'PASS');
  });

  it('PASS — yarn.lock exists', () => {
    const dir = createFixture();
    writeFile(dir, 'yarn.lock', '');

    const report = runAudit(dir);
    assert.equal(gate(report, 'LOCKFILE').status, 'PASS');
  });

  it('PASS — pnpm-lock.yaml exists', () => {
    const dir = createFixture();
    writeFile(dir, 'pnpm-lock.yaml', '');

    const report = runAudit(dir);
    assert.equal(gate(report, 'LOCKFILE').status, 'PASS');
  });

  it('PASS — bun.lockb exists', () => {
    const dir = createFixture();
    writeFile(dir, 'bun.lockb', '');

    const report = runAudit(dir);
    assert.equal(gate(report, 'LOCKFILE').status, 'PASS');
  });

  it('FAIL — no lockfile found', () => {
    const dir = createFixture();
    writeFile(dir, 'app.js', 'const x = 1;');

    const report = runAudit(dir);
    assert.equal(gate(report, 'LOCKFILE').status, 'FAIL');
  });
});

// ═════════════════════════════════════════════════════════════
// JSON OUTPUT FORMAT
// ═════════════════════════════════════════════════════════════

describe('JSON output format', () => {
  it('includes meta, summary, results, and success fields', () => {
    const dir = createFixture();
    writeFile(dir, 'app.ts', 'const x: number = 1;');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);

    assert.ok(report.meta);
    assert.ok(report.meta.tool === 'StrictKit');
    assert.ok(report.meta.timestamp);
    assert.ok(report.meta.path);
    assert.ok(report.summary);
    assert.equal(report.summary.total, 5);
    assert.ok(Array.isArray(report.results));
    assert.equal(report.results.length, 5);
    assert.equal(typeof report.success, 'boolean');
  });

  it('success=true when all gates pass', () => {
    const dir = createFixture();
    writeFile(dir, 'app.ts', 'const x: number = 1;');
    writeFile(dir, 'Dockerfile', 'FROM node:20-alpine\nRUN npm ci');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(report.success, true);
    assert.equal(report.summary.failed, 0);
  });

  it('success=false when any gate fails', () => {
    const dir = createFixture();
    writeFile(dir, 'app.ts', 'const x: any = 1;');
    writeFile(dir, 'package-lock.json', '{}');

    const report = runAudit(dir);
    assert.equal(report.success, false);
    assert.ok(report.summary.failed > 0);
  });
});
