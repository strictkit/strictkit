#!/usr/bin/env node
const chalk = require('chalk');
const glob = require('glob');
const fs = require('fs');
const path = require('path');
const { trackAudit } = require('./utils/telemetry'); 

const startTime = process.hrtime();
const args = process.argv.slice(2);

// 1. GESTIÓN DE COMANDOS Y FLAGS
const isJson = args.includes('--json');
const command = args[0] && !args[0].startsWith('-') ? args[0] : 'audit';
const projectPath = args.find(a => !a.startsWith('-') && a !== command) || '.';

// 2. DOCTRINA
const DOCTRINE = {
  'INTEGRITY': {
    id: 'SK-INT-001',
    severity: 'FAIL',
    philosophy: 'The "any" type is a silent virus. It disables the compiler and hides technical debt.',
    fix: 'Use unknown, interfaces, or generics to maintain type safety.'
  },
  'SECURITY': {
    id: 'SK-SEC-001',
    severity: 'WARN', // Cambiar a FAIL si quieres ser muy estricto
    philosophy: 'Hardcoded secrets are a liability. Environment variables are the only standard.',
    fix: 'Move secrets to .env and ensure .env is in .gitignore.'
  },
  'INFRA': {
    id: 'SK-INF-001',
    severity: 'FAIL',
    philosophy: 'Unpinned Docker images create non-deterministic builds.',
    fix: 'Use specific tags (e.g., node:20.1-alpine) instead of :latest.'
  }
};

// 3. COMANDO: EXPLAIN
if (command === 'explain') {
  const rule = args[1]?.toUpperCase();
  if (rule && DOCTRINE[rule]) {
    const doc = DOCTRINE[rule];
    console.log(chalk.blue(`\n📖 StrictKit Doctrine: ${rule} [${doc.id}]`));
    console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(`${chalk.bold('Severity:')}    ${doc.severity === 'FAIL' ? chalk.red(doc.severity) : chalk.yellow(doc.severity)}`);
    console.log(`${chalk.bold('Philosophy:')}  ${doc.philosophy}`);
    console.log(`${chalk.bold('Action:')}       ${doc.fix}\n`);
  } else {
    console.log(chalk.yellow('\nUsage: npx strictkit explain [INTEGRITY|SECURITY|INFRA]'));
  }
  process.exit(0);
}

// 4. COMANDO: AUDIT
const auditResults = [];
const addResult = (rule, status, message) => {
  auditResults.push({ id: DOCTRINE[rule]?.id || 'SK-GEN-001', rule, status, message });
};

// --- RUN CHECKS ---

// [CHECK 1] INTEGRITY (TypeScript Strictness)
// Mejora: Limpia comentarios para evitar falsos positivos y detecta 'any[]'
const tsFiles = glob.sync('**/*.{ts,tsx}', { cwd: projectPath, ignore: ['node_modules/**', 'dist/**', 'build/**'] });
let anyCount = 0;
let anyFiles = 0;

tsFiles.forEach(f => {
  try {
    const content = fs.readFileSync(path.join(projectPath, f), 'utf8');
    
    // Eliminar comentarios para no detectar " // TODO: remove any"
    const noComments = content
      .replace(/\/\*[\s\S]*?\*\//g, '') 
      .replace(/\/\/.*/g, '');           
    
    // Patrones extendidos
    const patterns = [
      /\bas\s+any\b/g,           // as any
      /:\s*any\b/g,              // : any
      /any\[\]/g,                // any[]
      /<any>/g,                  // Array<any>
      /\bany\s*,/g,              // any, (in generics)
      /,\s*any\b/g               // , any (in generics)
    ];
    
    let fileMatches = 0;
    patterns.forEach(p => {
        const matches = noComments.match(p);
        if (matches) fileMatches += matches.length;
    });

    if (fileMatches > 0) {
        anyCount += fileMatches;
        anyFiles++;
    }
  } catch (e) {}
});

if (anyCount > 0) addResult('INTEGRITY', 'FAIL', `${anyCount} explicit 'any' types found in ${anyFiles} files.`);
else addResult('INTEGRITY', 'PASS', 'No explicit any types found.');


// [CHECK 2] SECURITY (Secret Scanning)
// Mejora: Regex mucho más agresivos (AWS, GitHub, OpenAI, Supabase)
const allFiles = glob.sync('**/*.{ts,tsx,js,jsx,json,env*}', { cwd: projectPath, ignore: ['node_modules/**', 'package-lock.json', '.git/**'] });
const SECRET_PATTERNS = [
  /sk_live_[a-zA-Z0-9]{24,}/,       // Stripe Live
  /AKIA[0-9A-Z]{16}/,               // AWS Access Key
  /ghp_[a-zA-Z0-9]{36}/,            // GitHub Personal Token
  /gho_[a-zA-Z0-9]{36}/,            // GitHub OAuth
  /AIza[a-zA-Z0-9\-_]{35}/,         // Google API
  /sk-proj-[a-zA-Z0-9]{48}/,        // OpenAI Project
  /sk-[a-zA-Z0-9]{48}/,             // OpenAI Legacy
  /eyJ[a-zA-Z0-9_-]{20,}\.eyJ/,     // JWT / Supabase potential leaks
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ // Private Keys (SSH/Deploy)
];

let secretFiles = [];
allFiles.forEach(f => {
  try {
    const content = fs.readFileSync(path.join(projectPath, f), 'utf8');
    for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(content)) {
            secretFiles.push(f);
            break; // Ya encontramos uno, pasamos al siguiente archivo
        }
    }
  } catch (e) {}
});

