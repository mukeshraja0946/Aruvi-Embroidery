const path = require('path');
const fs = require('fs');

/**
 * Aruvi Embroidery — Centralized Persistent Storage Manager
 * 
 * Ensures all Admin-uploaded product preview images and downloadable ZIP packages
 * are preserved across code updates, Git operations, rebuilds, and deployments.
 * 
 * Supports configurable persistent mount paths via:
 *   - process.env.PERSISTENT_UPLOADS_DIR
 *   - process.env.UPLOADS_DIR
 * Fallback to local project directory:
 *   - <project_root>/public/uploads
 */

const defaultUploadsDir = path.join(__dirname, '../public/uploads');

function getUploadsDir() {
  const custom = process.env.PERSISTENT_UPLOADS_DIR || process.env.UPLOADS_DIR;
  if (custom && custom.trim() !== '') {
    return path.resolve(custom.trim());
  }
  return defaultUploadsDir;
}

function getPreviewsDir() {
  const dir = path.join(getUploadsDir(), 'previews');
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  }
  return dir;
}

function getDesignsDir() {
  const dir = path.join(getUploadsDir(), 'designs');
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  }
  return dir;
}

// Initialize directories on module load
try {
  getPreviewsDir();
  getDesignsDir();
} catch (e) {
  console.warn('[Storage] Directory initialization warning:', e.message);
}

/**
 * Resolves a web path (e.g. /public/uploads/previews/image-1.png or /uploads/designs/file.zip)
 * to an existing physical file on disk. Checks persistent storage first, then default repo path.
 */
function resolveFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') return null;

  // If already an existing absolute path on disk
  if (path.isAbsolute(filePath) && fs.existsSync(filePath)) {
    return filePath;
  }

  // Normalize path removing leading slashes and protocol
  let clean = filePath.trim().replace(/^\/+/, '');
  
  // Extract relative subpath within uploads
  let subpath = clean;
  if (subpath.startsWith('public/uploads/')) {
    subpath = subpath.replace(/^public\/uploads\//, '');
  } else if (subpath.startsWith('uploads/')) {
    subpath = subpath.replace(/^uploads\//, '');
  }

  // 1. Check persistent uploads directory
  const persistentCandidate = path.join(getUploadsDir(), subpath);
  if (fs.existsSync(persistentCandidate)) {
    return persistentCandidate;
  }

  // 2. Check default repository uploads directory (fallback)
  const defaultCandidate = path.join(defaultUploadsDir, subpath);
  if (fs.existsSync(defaultCandidate)) {
    return defaultCandidate;
  }

  // 3. Check relative from project root
  const rootCandidate = path.join(__dirname, '..', clean);
  if (fs.existsSync(rootCandidate)) {
    return rootCandidate;
  }

  // If filename only was passed, check in previews then designs
  const baseName = path.basename(clean);
  const inPreviews = path.join(getPreviewsDir(), baseName);
  if (fs.existsSync(inPreviews)) return inPreviews;

  const inDefaultPreviews = path.join(defaultUploadsDir, 'previews', baseName);
  if (fs.existsSync(inDefaultPreviews)) return inDefaultPreviews;

  const inDesigns = path.join(getDesignsDir(), baseName);
  if (fs.existsSync(inDesigns)) return inDesigns;

  const inDefaultDesigns = path.join(defaultUploadsDir, 'designs', baseName);
  if (fs.existsSync(inDefaultDesigns)) return inDefaultDesigns;

  // Return persistent target path only if returnTargetIfMissing is requested
  return returnTargetIfMissing ? persistentCandidate : null;
}

/**
 * Checks whether an uploaded file physically exists on disk.
 */
function fileExists(filePath) {
  const resolved = resolveFilePath(filePath, false);
  return Boolean(resolved && fs.existsSync(resolved));
}

/**
 * Returns the public web URL path for an uploaded file.
 */
function getWebPath(filename, type = 'previews') {
  const base = path.basename(filename);
  return `/public/uploads/${type}/${base}`;
}

function initStorage() {
  getPreviewsDir();
  getDesignsDir();
}

module.exports = {
  initStorage,
  getUploadsDir,
  getPreviewsDir,
  getDesignsDir,
  resolveFilePath,
  fileExists,
  getWebPath,
  defaultUploadsDir
};
