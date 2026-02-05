#!/usr/bin/env node
const chalk = require('chalk');
const { globSync } = require('glob');
const fs = require('fs');
const path = require('path');

// CONFIG - Parse arguments correctly
const args = process.argv.slice(2);
const COMMANDS = ['audit', 'explain', 'help', '--help', '-h', '--version', '-v'];
const command = args.find(a => COMMANDS.includes(a)) || 'audit';
const PROJECT_PATH = args.find(a => !COMMANDS.includes(a) && !a.startsWith('-')) || '.';
const IGNORE_PATTERNS = ['node_modules/**', 'dist/**', '.next/**', 'coverage/**', '.git/**', '*.min.js'];

// Handle help/version
if (['help', '--help', '-h'].includes(command)) {
  console.log(`
${chalk.bold('StrictKit')} - The Code Integrity Protocol

${chalk.yellow('Usage:')}
  npx strictkit [command] [path]

${chalk.yellow('Commands:')}
  audit [path]    Audit a project (default: current directory)
  help            Show this help message

${chalk.yellow('Examples:')}
  npx strictkit                  # Audit current directory
  npx strictkit audit            # Same as above
  npx strictkit ./my-project     # Audit specific directory
  npx strictkit audit ../app     # Audit with explicit command

${chalk.yellow('More info:')} https://strictkit.dev
`);
  process.exit(0);
}

if (['--version', '-v'].includes(command)) {
  try {
    const pkg = require('./package.json');
    console.log(pkg.version);
  } catch {
    console.log('unknown');
  }
  process.exit(0);
}

console.log(chalk.bold.white('\n🔒 STRICTKIT: The Code Integrity Protocol'));
console.log(chalk.gray(`   Auditing: ${path.resolve(PROJECT_PATH)}\n`));

const results = [];

function audit(gate, status, msg) {
  results.push({ gate, status, msg });
  const icon = status === 'FAIL' ? '❌' : (status === 'WARN' ? '⚠️ ' : '✅');
  const color = status === 'FAIL' ? chalk.red : (status === 'WARN' ? chalk.yellow : chalk.green);
  console.log(`${icon} ${chalk.bold(gate.padEnd(15))} ${color(msg)}`);
}

// UTILS - Removes all comments from code (single-line and multi-line)
function stripComments(code) {
  // Remove multi-line comments /* ... */
  code = code.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove single-line comments // ... (but not URLs like https://)
  code = code.replace(/(?<!:)\/\/.*$/gm, '');
  return code;
}

