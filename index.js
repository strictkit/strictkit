#!/usr/bin/env node
const chalk = require('chalk');
const { globSync } = require('glob');
const fs = require('fs');
const path = require('path');
const { trackAudit } = require('./utils/telemetry');

// CONFIG - Parse arguments correctly
const args = process.argv.slice(2);
const COMMANDS = ['audit', 'explain', 'help', '--help', '-h', '--version', '-v'];
const command = args.find(a => COMMANDS.includes(a)) || 'audit';
const PROJECT_PATH = args.find(a => !COMMANDS.includes(a) && !a.startsWith('-')) || '.';
const CURRENT_FILE = path.basename(__filename);
const IGNORE_PATTERNS = ['node_modules/**', 'dist/**', '.next/**', 'coverage/**', '.git/**', '*.min.js', 'utils/**', CURRENT_FILE];

// 🚩 DETECT JSON FLAG
const isJson = args.includes('--json');

// --- HELP & VERSION (Keep these human-only usually) ---
if (['help', '--help', '-h'].includes(command)) {
  console.log(`
${chalk.bold('StrictKit')} - The Code Integrity Protocol

${chalk.yellow('Usage:')}
  npx strictkit [command] [path] [--json]

${chalk.yellow('Commands:')}
  audit [path]    Audit a project (default: current directory)
  help            Show this help message

${chalk.yellow('Options:')}
  --json          Output results in JSON format (for CI/CD)

${chalk.yellow('More info:')} https://www.strictkit.dev
`);
  process.exit(0);
}

if (['--version', '-v'].includes(command)) {
  try {
    const pkg = require('./package.json');
    console.log(pkg.version);
  } catch { console.log('unknown'); }
  process.exit(0);
}

// 🤫 SILENCE LOGS IF JSON
function logHuman(msg) {
  if (!isJson) console.log(msg);
}

logHuman(chalk.bold.white('\n🔒 STRICTKIT: The Code Integrity Protocol'));
logHuman(chalk.gray(`   Auditing: ${path.resolve(PROJECT_PATH)}\n`));

// 📦 DATA STRUCTURE FOR JSON
const jsonReport = {
  meta: {
    tool: 'StrictKit',
    timestamp: new Date().toISOString(),
    path: path.resolve(PROJECT_PATH)
  },
  summary: {
    total: 0,
    passed: 0,
    failed: 0,
    warnings: 0
  },
  results: []
};

// --- AUDIT FUNCTION (Dual Mode) ---
function audit(gate, status, msg) {
  // 1. Add to JSON Report
  jsonReport.results.push({
    gate,
    status, // FAIL, PASS, WARN
    message: msg
  });
  
  // Update summary
  jsonReport.summary.total++;
  if (status === 'FAIL') jsonReport.summary.failed++;
  else if (status === 'PASS') jsonReport.summary.passed++;
  else jsonReport.summary.warnings++;

  // 2. Print Human Output (if not json)
  if (!isJson) {
    const icon = status === 'FAIL' ? '❌' : (status === 'WARN' ? '⚠️ ' : '✅');
    const color = status === 'FAIL' ? chalk.red : (status === 'WARN' ? chalk.yellow : chalk.green);
    console.log(`${icon} ${chalk.bold(gate.padEnd(15))} ${color(msg)}`);
  }
}

// --- UTILS ---
const { stripComments, stripStrings } = require('./utils/sanitize');

// --- GATE 1: THE NO-ANY POLICY (AST-powered) ---
try {
  const { countAnyTypes } = require('./utils/ast-analyzer');
  const tsFiles = globSync('**/*.{ts,tsx}', { cwd: PROJECT_PATH, ignore: IGNORE_PATTERNS });
  let anyCount = 0;
  let anyFiles = [];

  tsFiles.forEach(f => {
    const content = fs.readFileSync(path.join(PROJECT_PATH, f), 'utf8');
    const fileCount = countAnyTypes(f, content);

    if (fileCount > 0) {
      anyCount += fileCount;
      anyFiles.push(f);
    }
  });

  if (anyCount > 0) {
    audit('NO_ANY', 'FAIL', `Found ${anyCount} usages of 'any' in ${anyFiles.length} file(s).`);
  } else if (tsFiles.length === 0) {
    audit('NO_ANY', 'WARN', 'No TypeScript files found.');
  } else {
    audit('NO_ANY', 'PASS', `Strict typing enforced across ${tsFiles.length} files.`);
  }
} catch (e) { audit('NO_ANY', 'WARN', 'Could not complete TypeScript scan.'); }

// --- GATE 2: SECRET SENTINEL ---
const SECRET_PATTERNS = [
  /sk_live_[a-zA-Z0-9]{24,}/, /sk_test_[a-zA-Z0-9]{24,}/, /AKIA[0-9A-Z]{16}/,
  /ghp_[a-zA-Z0-9]{36}/, /gho_[a-zA-Z0-9]{36}/, /xox[baprs]-[0-9a-zA-Z-]{10,}/,
  /sk-[a-zA-Z0-9]{48}/, /AIza[a-zA-Z0-9\-_]{35}/, /-----BEGIN .*PRIVATE KEY-----/,
  /eyJ[a-zA-Z0-9_-]{20,}\.eyJ[a-zA-Z0-9_-]{20,}\./
];