if (secretFiles.length > 0) addResult('SECURITY', 'WARN', `Potential secrets detected in ${secretFiles.length} files (e.g., ${secretFiles[0]}).`);
else addResult('SECURITY', 'PASS', 'No obvious secret patterns detected.');


// [CHECK 3] INFRA (Docker)
// Mejora: Lógica más robusta para detectar tags débiles
try {
  const dockerPath = path.join(projectPath, 'Dockerfile');
  if (fs.existsSync(dockerPath)) {
    const dockerfile = fs.readFileSync(dockerPath, 'utf8');
    
    const hasLatest = /FROM\s+[\w\-./]+:latest/i.test(dockerfile);
    const hasWeakTag = /FROM\s+[\w\-./]+:(?![0-9])/i.test(dockerfile); 
    const hasAlpineOnly = /FROM\s+[\w\-./]+:alpine\b/i.test(dockerfile); // 🏔️ Alpine sin versión
    const hasNoTag = /FROM\s+[\w\-./]+[\s\n]/i.test(dockerfile) && !dockerfile.includes(':');

    if (hasLatest || hasWeakTag || hasNoTag || hasAlpineOnly) {
       addResult('INFRA', 'FAIL', 'Unpinned Docker image detected. Use specific versions (e.g., node:20.1-alpine).');
    } else {
       addResult('INFRA', 'PASS', 'Docker images appear pinned.');
    }
  }
} catch (e) {}


// --- FINAL REPORT & TELEMETRY ---
const [s, ns] = process.hrtime(startTime);
const durationMs = parseFloat((s * 1e3 + ns / 1e6).toFixed(2));
const violations = auditResults.filter(r => r.status === 'FAIL' || r.status === 'WARN').length;
const isFailure = violations > 0;

// 2. DISPARAR TELEMETRÍA (Fire & Forget)
// Safe wrapper en caso de que utils/telemetry falle
try {
    const brokenRuleIds = auditResults.filter(r => r.status !== 'PASS').map(r => r.id);
    trackAudit(isFailure ? 'FAIL' : 'PASS', brokenRuleIds);
} catch (e) {
    // Telemetría no debe romper el CLI
}

// 3. WRAPPER CON TIMEOUT
setTimeout(() => {
  // Manejo de versión robusto
  let pkgVersion = "unknown";
  try { pkgVersion = require('./package.json').version; } catch(e) {}

  if (isJson) {
    process.stdout.write(JSON.stringify({
      version: pkgVersion,
      status: violations > 0 ? "FAILED" : "PASSED",
      metrics: { violations, rules_evaluated: auditResults.length, duration_ms: durationMs },
      results: auditResults
    }, null, 2) + '\n');
    process.exit(violations > 0 ? 1 : 0);
  } else {
    console.log(chalk.blue('\n🔍 StrictKit Audit Report'));
    console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
    
    auditResults.forEach(res => {
      let color = chalk.green;
      if (res.status === 'WARN') color = chalk.yellow;
      if (res.status === 'FAIL') color = chalk.red;
      
      console.log(`${color(res.status.padEnd(5))} [${res.id}] ${res.rule.padEnd(10)}: ${res.message}`);
    });

    console.log(chalk.gray('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.gray(`\nℹ  Anonymous usage metrics collected. Set STRICTKIT_TELEMETRY=off to disable.`));

    if (violations > 0) {
      console.log(chalk.red(`\n✖ Conclusion: Project violates the StrictKit Baseline.`));
      process.exit(1);
    } else {
      console.log(chalk.green(`\n✔ Conclusion: Project meets StrictKit standards.`));
      process.exit(0);
    }
  }
}, 500);