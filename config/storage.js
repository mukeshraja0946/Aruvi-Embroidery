const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

/**
 * Aruvi Embroidery — Centralized Persistent Storage Manager
 * 
 * Guarantees that all Admin-uploaded product images and design files
 * are permanently preserved across Git pushes, deploys, and restarts.
 * 
 * Supports:
 * 1. Persistent local directory OUTSIDE the deployment folder via:
 *    - process.env.UPLOAD_DIR (e.g. UPLOAD_DIR=/var/data/uploads or C:/aruvi_data/uploads)
 *    - process.env.PERSISTENT_UPLOADS_DIR
 *    - Fallback: <project_root>/uploads or <project_root>/public/uploads
 * 
 * 2. Public Preview Images vs. Private Paid Design Files:
 *    - previews/       -> Publicly accessible images served via express.static
 *    - private_designs/-> Strictly private machine files/ZIPs, accessible ONLY via authenticated routes
 * 
 * 3. Optional Cloud Storage Driver via:
 *    - process.env.STORAGE_DRIVER ('local' | 'cloudinary' | 's3' | 'r2' | 'cloud')
 *    - Cloudinary for preview images
 *    - S3 / Cloudflare R2 for design archives
 */

const defaultUploadsDir = path.join(__dirname, '../public/uploads');

function getUploadsDir() {
  const custom = process.env.UPLOAD_DIR || process.env.PERSISTENT_UPLOADS_DIR || process.env.UPLOADS_DIR;
  if (custom && custom.trim() !== '') {
    return path.resolve(custom.trim());
  }
  return defaultUploadsDir;
}

function getPrivateUploadsDir() {
  const custom = process.env.PRIVATE_UPLOADS_DIR;
  if (custom && custom.trim() !== '') {
    return path.resolve(custom.trim());
  }
  return path.join(getUploadsDir(), 'private_designs');
}

function getPreviewsDir() {
  const dir = path.join(getUploadsDir(), 'previews');
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  }
  return dir;
}

function getDesignsDir() {
  // Paid design files stored in private directory
  const dir = getPrivateUploadsDir();
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  }
  return dir;
}

function initStorage() {
  try {
    getPreviewsDir();
    getDesignsDir();
    // Also ensure fallback dirs exist
    const defaultPreviews = path.join(defaultUploadsDir, 'previews');
    const defaultDesigns = path.join(defaultUploadsDir, 'designs');
    if (!fs.existsSync(defaultPreviews)) {
      try { fs.mkdirSync(defaultPreviews, { recursive: true }); } catch (e) {}
    }
    if (!fs.existsSync(defaultDesigns)) {
      try { fs.mkdirSync(defaultDesigns, { recursive: true }); } catch (e) {}
    }
    console.log(`[Storage] Initialized persistent upload storage:`);
    console.log(`  - Uploads Base: ${getUploadsDir()}`);
    console.log(`  - Previews (Public): ${getPreviewsDir()}`);
    console.log(`  - Designs (Private): ${getDesignsDir()}`);
  } catch (err) {
    console.warn('[Storage] Directory initialization warning:', err.message);
  }
}

/**
 * Resolves a web path or filename (e.g. /public/uploads/previews/image-1.png or /uploads/designs/file.zip)
 * to an existing physical file on disk.
 * Prioritizes persistent storage locations outside the git deployment folder.
 */
