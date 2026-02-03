#!/usr/bin/env node
const chalk = require('chalk');
const glob = require('glob');
const fs = require('fs');
const path = require('path');

const startTime = process.hrtime();
const args = process.argv.slice(2);

// 1. GESTIÓN DE COMANDOS Y FLAGS
const isJson = args.includes('--json');
const command = args[0] && !args[0].startsWith('-') ? args[0] : 'audit';
const projectPath = args.find(a => !a.startsWith('-') && a !== command) || '.';

// 2. DOCTRINA (LA FILOSOFÍA DETRÁS DEL CÓDIGO)
const DOCTRINE = {
  'INTEGRITY': {
    id: 'SK-INT-001',
    severity: 'FAIL',
    philosophy: 'The "any" type is a silent virus. It disables the compiler and hides technical debt.',
    fix: 'Use unknown, interfaces, or generics to maintain type safety.'
  },
  'SECURITY': {
    id: 'SK-SEC-001',
    severity: 'WARN',
    philosophy: 'Hardcoded secrets are a liability. Environment variables are the only standard.',
    fix: 'Move secrets to .env and ensure .env is in .gitignore.'
  },
  'INFRA': {
    id: 'SK-INF-001',
    severity: 'FAIL',
    philosophy: 'Unpinned Docker images create non-deterministic builds.',
    fix: 'Use specific tags (e.g., node:20-alpine) instead of :latest.'
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
    console.log(`${chalk.bold('Action:')}      ${doc.fix}\n`);
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

// --- RUN CHECKS (Defensivos) ---
// INTEGRITY
const tsFiles = glob.sync('**/*.{ts,tsx}', { cwd: projectPath, ignore: 'node_modules/**' });
let anyCount = 0;
tsFiles.forEach(f => {
  try {
    const content = fs.readFileSync(path.join(projectPath, f), 'utf8');
    const matches = content.match(/\b(as\s+any|:\s*any\b|<any>)/g);
    if (matches) anyCount += matches.length;
  } catch (e) {}
});
if (anyCount > 0) addResult('INTEGRITY', 'FAIL', `${anyCount} explicit 'any' types found.`);
else addResult('INTEGRITY', 'PASS', 'No explicit any types found.');

// SECURITY
const allFiles = glob.sync('**/*.{ts,tsx,js,jsx,json}', { cwd: projectPath, ignore: ['node_modules/**', '.env*', 'package-lock.json'] });
let secretFiles = [];
allFiles.forEach(f => {
  try {
    const content = fs.readFileSync(path.join(projectPath, f), 'utf8');
    if (/sk_live_[a-zA-Z0-9]+|AIza[a-zA-Z0-9\\-_]+|(?:"|')?api_key(?:"|')?\s*:\s*(?:"|')[a-zA-Z0-9\\-_]{10,}(?:"|')/i.test(content)) {
      secretFiles.push(f);
    }
  } catch (e) {}
});
if (secretFiles.length > 0) addResult('SECURITY', 'WARN', `Secrets detected in ${secretFiles[0]}${secretFiles.length > 1 ? ' (and others)' : ''}`);
else addResult('SECURITY', 'PASS', 'No obvious secret patterns detected.');

// --- FINAL REPORT ---
const [s, ns] = process.hrtime(startTime);
const durationMs = parseFloat((s * 1e3 + ns / 1e6).toFixed(2));
const violations = auditResults.filter(r => r.status === 'FAIL' || r.status === 'WARN').length;

if (isJson) {
  process.stdout.write(JSON.stringify({
    version: "0.1.2",
    status: violations > 0 ? "FAILED" : "PASSED",
    metrics: { violations, rules_evaluated: auditResults.length, duration_ms: durationMs },
    results: auditResults
  }, null, 2) + '\n');
} else {
  console.log(chalk.blue('\n🔍 StrictKit Audit Report'));
  console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
  auditResults.forEach(res => {
    const color = res.status === 'PASS' ? chalk.green : (res.status === 'WARN' ? chalk.yellow : chalk.red);
    console.log(`${color(res.status.padEnd(5))} [${res.id}] ${res.rule.padEnd(10)}: ${res.message}`);
  });
  console.log(chalk.gray('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  if (violations > 0) {
    console.log(chalk.red(`\n✖ Conclusion: Project violates the StrictKit Baseline.`));
    process.exit(1);
  } else {
    console.log(chalk.green(`\n✔ Conclusion: Project meets StrictKit standards.`));
    process.exit(0);
  }
}