let secretsFound = [];
try {
  const codeFiles = globSync('**/*.{ts,tsx,js,jsx,json}', { 
    cwd: PROJECT_PATH, 
    ignore: [...IGNORE_PATTERNS, '**/*.test.*', '**/*.spec.*', '**/test/**', '**/__tests__/**']
  });
  codeFiles.forEach(f => {
    const content = fs.readFileSync(path.join(PROJECT_PATH, f), 'utf8');
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(content)) { secretsFound.push(f); break; }
    }
  });
  if (secretsFound.length > 0) audit('SECRETS', 'FAIL', `Secrets detected in ${secretsFound.length} file(s).`);
  else audit('SECRETS', 'PASS', 'No hardcoded secrets detected.');
} catch (e) { audit('SECRETS', 'WARN', 'Scan failed.'); }

// --- GATE 3: DOCKER GATEKEEPER ---
try {
  const dockerfilePath = path.join(PROJECT_PATH, 'Dockerfile');
  if (fs.existsSync(dockerfilePath)) {
    const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
    const fromLines = dockerfile.match(/^FROM\s+([^\s]+)/gm) || [];
    let weakTags = [];
    fromLines.forEach(line => {
      const image = line.replace(/^FROM\s+/, '').split(/\s+/)[0];
      if (!image.includes(':') || image.endsWith(':latest')) weakTags.push(image);
    });
    if (weakTags.length > 0) audit('DOCKER', 'FAIL', `Unpinned image: ${weakTags[0]}.`);
    else audit('DOCKER', 'PASS', 'Docker images pinned.');
  } else { audit('DOCKER', 'WARN', 'No Dockerfile found.'); }
} catch (e) { audit('DOCKER', 'WARN', 'Scan failed.'); }

// --- GATE 4: CONSOLE SILENCE ---
try {
  const jsFiles = globSync('**/*.{ts,tsx,js,jsx}', { 
    cwd: PROJECT_PATH, 
    ignore: [...IGNORE_PATTERNS, '**/*.test.*', '**/*.spec.*', '**/test/**', '**/__tests__/**']
  });
  
  let logCount = 0;
  let logFiles = []; 

  jsFiles.forEach(f => {
    const content = fs.readFileSync(path.join(PROJECT_PATH, f), 'utf8');
    let clean = stripStrings(stripComments(content));
    const matches = clean.match(/\bconsole\.log\s*\(/g);
    
    if (matches) {
      logCount += matches.length;
      logFiles.push(f);
    }
  });

  if (logCount > 0) {
    audit('CONSOLE', 'FAIL', `Found ${logCount} console.log() in ${logFiles.length} file(s).`);
  } else {
    audit('CONSOLE', 'PASS', 'No console pollution detected.');
  }
} catch (e) { audit('CONSOLE', 'WARN', 'Scan failed.'); }

// --- GATE 5: DEPENDENCY FREEZE ---
try {
  const lockfiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'];
  const hasLock = lockfiles.some(f => fs.existsSync(path.join(PROJECT_PATH, f)));
  if (hasLock) audit('LOCKFILE', 'PASS', 'Dependency tree frozen.');
  else audit('LOCKFILE', 'FAIL', 'No lockfile found.');
} catch (e) { audit('LOCKFILE', 'WARN', 'Scan failed.'); }

// --- VERDICT & TELEMETRY ---
const failed = jsonReport.summary.failed;
const brokenRuleIds = jsonReport.results.filter(r => r.status === 'FAIL').map(r => r.gate);

trackAudit(failed > 0 ? 'failed' : 'passed', brokenRuleIds);

// --- FINAL OUTPUT ---

if (isJson) {
  // 🤖 MACHINE OUTPUT (Pure JSON)
  jsonReport.success = failed === 0;
  console.log(JSON.stringify(jsonReport, null, 2));
  process.exit(failed > 0 ? 1 : 0);
} else {
  // 👨‍💻 HUMAN OUTPUT (Fancy UI)
  logHuman(chalk.gray('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  if (failed > 0) {
    logHuman(chalk.red.bold(`\n💥 AUDIT FAILED`));
    logHuman(chalk.cyan.bold(`\n→ https://www.strictkit.dev/pro?src=cli&f=${failed}\n`));
    setTimeout(() => process.exit(1), 300);
  } else {
    logHuman(chalk.green.bold(`\n✨ AUDIT PASSED`));
    logHuman(chalk.cyan.bold('\n→ https://www.strictkit.dev/pro?src=cli&f=0\n'));
    setTimeout(() => process.exit(0), 300);
  }
}