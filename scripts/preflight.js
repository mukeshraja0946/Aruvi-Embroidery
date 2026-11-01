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
