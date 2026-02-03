#!/usr/bin/env node
const chalk = require('chalk');
const glob = require('glob');
const fs = require('fs');
const path = require('path');

// Iniciamos métricas
const startTime = process.hrtime();
let rulesEvaluated = 0; // Contador dinámico honesto

const projectPath = process.argv[2] || '.';
const getFilePath = (relPath) => path.join(projectPath, relPath);
const label = (text) => chalk.bold(text.padEnd(11));

console.log(chalk.blue('\n🔍 Scanning project architecture...'));
console.log(chalk.gray(`📂 Target: ${path.resolve(projectPath)}`));
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

let violations = 0;

// 1. CHECK: Explicit 'any'
rulesEvaluated++;
const tsFiles = glob.sync('**/*.{ts,tsx}', { cwd: projectPath, ignore: 'node_modules/**' });
const anyRegex = /\b(as\s+any|:\s*any\b|<any>)/g;
let anyCount = 0;

tsFiles.forEach(file => {
  try {
    const content = fs.readFileSync(getFilePath(file), 'utf8');
    const matches = content.match(anyRegex);
    if (matches) anyCount += matches.length;
  } catch (e) {}
});

if (anyCount > 0) {
  console.log(`${chalk.red('✖')} ${label('INTEGRITY:')} ${anyCount} explicit 'any' types found. [FAIL]`);
  violations++;
} else {
  console.log(`${chalk.green('✔')} ${label('INTEGRITY:')} No explicit 'any' types found.`);
}

// 2. CHECK: Secrets
rulesEvaluated++;
const allFiles = glob.sync('**/*.{ts,tsx,js,jsx,json}', { cwd: projectPath, ignore: ['node_modules/**', '.env*', 'package-lock.json'] });
const secretRegex = /sk_live_[a-zA-Z0-9]+|AIza[a-zA-Z0-9\\-_]+|(?:"|')?api_key(?:"|')?\s*:\s*(?:"|')[a-zA-Z0-9\\-_]{10,}(?:"|')/i;
let secretsFound = [];

allFiles.forEach(file => {
  try {
    const content = fs.readFileSync(getFilePath(file), 'utf8');
    if (secretRegex.test(content)) secretsFound.push(file);
  } catch (e) {}
});

if (secretsFound.length > 0) {
  const extraCount = secretsFound.length > 1 ? ` (+${secretsFound.length - 1} others)` : '';
  console.log(`${chalk.yellow('⚠')} ${label('SECURITY:')} Hardcoded credential pattern in ${secretsFound[0]}${extraCount} [WARN]`);
  violations++; // Mantenemos la Opción A: Warning = Violación de baseline
} else {
  console.log(`${chalk.green('✔')} ${label('SECURITY:')} No obvious secret patterns detected.`);
}

// 3. CHECK: Docker (Condicional)
const dockerfilePath = getFilePath('Dockerfile');
if (fs.existsSync(dockerfilePath)) {
  rulesEvaluated++; // Solo contamos si existe
  const dockerContent = fs.readFileSync(dockerfilePath, 'utf8');
  const fromLines = dockerContent.split('\n').filter(line => line.trim().startsWith('FROM'));
  const hasLatest = fromLines.some(line => !line.includes(':') || line.includes(':latest'));

  if (hasLatest) {
    console.log(`${chalk.red('✖')} ${label('INFRA:')} Docker base image is unpinned (implicit or :latest). [FAIL]`);
    violations++;
  } else {
    console.log(`${chalk.green('✔')} ${label('INFRA:')} Docker base image is strictly pinned.`);
  }
} 
// Si no existe, no imprimimos nada ni sumamos al contador. Limpieza total.

// Métricas finales
const endTime = process.hrtime(startTime);
const timeInMs = (endTime[0] * 1000 + endTime[1] / 1e6).toFixed(2);

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(chalk.gray(`Rules evaluated: ${rulesEvaluated}  |  Audited in ${timeInMs}ms`));

if (violations > 0) {
  console.log(chalk.red(`\n👉 Conclusion: Your project violates the StrictKit Security Baseline.`));
  console.log(chalk.gray(`\nNext step:\n→ Fix violations and re-run: npx strictkit audit .`));
  process.exit(1); 
} else {
  console.log(chalk.green(`\n✅ Conclusion: Project meets StrictKit standards.`));
  process.exit(0);
}