function resolveFilePath(filePath, returnTargetIfMissing = false) {
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
  } else if (subpath.startsWith('private_uploads/')) {
    subpath = subpath.replace(/^private_uploads\//, '');
  }

  const baseName = path.basename(clean);

  // 1. Check in persistent private designs directory (for machine / ZIP files)
  const privateCandidate = path.join(getPrivateUploadsDir(), baseName);
  if (fs.existsSync(privateCandidate)) {
    return privateCandidate;
  }

  // 2. Check in persistent uploads directory
  const persistentCandidate = path.join(getUploadsDir(), subpath);
  if (fs.existsSync(persistentCandidate)) {
    return persistentCandidate;
  }

  // 3. Check in persistent previews directory
  const inPreviews = path.join(getPreviewsDir(), baseName);
  if (fs.existsSync(inPreviews)) {
    return inPreviews;
  }

  // 4. Check in persistent designs directory
  const inDesigns = path.join(getUploadsDir(), 'designs', baseName);
  if (fs.existsSync(inDesigns)) {
    return inDesigns;
  }

  // 5. Check in default repository uploads directory (fallback)
  const defaultCandidate = path.join(defaultUploadsDir, subpath);
  if (fs.existsSync(defaultCandidate)) {
    return defaultCandidate;
  }

  const inDefaultPreviews = path.join(defaultUploadsDir, 'previews', baseName);
  if (fs.existsSync(inDefaultPreviews)) return inDefaultPreviews;

  const inDefaultDesigns = path.join(defaultUploadsDir, 'designs', baseName);
  if (fs.existsSync(inDefaultDesigns)) return inDefaultDesigns;

  // 6. Check relative from project root
  const rootCandidate = path.join(__dirname, '..', clean);
  if (fs.existsSync(rootCandidate)) {
    return rootCandidate;
  }

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
 * Returns the public web URL path for an uploaded preview file.
 */
function getWebPath(filename, type = 'previews') {
  const base = path.basename(filename);
  return `/public/uploads/${type}/${base}`;
}

/**
 * Optional Cloud Storage Driver Support (Cloudinary for images, S3/R2 for design files)
 */
function getStorageDriver() {
  return (process.env.STORAGE_DRIVER || 'local').toLowerCase().trim();
}

/**
 * Optional Cloudinary Upload for Preview Images
 */
async function uploadToCloudinary(filePath, customPublicId = null) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    // Cloudinary credentials not configured; use local persistent storage
    return null;
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const paramsToSign = `timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash('sha1').update(paramsToSign).digest('hex');

    const fileBuffer = fs.readFileSync(filePath);
    const boundary = '----CloudinaryUploadBoundary' + Date.now();
    
    // Construct multipart/form-data
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="api_key"\r\n\r\n${apiKey}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="timestamp"\r\n\r\n${timestamp}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="signature"\r\n\r\n${signature}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="folder"\r\n\r\naruvi_embroidery/previews\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${path.basename(filePath)}"\r\nContent-Type: image/jpeg\r\n\r\n`
    ];

    const footer = `\r\n--${boundary}--\r\n`;
    const payload = Buffer.concat([
      Buffer.from(parts.join('')),
      fileBuffer,
      Buffer.from(footer)
    ]);

    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': payload.length.toString()
      },
      body: payload
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.secure_url) {
        console.log(`[Cloudinary Success] Uploaded to: ${data.secure_url}`);
        return data.secure_url;
      }
    } else {
      const errText = await res.text();
      console.warn('[Cloudinary Warning] Upload returned non-200:', errText);
    }
  } catch (cloudErr) {
    console.warn('[Cloudinary Error]:', cloudErr.message, '- falling back to persistent local disk');
  }

  return null;
}

/**
 * Optional S3 / Cloudflare R2 Upload for Paid Design Archives
 */
async function uploadToS3OrR2(filePath, destFilename = null) {
  const bucket = process.env.S3_BUCKET || process.env.R2_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.S3_ENDPOINT || process.env.R2_ENDPOINT;
  const region = process.env.S3_REGION || process.env.AWS_REGION || 'auto';

  if (!bucket || !accessKeyId || !secretAccessKey) {
    // S3/R2 credentials not provided; persistent local disk storage is used
    return null;
  }

  const fileName = destFilename || path.basename(filePath);
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const host = endpoint ? new URL(endpoint).host : `${bucket}.s3.${region}.amazonaws.com`;
    const canonicalUri = `/${bucket}/${fileName}`;
    const dateStr = new Date().toUTCString();

    // Standard HMAC authentication or REST PUT request
    const contentType = 'application/octet-stream';
    const stringToSign = `PUT\n\n${contentType}\n${dateStr}\n${canonicalUri}`;
    const signature = crypto.createHmac('sha1', secretAccessKey).update(stringToSign).digest('base64');
    const authHeader = `AWS ${accessKeyId}:${signature}`;

    const putUrl = endpoint ? `${endpoint.replace(/\/$/, '')}/${bucket}/${fileName}` : `https://${host}/${fileName}`;

    const res = await fetch(putUrl, {
      method: 'PUT',
      headers: {
        'Date': dateStr,
        'Authorization': authHeader,
        'Content-Type': contentType,
        'Content-Length': fileBuffer.length.toString()
      },
      body: fileBuffer
    });

    if (res.ok) {
      console.log(`[S3/R2 Success] Uploaded archive to ${putUrl}`);
      return putUrl;
    } else {
      const errText = await res.text();
      console.warn('[S3/R2 Warning] Upload returned status:', res.status, errText);
    }
  } catch (s3Err) {
    console.warn('[S3/R2 Error]:', s3Err.message, '- falling back to persistent local disk');
  }

  return null;
}

// Auto-initialize directories on startup
initStorage();

module.exports = {
  initStorage,
  getUploadsDir,
  getPrivateUploadsDir,
  getPreviewsDir,
  getDesignsDir,
  resolveFilePath,
  fileExists,
  getWebPath,
  defaultUploadsDir,
  getStorageDriver,
  uploadToCloudinary,
  uploadToS3OrR2
};
