const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

// AJUSTE 1: Sin www para evitar latencia de redirects. 
// Asegúrate que tu dominio en Vercel responda en la raíz.
const ENDPOINT = 'https://www.strictkit.dev/api/telemetry'; 

const CONFIG_DIR = path.join(os.homedir(), '.strictkit');
const ID_FILE = path.join(CONFIG_DIR, 'anon-id');

function generateUUID() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

function getAnonymousId() {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    
    if (fs.existsSync(ID_FILE)) {
      return fs.readFileSync(ID_FILE, 'utf8').trim();
    }

    const id = generateUUID();
    fs.writeFileSync(ID_FILE, id);
    return id;
  } catch (error) {
    return 'unknown-machine';
  }
}

function getSource() {
  if (process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITLAB_CI) return 'ci';
  if (fs.existsSync('/.dockerenv')) return 'container';
  return 'local';
}

function getVersion() {
  try {
    let currentDir = __dirname;
    while (currentDir !== path.parse(currentDir).root) {
      const pkgPath = path.join(currentDir, 'package.json');
      if (fs.existsSync(pkgPath)) return require(pkgPath).version;
      currentDir = path.dirname(currentDir);
    }
  } catch (e) {}
  return '0.0.0';
}

function trackAudit(result, ruleIds) {
  // AJUSTE 2: Opt-out real. Si está off, no tocamos la red ni generamos ID.
  if (process.env.STRICTKIT_TELEMETRY === 'off') return;

  const isDebug = process.env.STRICTKIT_DEBUG === 'true';

  // Solo generamos el ID si vamos a enviar algo
  const anonId = getAnonymousId();

  const payload = JSON.stringify({
    event: 'audit_completed',
    anonymousId: anonId,
    source: getSource(),
    version: getVersion(),
    result: result,
    rulesBroken: ruleIds,
    timestamp: new Date().toISOString()
  });

  const req = https.request(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    },
    timeout: 1500 
  }, (res) => {
    if (isDebug) console.log(`[Telemetry] Status: ${res.statusCode}`);
    res.on('data', () => {}); // Consumir stream
  });

  req.on('error', (e) => { 
    if (isDebug) console.error('[Telemetry Error]', e.message);
  });
  
  req.on('timeout', () => {
    if (isDebug) console.error('[Telemetry Timeout]');
    req.destroy();
  });
  
  req.write(payload);
  req.end();
}

module.exports = { trackAudit };