// Removes string literals to avoid false positives
function stripStrings(code) {
  // Remove template literals
  code = code.replace(/`[^`]*`/g, '""');
  // Remove double-quoted strings
  code = code.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  // Remove single-quoted strings
  code = code.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  return code;
}

// --- GATE 1: THE NO-ANY POLICY ---
try {
  const tsFiles = globSync('**/*.{ts,tsx}', { cwd: PROJECT_PATH, ignore: IGNORE_PATTERNS });
  let anyCount = 0;
  let anyFiles = [];
  
  tsFiles.forEach(f => {
    const content = fs.readFileSync(path.join(PROJECT_PATH, f), 'utf8');
    let clean = stripComments(content);
    clean = stripStrings(clean);
    
    // Detecta ': any' o 'as any' (con o sin espacio)
    const patterns = [
      /:\s*any\b/g,      // : any (type annotation)
      /\bas\s+any\b/g,   // as any (type assertion)
      /<any>/g,          // Array<any> or generic<any>
      /any\[\]/g,        // any[]
    ];
    
    let fileCount = 0;
    patterns.forEach(p => {
      const matches = clean.match(p);
      if (matches) fileCount += matches.length;
    });
    
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
} catch (e) { 
  audit('NO_ANY', 'WARN', 'Could not complete TypeScript scan.'); 
}

// --- GATE 2: SECRET SENTINEL ---
const SECRET_PATTERNS = [
  // Specific provider patterns (high confidence)
  /sk_live_[a-zA-Z0-9]{24,}/,           // Stripe Live Key
  /sk_test_[a-zA-Z0-9]{24,}/,           // Stripe Test Key
  /AKIA[0-9A-Z]{16}/,                   // AWS Access Key
  /ghp_[a-zA-Z0-9]{36}/,                // GitHub Personal Token
  /gho_[a-zA-Z0-9]{36}/,                // GitHub OAuth Token
  /github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}/, // GitHub Fine-grained PAT
  /xox[baprs]-[0-9a-zA-Z-]{10,}/,       // Slack Token
  /sk-[a-zA-Z0-9]{48}/,                 // OpenAI Key
  /sk-proj-[a-zA-Z0-9]{48}/,            // OpenAI Project Key
  /AIza[a-zA-Z0-9\-_]{35}/,             // Google API Key
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, // Private Keys
  /eyJ[a-zA-Z0-9_-]{20,}\.eyJ[a-zA-Z0-9_-]{20,}\./,   // JWT (loose)
];

let secretsFound = [];
try {
  // Scan code files (NOT .env - those are supposed to have secrets)
  const codeFiles = globSync('**/*.{ts,tsx,js,jsx,json}', { 
    cwd: PROJECT_PATH, 
    ignore: [...IGNORE_PATTERNS, '**/*.test.*', '**/*.spec.*', '**/test/**', '**/__tests__/**']
  });
  
  codeFiles.forEach(f => {
    const content = fs.readFileSync(path.join(PROJECT_PATH, f), 'utf8');
    
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        secretsFound.push(f);
        break; // One match per file is enough
      }
    }
  });
  
  if (secretsFound.length > 0) {
    audit('SECRETS', 'FAIL', `Hardcoded secrets detected in ${secretsFound.length} file(s). Check: ${secretsFound[0]}`);
  } else {
    audit('SECRETS', 'PASS', 'No hardcoded secrets detected in source code.');
  }
} catch (e) {
  audit('SECRETS', 'WARN', 'Could not complete secrets scan.');
}

// --- GATE 3: DOCKER GATEKEEPER ---
try {
  const dockerfilePath = path.join(PROJECT_PATH, 'Dockerfile');
  
  if (fs.existsSync(dockerfilePath)) {
    const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
    const fromLines = dockerfile.match(/^FROM\s+([^\s]+)/gm) || [];
    
    let weakTags = [];
    
    fromLines.forEach(line => {
      const image = line.replace(/^FROM\s+/, '').split(/\s+/)[0]; // Get image name only
      
      // Skip build stage references (FROM builder, FROM base, etc.)
      if (!image.includes('/') && !image.includes(':') && /^[a-z]+$/.test(image)) {
        // Could be a stage reference like "FROM builder" - check if it's a known base
        const knownBases = ['ubuntu', 'debian', 'alpine', 'node', 'python', 'nginx', 'postgres', 'redis', 'mongo'];
        if (knownBases.includes(image)) {
          weakTags.push(image + ' (no tag)');
        }
        // Otherwise assume it's a stage reference, skip
        return;
      }
      
      const hasTag = image.includes(':');
      const isLatest = image.endsWith(':latest');
      const isWeakTag = image.match(/:(?:lts|stable|current|mainline)$/);
      
      if (!hasTag) {
        weakTags.push(image + ' (no tag)');
      } else if (isLatest) {
        weakTags.push(image);
      } else if (isWeakTag) {
        weakTags.push(image + ' (floating tag)');
      }
    });

    if (weakTags.length > 0) {
      audit('DOCKER', 'FAIL', `Unpinned image(s): ${weakTags[0]}. Use specific versions.`);
    } else if (fromLines.length > 0) {
      audit('DOCKER', 'PASS', 'Docker images are pinned.');
    } else {
      audit('DOCKER', 'WARN', 'Dockerfile found but no FROM statements detected.');
    }
  } else {
    audit('DOCKER', 'WARN', 'No Dockerfile found. Skipped.');
  }
} catch (e) {
  audit('DOCKER', 'WARN', 'Could not analyze Dockerfile.');
}

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
    let clean = stripComments(content);
    clean = stripStrings(clean);
    
    const matches = clean.match(/console\.log\s*\(/g);
    if (matches) {
      logCount += matches.length;
      logFiles.push(f);
    }
  });

  if (logCount > 0) {
    audit('CONSOLE', 'FAIL', `Found ${logCount} console.log() in ${logFiles.length} file(s). Use a proper logger.`);
  } else {
    audit('CONSOLE', 'PASS', 'No console.log pollution detected.');
  }
} catch (e) {
  audit('CONSOLE', 'WARN', 'Could not complete console scan.');
}

// --- GATE 5: DEPENDENCY FREEZE ---
try {
  const lockfiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'];
  const foundLocks = lockfiles.filter(f => fs.existsSync(path.join(PROJECT_PATH, f)));
  
  // Also check if package.json exists
  const hasPkgJson = fs.existsSync(path.join(PROJECT_PATH, 'package.json'));
  
  if (!hasPkgJson) {
    audit('LOCKFILE', 'WARN', 'No package.json found. Not a Node.js project?');
  } else if (foundLocks.length > 0) {
    audit('LOCKFILE', 'PASS', `Dependency tree frozen (${foundLocks[0]}).`);
  } else {
    audit('LOCKFILE', 'FAIL', 'No lockfile found. Run npm install to generate package-lock.json.');
  }
} catch (e) {
  audit('LOCKFILE', 'WARN', 'Could not check lockfiles.');
}

// --- VERDICT ---
const failed = results.filter(r => r.status === 'FAIL').length;
const warned = results.filter(r => r.status === 'WARN').length;
const passed = results.filter(r => r.status === 'PASS').length;

console.log(chalk.gray('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
console.log(chalk.gray(`   ${passed} passed · ${failed} failed · ${warned} skipped`));

if (failed > 0) {
  console.log(chalk.red.bold(`\n💥 AUDIT FAILED`));
  console.log(chalk.white('Your codebase has integrity violations.'));
  console.log(chalk.gray('\nFix manually (~20h) or get the pre-hardened architecture:'));
  console.log(chalk.cyan.bold(`\n→ https://strictkit.dev/pro?src=cli&f=${failed}\n`));
  process.exit(1);
} else {
  console.log(chalk.green.bold(`\n✨ AUDIT PASSED`));
  console.log(chalk.white('Your codebase meets the StrictKit baseline.'));
  console.log(chalk.gray('\nEnforce this in CI/CD automatically:'));
  console.log(chalk.cyan.bold('\n→ https://strictkit.dev/pro?src=cli&f=0\n'));
  process.exit(0);
}