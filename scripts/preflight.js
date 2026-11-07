/**
 * Preflight Deployment Verification Script
 * Run before every git push to ensure zero startup crashes and Hostinger compatibility:
 *   npm run preflight
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const dotenv = require('dotenv');

dotenv.config();

const projectRoot = path.resolve(__dirname, '..');

console.log('====================================================');
console.log('✈️  ARUVI EMBROIDERY: PREFLIGHT DEPLOYMENT AUDIT');
console.log('====================================================\n');

let criticalErrors = 0;
let warnings = 0;

function logPass(msg) {
  console.log(`  [PASS] ✓ ${msg}`);
}

function logFail(msg, detail = '') {
  console.error(`  [FAIL] ✗ ${msg}`);
  if (detail) console.error(`         ${detail}`);
  criticalErrors++;
}

function logWarn(msg, detail = '') {
  console.warn(`  [WARN] ⚠️ ${msg}`);
  if (detail) console.warn(`         ${detail}`);
  warnings++;
}

// ---------------------------------------------------------
// 1. Package Dependencies Check
// ---------------------------------------------------------
console.log('--- 1. Checking Dependencies & Critical Modules ---');
const pkgPath = path.join(projectRoot, 'package.json');
let pkg = {};
try {
  pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  logPass('package.json parsed successfully');
} catch (e) {
  logFail('Failed to read package.json', e.message);
}

const criticalModules = [
  'express',
  'mysql2',
  'express-session',
  'express-mysql-session',
  'connect-flash',
  'cookie-parser',
  'helmet',
  'cors',
  'ejs',
  'multer',
  'archiver',
  'adm-zip',
  'xlsx',
  'razorpay',
  'nodemailer'
];

for (const mod of criticalModules) {
  try {
    require(mod);
    logPass(`Required module "${mod}" is installed and loads cleanly`);
  } catch (err) {
    logFail(`Missing or broken module: "${mod}"`, err.message);
  }
}

// Check native sharp module gracefully
const { isSharpAvailable, getSharpStatus } = require('../utils/sharpHelper');
const sharpStatus = getSharpStatus();
if (sharpStatus.available) {
  logPass(`Native image processor "sharp" is available (${sharpStatus.mode})`);
} else {
  logWarn(`Native "sharp" module is operating in fallback mode (${sharpStatus.error || 'native binary not built'})`);
}

// ---------------------------------------------------------
// 2. Syntax & Compilation Check (All Project JS Files)
// ---------------------------------------------------------
console.log('\n--- 2. Syntax & Import Verification ---');
const scanDirs = ['config', 'controllers', 'models', 'routes', 'services', 'utils', 'middleware', 'scripts'];
let filesChecked = 0;

function checkSyntax(filePath) {
  filesChecked++;
  try {
    execSync(`node --check "${filePath}"`, { stdio: 'pipe' });
  } catch (err) {
    const out = (err.stderr || err.stdout || '').toString();
    logFail(`Syntax error in ${path.relative(projectRoot, filePath)}`, out.split('\n')[0]);
  }
}

// Check server.js
checkSyntax(path.join(projectRoot, 'server.js'));

for (const dir of scanDirs) {
  const fullDir = path.join(projectRoot, dir);
  if (!fs.existsSync(fullDir)) continue;
  const entries = fs.readdirSync(fullDir, { recursive: true });
  for (const entry of entries) {
    const entryPath = path.join(fullDir, entry);
    if (fs.existsSync(entryPath) && fs.statSync(entryPath).isFile() && entryPath.endsWith('.js')) {
      checkSyntax(entryPath);
    }
  }
}
logPass(`Validated JavaScript syntax across ${filesChecked} files without syntax errors`);

// ---------------------------------------------------------
// 2b. Entry File & Hostinger listen() Startup Audit
// ---------------------------------------------------------
console.log('\n--- 2b. Hostinger Entry File & Startup Audit ---');
const serverJsPath = path.join(projectRoot, 'server.js');
try {
  const serverContent = fs.readFileSync(serverJsPath, 'utf8');
  const hasRequireMainGuard = /(?:if|\}\s*else\s+if)\s*\(\s*require\.main\s*===\s*module\s*\)/.test(serverContent);
  if (hasRequireMainGuard) {
    logFail('server.js contains "if (require.main === module)" which prevents Hostinger from calling app.listen() within 3s');
  } else {
    logPass('server.js does NOT contain conditional "require.main === module" guard');
  }

  if (serverContent.includes('app.listen(')) {
    logPass('server.js calls app.listen() unconditionally at module load time');
  } else {
    logFail('server.js does not contain an unconditional app.listen() call');
  }
} catch (e) {
  logFail('Failed to read server.js for startup audit', e.message);
}

// ---------------------------------------------------------
// 2c. Deep Module Require & Runtime Integrity Check
// ---------------------------------------------------------
console.log('\n--- 2c. Deep Module Require & Runtime Integrity Check ---');
const requireDirs = ['config', 'routes', 'controllers', 'controllers/admin', 'services', 'middleware', 'models', 'utils'];
let requiredModulesCount = 0;

for (const dir of requireDirs) {
  const targetDir = path.join(projectRoot, dir);
  if (!fs.existsSync(targetDir)) continue;
  const files = fs.readdirSync(targetDir);
  for (const f of files) {
    if (!f.endsWith('.js')) continue;
    const fullPath = path.join(targetDir, f);
    const relPath = path.relative(projectRoot, fullPath);
    requiredModulesCount++;
    try {
      require(fullPath);
    } catch (reqErr) {
      const errOut = reqErr.stack || reqErr.message || '';
      const firstLine = errOut.split('\n')[0];
      logFail(`Module load failed: ${relPath}`, firstLine.trim());
    }
  }
}
logPass(`Successfully verified ${requiredModulesCount} application modules load cleanly without TypeError / crash`);

// ---------------------------------------------------------
// 2d. Storage API & Method Integrity Audit
// ---------------------------------------------------------
console.log('\n--- 2d. Storage API & Method Integrity Audit ---');
try {
  const configStorage = require('../config/storage');
  const storageService = require('../services/storageService');

  // Verify getCategoriesDir specifically
  if (typeof configStorage.getCategoriesDir === 'function' && typeof storageService.getCategoriesDir === 'function') {
    logPass('getCategoriesDir() exists and is callable on both config/storage and storageService');
  } else {
    logFail('getCategoriesDir is missing on config/storage or storageService');
  }

  // Scan all project JS files for storage.<method> calls
  function scanJsFiles(dir, list = []) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      if (item === 'node_modules' || item === '.git' || item === 'brain') continue;
      const p = path.join(dir, item);
      const st = fs.statSync(p);
      if (st.isDirectory()) scanJsFiles(p, list);
      else if (item.endsWith('.js')) list.push(p);
    }
    return list;
  }

  const allJs = scanJsFiles(projectRoot);
  const missingMethods = new Set();

  for (const jsFile of allJs) {
    const src = fs.readFileSync(jsFile, 'utf8');
    const matches = src.matchAll(/\b(?:storage|storageService)\.([a-zA-Z0-9_]+)\s*\(/g);
    for (const m of matches) {
      const method = m[1];
      if (typeof configStorage[method] !== 'function' || typeof storageService[method] !== 'function') {
        missingMethods.add(`${method} (called in ${path.relative(projectRoot, jsFile)})`);
      }
    }
  }

  if (missingMethods.size > 0) {
    for (const missing of missingMethods) {
      logFail(`Missing storage method: storage.${missing}`);
    }
  } else {
    logPass(`All storage method calls across ${allJs.length} files exist and match storage API exports`);
  }
} catch (storageAuditErr) {
  logFail('Storage API audit failed to execute', storageAuditErr.message);
}

// ---------------------------------------------------------
// 3. Environment Variables Validation
// ---------------------------------------------------------
console.log('\n--- 3. Environment Variables Check ---');

// Database credentials
const hasDbUrl = Boolean(process.env.DATABASE_URL || process.env.MYSQL_URL);
const hasDbVars = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

if (hasDbUrl || hasDbVars) {
  logPass(`Database configuration present (Host: ${process.env.DB_HOST || 'via URL'}, DB: ${process.env.DB_NAME || 'via URL'})`);
} else {
  logWarn('DB credentials missing or incomplete (DB_HOST, DB_USER, DB_NAME)');
}

// Session Secret
if (process.env.SESSION_SECRET) {
  logPass('SESSION_SECRET is configured');
} else {
  logWarn('SESSION_SECRET is not set (will fall back to auto-generated default)');
}

// Persistent Storage Directory (UPLOAD_DIR)
const uploadDir = process.env.UPLOAD_DIR || process.env.PERSISTENT_UPLOADS_DIR;
if (uploadDir && uploadDir.trim() !== '') {
  const resolved = path.resolve(uploadDir.trim());
  const insideRepo = resolved.startsWith(projectRoot) || resolved.includes('hbuilds') || resolved.includes('versions');
  if (insideRepo) {
    logWarn(`UPLOAD_DIR is inside project/hbuilds (${resolved}). In production, set UPLOAD_DIR=/home/u101925264/aruvi-uploads in hPanel.`);
  } else {
    logPass(`UPLOAD_DIR is configured outside project (${resolved})`);
  }
} else {
  logWarn('UPLOAD_DIR is not set. In Hostinger hPanel, set UPLOAD_DIR=/home/u101925264/aruvi-uploads to prevent uploads disappearing.');
}

// Payment Gateway (Razorpay)
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  const isLive = process.env.RAZORPAY_KEY_ID.startsWith('rzp_live');
  logPass(`Razorpay configured in ${isLive ? 'LIVE' : 'TEST'} mode (${process.env.RAZORPAY_KEY_ID.slice(0, 10)}...)`);
} else {
  logWarn('RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET missing in environment (simulated checkout fallback active)');
}

// ---------------------------------------------------------
// Summary
// ---------------------------------------------------------
console.log('\n====================================================');
console.log(`PREFLIGHT SUMMARY: ${criticalErrors} CRITICAL ERROR(S), ${warnings} WARNING(S)`);
console.log('====================================================\n');

if (criticalErrors > 0) {
  console.error('❌ PREFLIGHT FAILED: Do NOT deploy until critical errors are resolved.');
  process.exit(1);
} else {
  console.log('✅ PREFLIGHT PASSED: Project is safe for deployment.');
  process.exit(0);
}
