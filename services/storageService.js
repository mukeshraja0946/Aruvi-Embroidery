const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

/**
 * Aruvi Embroidery — Universal Persistent Storage Service
 * Designed for Hostinger Business Plan (Node.js web app, user u101925264)
 * 
 * Storage Architecture:
 * - Local Persistent Disk: UPLOAD_DIR outside ephemeral git deploys (hbuilds/versions/<id>)
 *   Primary candidate:   /home/u101925264/aruvi-uploads
 *   Fallback candidate:  /home/u101925264/domains/aruviembroidery.com/aruvi-uploads
 * - Subfolders:
 *   - public/: Previews, thumbnails, card images, branding (logos/favicons), banners.
 *     Served with express.static, long cache + versioned query strings.
 *   - private/: Paid machine files (DST, PES, JEF, EXP, ZIP), pristine originals, custom-requests, backups.
 *     Strictly private, accessed only via authenticated customer/admin routes.
 * - Driver Options:
 *   - "local" (Default): Hostinger persistent filesystem.
 *   - "s3": Cloudflare R2 / AWS S3 / MinIO compatible object storage with private signed URLs.
 *   - "cloudinary": Direct preview image upload driver.
 * 
 * Deploy Safety Guarantees:
 * - Auto-detects writable persistent directories outside hbuilds.
 * - Startup Guard: If UPLOAD_DIR is inside the git repository or hbuilds/versions on production,
 *   logs a clear error, triggers admin dashboard warning banner, and blocks new uploads.
 * - Safe writes: Unique collision-free names, never overwrites; writes new file first.
 */

const projectRoot = path.resolve(__dirname, '..');
const defaultUploadsDir = path.join(projectRoot, 'public', 'uploads');

const BRAND_DEFAULTS = {
  logo: '/public/assets/brand/logo.png',
  mobile_logo: '/public/assets/brand/logo.png',
  favicon: '/public/assets/brand/favicon.ico',
  hero_image: '/public/assets/brand/hero_embroidery.jpg',
  preloader_custom: ''
};

const HOSTINGER_PERSISTENT_CANDIDATES = [
  '/home/u101925264/aruvi-uploads',
  '/home/u101925264/domains/aruviembroidery.com/aruvi-uploads'
];

/**
 * Checks if a target path is inside the project repository or ephemeral deploy directories
 */
function isPathInsideRepoOrHbuilds(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return true;
  const resolved = path.resolve(targetPath);
  const rel = path.relative(projectRoot, resolved);
  const isInsideProject = !rel.startsWith('..') && !path.isAbsolute(rel);

  const normalized = resolved.replace(/\\/g, '/').toLowerCase();
  const hasHbuilds = normalized.includes('/hbuilds/') || normalized.includes('/versions/');

  return isInsideProject || hasHbuilds;
}

/**
 * Tests write permission on a directory
 */
function testDirectoryWritable(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    const probe = path.join(dirPath, `.write_test_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
    fs.writeFileSync(probe, 'aruvi_write_test', 'utf8');
    fs.unlinkSync(probe);
    return true;
  } catch (_) {
    return false;
  }
}

let cachedFileCounts = {
  public: 0,
  private: 0,
  lastUpdated: 0
};

/**
 * Counts files inside a directory with caching and depth-limiting to avoid blocking the event loop
 */
function countFilesInDirectory(dirPath, maxDepth = 4, currentDepth = 0) {
  if (!dirPath || currentDepth > maxDepth || !fs.existsSync(dirPath)) return 0;
  let count = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        count += countFilesInDirectory(fullPath, maxDepth, currentDepth + 1);
      } else if (entry.isFile()) {
        count++;
      }
    }
  } catch (_) {}
  return count;
}

class StorageService {
  constructor() {
    this.s3Client = null;
    this.initS3Client();
    this._resolvedUploadsDir = null;
    this._detectionDetails = null;
    this._missingBrandAssets = new Set();
  }

  getDriver() {
    return (process.env.STORAGE_DRIVER || 'local').toLowerCase().trim();
  }

  getStorageDriver() {
    return this.getDriver();
  }

  initStorage() {
    return this.initStorageDirs();
  }

  resetLocationCache() {
    this._resolvedUploadsDir = null;
    this._detectionDetails = null;
  }

  /**
   * Resolves persistent upload directory outside ephemeral git deploys
   */
  resolveStorageLocation() {
    if (this._resolvedUploadsDir && this._detectionDetails) {
      return this._detectionDetails;
    }

    const envCustom = process.env.UPLOAD_DIR || process.env.PERSISTENT_UPLOADS_DIR || process.env.UPLOADS_DIR;

    // 1. Explicit environment variable configured in hPanel / .env
    if (envCustom && envCustom.trim() !== '') {
      const resolved = path.resolve(envCustom.trim());
      const insideRepo = isPathInsideRepoOrHbuilds(resolved);
      const isWritable = testDirectoryWritable(resolved);

      this._resolvedUploadsDir = resolved;
      this._detectionDetails = {
        path: resolved,
        source: 'env',
        isInsideRepo: insideRepo,
        isWritable,
        isSafe: !insideRepo && isWritable,
        candidateMatched: null
      };
      return this._detectionDetails;
    }

    // 2. Auto-detect Hostinger persistent folders outside hbuilds
    for (const candidate of HOSTINGER_PERSISTENT_CANDIDATES) {
      if (testDirectoryWritable(candidate)) {
        const resolved = path.resolve(candidate);
        this._resolvedUploadsDir = resolved;
        this._detectionDetails = {
          path: resolved,
          source: 'auto-detected',
          isInsideRepo: false,
          isWritable: true,
          isSafe: true,
          candidateMatched: candidate
        };
        return this._detectionDetails;
      }
    }

    // 3. Fallback to local default (inside project root)
    const fallbackDir = defaultUploadsDir;
    const isWritable = testDirectoryWritable(fallbackDir);
    this._resolvedUploadsDir = fallbackDir;
    this._detectionDetails = {
      path: fallbackDir,
      source: 'default',
      isInsideRepo: true,
      isWritable,
      isSafe: false,
      candidateMatched: null
    };
    return this._detectionDetails;
  }

  getUploadsDir() {
    return this.resolveStorageLocation().path;
  }

  getPublicDir() {
    const dir = path.join(this.getUploadsDir(), 'public');
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    }
    return dir;
  }

  getPrivateDir() {
    const custom = process.env.PRIVATE_UPLOADS_DIR;
    if (custom && custom.trim() !== '') {
      return path.resolve(custom.trim());
    }
    const dir = path.join(this.getUploadsDir(), 'private');
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    }
    return dir;
  }

  // Alias for backward compatibility
  getPrivateUploadsDir() {
    return this.getPrivateDir();
  }

  getPreviewsDir() {
    const dir = path.join(this.getPublicDir(), 'previews');
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    }
    return dir;
  }

  getCardsDir() {
    const dir = path.join(this.getPublicDir(), 'cards');
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    }
    return dir;
  }

  getThumbsDir() {
    const dir = path.join(this.getPublicDir(), 'thumbs');
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    }
    return dir;
  }

  getBrandingDir() {
    const dir = path.join(this.getPublicDir(), 'branding');
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    }
    return dir;
  }

  getBannersDir() {
    const dir = path.join(this.getPublicDir(), 'banners');
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    }
    return dir;
  }

  getCategoriesDir() {
    const dir = path.join(this.getPublicDir(), 'categories');
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    }
    return dir;
  }

  getDesignsDir() {
    const dir = path.join(this.getPrivateDir(), 'designs');
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    }
    return dir;
  }

  getOriginalsDir() {
    const dir = path.join(this.getPrivateDir(), 'originals');
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    }
    return dir;
  }

  getCustomRequestsDir() {
    const dir = path.join(this.getPrivateDir(), 'custom-requests');
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    }
    return dir;
  }

  getBackupsDir() {
    const custom = process.env.BACKUP_DIR || process.env.BACKUPS_DIR;
    if (custom && custom.trim() !== '') {
      return path.resolve(custom.trim());
    }
    const hostingerBackup = '/home/u101925264/aruvi-backups';
    if (testDirectoryWritable(hostingerBackup)) {
      return hostingerBackup;
    }
    const dir = path.join(this.getPrivateDir(), 'backups');
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    }
    return dir;
  }

  /**
   * Initializes all required storage subdirectories
   */
  initStorageDirs() {
    try {
      this.getPublicDir();
      this.getPrivateDir();
      this.getPreviewsDir();
      this.getCardsDir();
      this.getThumbsDir();
      this.getBrandingDir();
      this.getBannersDir();
      this.getCategoriesDir();
      this.getDesignsDir();
      this.getOriginalsDir();
      this.getCustomRequestsDir();
      this.getBackupsDir();

      // Legacy/fallback paths for compatibility
      const legacyPreviews = path.join(this.getUploadsDir(), 'previews');
      if (!fs.existsSync(legacyPreviews)) {
        try { fs.mkdirSync(legacyPreviews, { recursive: true }); } catch (_) {}
      }
    } catch (err) {
      console.warn('[StorageService] Directory initialization notice:', err.message);
    }
  }

  /**
   * Returns whether new uploads should be blocked on production due to insecure storage configuration
   */
  isUploadBlocked() {
    const isProduction = process.env.NODE_ENV === 'production';
    if (!isProduction) return false;
    const info = this.resolveStorageLocation();
    return !info.isSafe || info.isInsideRepo || !info.isWritable;
  }

  /**
   * Checks health and status of the storage subsystem
   */
  getStorageStatus(forceRefresh = false) {
    const info = this.resolveStorageLocation();
    const isProduction = process.env.NODE_ENV === 'production';
    const isBlocked = isProduction && (!info.isSafe || info.isInsideRepo || !info.isWritable);

    const now = Date.now();
    if (forceRefresh || (now - cachedFileCounts.lastUpdated > 10 * 60 * 1000)) {
      cachedFileCounts.lastUpdated = now;
      // Schedule directory scan asynchronously so server startup / listen is never blocked
      setImmediate(() => {
        try {
          cachedFileCounts.public = countFilesInDirectory(this.getPublicDir()) + countFilesInDirectory(path.join(info.path, 'previews'));
          cachedFileCounts.private = countFilesInDirectory(this.getPrivateDir()) + countFilesInDirectory(path.join(projectRoot, 'storage_private'));
        } catch (_) {}
      });
    }

    const publicFilesCount = cachedFileCounts.public;
    const privateFilesCount = cachedFileCounts.private;

    let warningMessage = null;
    if (info.isInsideRepo) {
      warningMessage = 'UPLOAD_DIR must point to a folder OUTSIDE the deploy folder, e.g. /home/u101925264/aruvi-uploads. Set it in hPanel -> Node.js app -> Environment variables and restart.';
    } else if (!info.isWritable) {
      warningMessage = `UPLOAD_DIR (${info.path}) is not writable by current user. Check folder permissions in Hostinger SSH/File Manager.`;
    }

    return {
      driver: this.getDriver(),
      uploadsDir: info.path,
      source: info.source,
      candidateMatched: info.candidateMatched,
      isInsideRepo: info.isInsideRepo,
      isWritable: info.isWritable,
      isSafe: info.isSafe,
      isBlocked,
      publicFilesCount,
      privateFilesCount,
      warningMessage,
      missingBrandAssets: Array.from(this._missingBrandAssets)
    };
  }

  /**
   * Validates storage configuration on server boot and logs clear guidance.
   */
  validateStorageConfiguration() {
    const driver = this.getDriver();
    const status = this.getStorageStatus();

    console.log('====================================================');
    console.log(`📦 Storage Driver: ${driver.toUpperCase()}`);

    if (driver === 's3') {
      const bucket = process.env.S3_BUCKET || process.env.R2_BUCKET;
      const endpoint = process.env.S3_ENDPOINT || process.env.R2_ENDPOINT;
      console.log(`   - Provider: Cloudflare R2 / AWS S3 Compatible`);
      console.log(`   - Bucket: ${bucket || 'NOT CONFIGURED'}`);
      console.log(`   - Endpoint: ${endpoint || 'Default AWS S3'}`);
      if (!bucket || !process.env.S3_ACCESS_KEY_ID) {
        console.warn('   ⚠️ [STORAGE WARNING]: S3 credentials incomplete. Local storage will act as fallback.');
      }
    } else if (driver === 'cloudinary') {
      console.log(`   - Cloudinary Cloud: ${process.env.CLOUDINARY_CLOUD_NAME || 'NOT CONFIGURED'}`);
    } else {
      console.log(`   - Persistent Disk: ${status.uploadsDir}`);
      console.log(`   - Writable: ${status.isWritable ? 'YES' : 'NO'}`);
      console.log(`   - Auto-detected: ${status.candidateMatched ? `YES (${status.candidateMatched})` : 'NO'}`);
      console.log(`   - Public Files: ${status.publicFilesCount} (previews, thumbs, branding, banners)`);
      console.log(`   - Private Files: ${status.privateFilesCount} (machine archives, originals, backups)`);

      if (status.isInsideRepo) {
        console.error('====================================================');
        console.error('❌ [STORAGE ERROR]: UPLOAD_DIR is located INSIDE the deploy folder!');
        console.error(`   Current path: ${status.uploadsDir}`);
        console.error('   Hostinger creates a NEW hbuilds/versions/<id> folder on every git push / redeploy,');
        console.error('   which causes all uploads written inside the deploy folder to disappear.');
        console.error('   FIX: UPLOAD_DIR must point to a folder OUTSIDE the deploy folder,');
        console.error('        e.g. /home/u101925264/aruvi-uploads');
        console.error('        Set it in hPanel -> Node.js app -> Environment variables and restart.');
        if (status.isBlocked) {
          console.error('   [SECURITY GUARD]: NEW UPLOADS ARE CURRENTLY BLOCKED UNTIL SAFE STORAGE IS CONFIGURED.');
          console.error('   (Existing files remain fully readable).');
        }
        console.error('====================================================');
      } else {
        console.log(`   ✓ Persistent volume confirmed outside deploy folder: ${status.uploadsDir}`);
      }
    }
    console.log('====================================================');

    return status;
  }

  /**
   * Initializes AWS S3 / Cloudflare R2 client
   */
  initS3Client() {
    const bucket = process.env.S3_BUCKET || process.env.R2_BUCKET;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY;
    const endpoint = process.env.S3_ENDPOINT || process.env.R2_ENDPOINT;
    const region = process.env.S3_REGION || process.env.AWS_REGION || 'auto';

    if (accessKeyId && secretAccessKey) {
      try {
        const config = {
          region,
          credentials: {
            accessKeyId,
            secretAccessKey
          }
        };

        if (endpoint) {
          config.endpoint = endpoint;
          config.forcePathStyle = true;
        }

        this.s3Client = new S3Client(config);
      } catch (err) {
        console.warn('[StorageService] S3 Client initialization notice:', err.message);
        this.s3Client = null;
      }
    }
  }

  /**
   * Generates a collision-free unique filename
   */
  generateUniqueFilename(originalName, prefix = 'file') {
    const ext = path.extname(originalName || '').toLowerCase();
    const randomHex = crypto.randomBytes(8).toString('hex');
    return `${prefix}-${Date.now()}-${randomHex}${ext || ''}`;
  }

  /**
   * Generates a fast 300px WebP thumbnail using sharp.
   */
  async generateThumbnail(sourcePathOrBuffer, filename) {
    try {
      const { getSharp } = require('../utils/sharpHelper');
      const sharp = getSharp();
      if (!sharp) return null;
      const baseNameWithoutExt = path.basename(filename, path.extname(filename));
      const thumbFilename = `${baseNameWithoutExt}.webp`;
      const thumbDestPath = path.join(this.getThumbsDir(), thumbFilename);

      let imagePipeline;
      if (Buffer.isBuffer(sourcePathOrBuffer)) {
        imagePipeline = sharp(sourcePathOrBuffer);
      } else if (typeof sourcePathOrBuffer === 'string' && fs.existsSync(sourcePathOrBuffer)) {
        imagePipeline = sharp(sourcePathOrBuffer);
      } else {
        return null;
      }

      await imagePipeline
        .rotate()
        .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toFile(thumbDestPath);

      return `/public/uploads/previews/thumbs/${thumbFilename}`;
    } catch (err) {
      console.warn('[Thumbnail Generation Notice]:', err.message);
      return null;
    }
  }

  /**
   * Saves a PUBLIC preview image, banner, logo, or category image.
   * Never overwrites existing files; writes new file first.
   */
  async savePublicFile(filePathOrBuffer, originalName, mimeType = null, subFolder = 'previews') {
    if (this.isUploadBlocked()) {
      console.warn('[Storage Notice]: UPLOAD_DIR is located inside deploy folder or unconfigured. Proceeding with public fallback storage.');
    }

    const driver = this.getDriver();
    const ext = path.extname(originalName || '').toLowerCase();
    const prefix = subFolder === 'branding' ? 'brand' : (subFolder === 'banners' ? 'banner' : (subFolder === 'categories' ? 'cat' : 'preview'));
    const uniqueFilename = this.generateUniqueFilename(originalName, prefix);

    // 1. Cloudinary driver
    if (driver === 'cloudinary' && process.env.CLOUDINARY_CLOUD_NAME) {
      try {
        const cloudUrl = await this.uploadToCloudinary(filePathOrBuffer, uniqueFilename);
        if (cloudUrl) return cloudUrl;
      } catch (e) {
        console.warn('[Cloudinary Fallback]:', e.message);
      }
    }

    // 2. S3 / R2 driver
    if (driver === 's3' && this.s3Client) {
      try {
        const bucket = process.env.S3_BUCKET || process.env.R2_BUCKET;
        const key = `${subFolder}/${uniqueFilename}`;
        const fileBuffer = Buffer.isBuffer(filePathOrBuffer) ? filePathOrBuffer : fs.readFileSync(filePathOrBuffer);

        await this.s3Client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: fileBuffer,
          ContentType: mimeType || this.getMimeType(ext),
          ACL: 'public-read'
        }));

        if (process.env.S3_PUBLIC_DOMAIN) {
          return `${process.env.S3_PUBLIC_DOMAIN.replace(/\/$/, '')}/${key}`;
        }
        if (process.env.S3_ENDPOINT) {
          return `${process.env.S3_ENDPOINT.replace(/\/$/, '')}/${bucket}/${key}`;
        }
        return `https://${bucket}.s3.amazonaws.com/${key}`;
      } catch (s3Err) {
        console.warn('[S3 Public Upload Fallback]:', s3Err.message);
      }
    }

    // 3. Local persistent storage
    let targetDir;
    if (subFolder === 'branding') {
      targetDir = this.getBrandingDir();
    } else if (subFolder === 'banners') {
      targetDir = this.getBannersDir();
    } else if (subFolder === 'categories') {
      targetDir = this.getCategoriesDir();
    } else {
      targetDir = this.getPreviewsDir();
    }

    const destPath = path.join(targetDir, uniqueFilename);
    const tempDest = `${destPath}.tmp_${Date.now()}`;

    // Write new file first to temp, then atomically rename
    if (Buffer.isBuffer(filePathOrBuffer)) {
      fs.writeFileSync(tempDest, filePathOrBuffer);
    } else {
      fs.copyFileSync(filePathOrBuffer, tempDest);
    }
    fs.renameSync(tempDest, destPath);

    // Also mirror into legacy previews folder if custom subFolder is previews
    if (subFolder === 'previews') {
      const legacyPath = path.join(this.getUploadsDir(), 'previews', uniqueFilename);
      if (legacyPath !== destPath && !fs.existsSync(legacyPath)) {
        try { fs.copyFileSync(destPath, legacyPath); } catch (_) {}
      }
    }

    // Generate 300px WebP thumbnail for preview images
    if (subFolder === 'previews' && ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.jfif', '.bmp'].includes(ext)) {
      await this.generateThumbnail(destPath, uniqueFilename);
    }

    // Generate 400x500 card & 150x150 thumbnail WebP for category images
    if (subFolder === 'categories' && ['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      try {
        const { getSharp } = require('../utils/sharpHelper');
        const sharp = getSharp();
        if (sharp) {
          const baseName = path.basename(uniqueFilename, ext);
          const cardPath = path.join(targetDir, `${baseName}_card.webp`);
          const thumbPath = path.join(targetDir, `${baseName}_thumb.webp`);
          await sharp(destPath).rotate().resize(400, 500, { fit: 'cover' }).webp({ quality: 85 }).toFile(cardPath);
          await sharp(destPath).rotate().resize(150, 150, { fit: 'cover' }).webp({ quality: 85 }).toFile(thumbPath);
        }
      } catch (catThumbErr) {
        console.warn('[Category thumbnail notice]:', catThumbErr.message);
      }
    }

    return `/public/uploads/${subFolder}/${uniqueFilename}`;
  }

  /**
   * Safely retires an old uploaded file after database transaction commit
   */
  retireFile(fileUrl) {
    if (!fileUrl || typeof fileUrl !== 'string') return;
    try {
      if (fileUrl.startsWith('/public/uploads/')) {
        const rel = fileUrl.replace(/^\/public\/uploads\//, '');
        const resolved = path.join(this.getPublicDir(), rel);
        if (fs.existsSync(resolved)) {
          fs.unlinkSync(resolved);
        }
      }
    } catch (_) {}
  }

  /**
   * Saves a dedicated branding asset (logo, favicon, preloader image) into UPLOAD_DIR/public/branding/
   */
  async saveBrandingFile(filePathOrBuffer, originalName, mimeType = null) {
    return this.savePublicFile(filePathOrBuffer, originalName, mimeType, 'branding');
  }

  /**
   * Saves a custom order reference image into UPLOAD_DIR/private/custom-requests/
   */
  async saveCustomRequestFile(filePathOrBuffer, originalName, mimeType = null) {
    if (this.isUploadBlocked()) {
      throw new Error('Uploads are currently disabled: UPLOAD_DIR is located inside the deploy folder. UPLOAD_DIR must point to a folder OUTSIDE the deploy folder, e.g. /home/u101925264/aruvi-uploads. Set it in hPanel -> Node.js app -> Environment variables and restart.');
    }

    const ext = path.extname(originalName || '').toLowerCase() || '.jpg';
    const randomHex = crypto.randomBytes(6).toString('hex');
    const uniqueFilename = `cr-${Date.now()}-${randomHex}${ext}`;
    const destPath = path.join(this.getCustomRequestsDir(), uniqueFilename);

    if (Buffer.isBuffer(filePathOrBuffer)) {
      fs.writeFileSync(destPath, filePathOrBuffer);
    } else {
      fs.copyFileSync(filePathOrBuffer, destPath);
    }

    return `custom-requests/${uniqueFilename}`;
  }

  /**
   * Builds the canonical browser-loadable public URL from any relative key, path, or remote URL.
   */
  buildPublicUrl(keyOrPath) {
    if (!keyOrPath || typeof keyOrPath !== 'string') return null;
    const clean = keyOrPath.trim();
    if (!clean) return null;

    if (clean.startsWith('http://') || clean.startsWith('https://')) {
      return clean;
    }

    const normalized = clean.replace(/\\/g, '/');

    if (normalized.startsWith('/public/uploads/')) {
      return normalized;
    }
    if (normalized.startsWith('public/uploads/')) {
      return '/' + normalized;
    }
    if (normalized.startsWith('/uploads/')) {
      return '/public' + normalized;
    }
    if (normalized.startsWith('uploads/')) {
      return '/public/' + normalized;
    }

    if (normalized.startsWith('branding/') || normalized.startsWith('/branding/')) {
      return `/public/uploads/branding/${path.basename(normalized)}`;
    }
    if (normalized.startsWith('banners/') || normalized.startsWith('/banners/')) {
      return `/public/uploads/banners/${path.basename(normalized)}`;
    }
    if (normalized.startsWith('previews/cards/') || normalized.startsWith('/previews/cards/')) {
      return `/public/uploads/previews/cards/${path.basename(normalized)}`;
    }
    if (normalized.startsWith('previews/thumbs/') || normalized.startsWith('/previews/thumbs/')) {
      return `/public/uploads/previews/thumbs/${path.basename(normalized)}`;
    }
    if (normalized.startsWith('previews/') || normalized.startsWith('/previews/')) {
      return `/public/uploads/previews/${path.basename(normalized)}`;
    }

    return `/public/uploads/previews/${path.basename(normalized)}`;
  }

  /**
   * Returns a 300px WebP thumbnail URL if available, otherwise falls back to canonical public URL.
   */
  buildThumbnailUrl(keyOrPath) {
    if (!keyOrPath || typeof keyOrPath !== 'string') return null;
    const clean = keyOrPath.trim();
    if (!clean) return null;

    if (clean.startsWith('http://') || clean.startsWith('https://')) {
      return clean;
    }

    const baseNameWithoutExt = path.basename(clean, path.extname(clean));
    const thumbFilename = `${baseNameWithoutExt}.webp`;
    const localThumbPath = path.join(this.getThumbsDir(), thumbFilename);

    if (fs.existsSync(localThumbPath)) {
      return `/public/uploads/previews/thumbs/${thumbFilename}`;
    }

    return this.buildPublicUrl(clean);
  }

  /**
   * Saves a PRIVATE paid design file (DST, PES, JEF, EXP, ZIP).
   * Stored in UPLOAD_DIR/private/designs/<subFolder>/
   * Returns storage key (relative path).
   */
  async savePrivateFile(filePathOrBuffer, originalName, mimeType = 'application/octet-stream', designId = null) {
    if (this.isUploadBlocked()) {
      throw new Error('Uploads are currently disabled: UPLOAD_DIR is located inside the deploy folder. UPLOAD_DIR must point to a folder OUTSIDE the deploy folder, e.g. /home/u101925264/aruvi-uploads. Set it in hPanel -> Node.js app -> Environment variables and restart.');
    }

    const driver = this.getDriver();
    const cleanOrig = path.basename(originalName || 'design.zip').replace(/[/\\?%*:|"<>]/g, '_').trim();
    const ext = path.extname(cleanOrig).toLowerCase() || '.zip';
    const baseName = (cleanOrig.slice(0, -ext.length) || 'design').trim();
    const uniqueFilename = `${baseName}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
    const subFolder = designId ? String(designId) : 'general';
    const relativeKey = `design-files/${subFolder}/${uniqueFilename}`;

    // 1. S3 / R2 driver for private design archives
    if (driver === 's3' && this.s3Client) {
      try {
        const bucket = process.env.S3_BUCKET || process.env.R2_BUCKET;
        const key = `private_designs/${relativeKey}`;
        const fileBuffer = Buffer.isBuffer(filePathOrBuffer) ? filePathOrBuffer : fs.readFileSync(filePathOrBuffer);

        await this.s3Client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: fileBuffer,
          ContentType: mimeType,
          ACL: 'private'
        }));

        return `s3://${bucket}/${key}`;
      } catch (s3Err) {
        console.warn('[S3 Private Upload Fallback]:', s3Err.message);
      }
    }

    // 2. Local private storage strictly outside public web root
    const targetFolder = path.join(this.getDesignsDir(), subFolder);
    if (!fs.existsSync(targetFolder)) {
      try { fs.mkdirSync(targetFolder, { recursive: true }); } catch (_) {}
    }

    const destPath = path.join(targetFolder, uniqueFilename);
    const tempDest = `${destPath}.tmp_${Date.now()}`;

    if (Buffer.isBuffer(filePathOrBuffer)) {
      fs.writeFileSync(tempDest, filePathOrBuffer);
    } else {
      fs.copyFileSync(filePathOrBuffer, tempDest);
    }
    fs.renameSync(tempDest, destPath);

    return relativeKey;
  }

  /**
   * Saves an ORIGINAL file byte-for-byte in private storage (UPLOAD_DIR/private/originals/).
   * Never resized, recompressed, converted, metadata-stripped or re-zipped.
   * Calculates SHA-256 checksum and exact size.
   */
  async saveOriginalFile(filePathOrBuffer, originalName, mimeType = null) {
    if (this.isUploadBlocked()) {
      throw new Error('Uploads are currently disabled: UPLOAD_DIR is located inside the deploy folder.');
    }

    const cleanOrig = path.basename(originalName || 'original_file').replace(/[/\\?%*:|"<>]/g, '_').trim();
    const ext = path.extname(cleanOrig).toLowerCase();
    const baseName = (cleanOrig.slice(0, -ext.length) || 'file').trim();
    const uniqueFilename = `${baseName}_orig_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;

    const targetDir = this.getOriginalsDir();
    const destPath = path.join(targetDir, uniqueFilename);
    const tempDest = `${destPath}.tmp_${Date.now()}`;

    let size = 0;
    let sha256 = null;

    if (Buffer.isBuffer(filePathOrBuffer)) {
      size = filePathOrBuffer.length;
      sha256 = crypto.createHash('sha256').update(filePathOrBuffer).digest('hex');
      fs.writeFileSync(tempDest, filePathOrBuffer);
    } else {
      const stat = fs.statSync(filePathOrBuffer);
      size = stat.size;
      const fileBuf = fs.readFileSync(filePathOrBuffer);
      sha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');
      fs.copyFileSync(filePathOrBuffer, tempDest);
    }
    fs.renameSync(tempDest, destPath);

    return {
      storage_key: `originals/${uniqueFilename}`,
      full_path: destPath,
      original_name: cleanOrig,
      original_size: size,
      mime_type: mimeType || this.getMimeType(ext),
      checksum: sha256
    };
  }

  /**
   * Generates a signed temporary download URL for paid design files.
   */
  async getSignedDownloadUrl(storageKeyOrPath, expiresInSeconds = 3600) {
    if (!storageKeyOrPath) return null;

    if (String(storageKeyOrPath).startsWith('s3://') && this.s3Client) {
      try {
        const parsed = storageKeyOrPath.replace('s3://', '');
        const bucket = parsed.split('/')[0];
        const key = parsed.substring(bucket.length + 1);

        const command = new GetObjectCommand({
          Bucket: bucket,
          Key: key
        });

        return await getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
      } catch (err) {
        console.error('[StorageService.getSignedDownloadUrl error]:', err.message);
      }
    }

    return null;
  }

  /**
   * Asynchronously checks whether a file physically exists in persistent storage or remote storage.
   */
  async fileExistsAsync(filePathOrUrl) {
    if (!filePathOrUrl || typeof filePathOrUrl !== 'string' || !filePathOrUrl.trim()) return false;

    if (filePathOrUrl.startsWith('http://') || filePathOrUrl.startsWith('https://')) {
      return true;
    }

    if (filePathOrUrl.startsWith('s3://')) {
      return Boolean(this.s3Client);
    }

    try {
      const resolved = this.resolveFilePath(filePathOrUrl, false);
      if (!resolved) return false;
      await fs.promises.access(resolved, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  fileExists(filePathOrUrl) {
    if (!filePathOrUrl || typeof filePathOrUrl !== 'string' || !filePathOrUrl.trim()) return false;

    if (filePathOrUrl.startsWith('http://') || filePathOrUrl.startsWith('https://')) {
      return true;
    }

    if (filePathOrUrl.startsWith('s3://')) {
      return Boolean(this.s3Client);
    }

    try {
      const resolved = this.resolveFilePath(filePathOrUrl, false);
      return Boolean(resolved && fs.existsSync(resolved));
    } catch {
      return false;
    }
  }

  /**
   * Resolves a web path or key to a physical file on disk.
   */
  resolveFilePath(filePath, returnTargetIfMissing = false) {
    if (!filePath || typeof filePath !== 'string') return null;

    let clean = filePath.trim();
    try {
      clean = decodeURIComponent(clean);
    } catch (_) {}

    if (path.isAbsolute(clean) && fs.existsSync(clean)) {
      return clean;
    }

    clean = clean.replace(/\\/g, '/').replace(/^\/+/, '');
    const baseName = path.basename(clean);

    // 1. Direct checks inside UPLOAD_DIR
    const uploadsDir = this.getUploadsDir();

    // 1a. Inside UPLOAD_DIR/public
    const inPublic = path.join(this.getPublicDir(), clean.replace(/^public\/uploads\//, '').replace(/^uploads\//, ''));
    if (fs.existsSync(inPublic)) return inPublic;

    // 1b. Inside UPLOAD_DIR/private
    const inPrivate = path.join(this.getPrivateDir(), clean.replace(/^(storage_private|private)\//, ''));
    if (fs.existsSync(inPrivate)) return inPrivate;

    // 1c. Direct path inside uploadsDir
    const directUploads = path.join(uploadsDir, clean);
    if (fs.existsSync(directUploads)) return directUploads;

    // 1d. Subfolder specific checks
    const inPreviews = path.join(this.getPreviewsDir(), baseName);
    if (fs.existsSync(inPreviews)) return inPreviews;

    const inCards = path.join(this.getCardsDir(), baseName);
    if (fs.existsSync(inCards)) return inCards;

    const inThumbs = path.join(this.getThumbsDir(), baseName);
    if (fs.existsSync(inThumbs)) return inThumbs;

    const inBranding = path.join(this.getBrandingDir(), baseName);
    if (fs.existsSync(inBranding)) return inBranding;

    const inBanners = path.join(this.getBannersDir(), baseName);
    if (fs.existsSync(inBanners)) return inBanners;

    const inDesigns = path.join(this.getDesignsDir(), baseName);
    if (fs.existsSync(inDesigns)) return inDesigns;

    const inOriginals = path.join(this.getOriginalsDir(), baseName);
    if (fs.existsSync(inOriginals)) return inOriginals;

    const inCustomRequests = path.join(this.getCustomRequestsDir(), baseName);
    if (fs.existsSync(inCustomRequests)) return inCustomRequests;

    // Check design subfolders (e.g. design-files/12/name.zip or designs/12/name.zip)
    const matchDesignFolder = clean.match(/(?:design-files|designs)\/([^/]+)\/(.+)$/);
    if (matchDesignFolder) {
      const p1 = path.join(this.getDesignsDir(), matchDesignFolder[1], matchDesignFolder[2]);
      if (fs.existsSync(p1)) return p1;
      const p2 = path.join(this.getPrivateDir(), 'design-files', matchDesignFolder[1], matchDesignFolder[2]);
      if (fs.existsSync(p2)) return p2;
    }

    // 2. Direct path check inside projectRoot (fallbacks)
    const rootDirect = path.join(projectRoot, clean);
    if (fs.existsSync(rootDirect)) return rootDirect;

    const publicDirect = path.join(projectRoot, 'public', clean.replace(/^public\//, ''));
    if (fs.existsSync(publicDirect)) return publicDirect;

    const inDefaultPreviews = path.join(defaultUploadsDir, 'previews', baseName);
    if (fs.existsSync(inDefaultPreviews)) return inDefaultPreviews;

    const inDefaultThumbs = path.join(defaultUploadsDir, 'previews', 'thumbs', baseName);
    if (fs.existsSync(inDefaultThumbs)) return inDefaultThumbs;

    const inDefaultDesigns = path.join(defaultUploadsDir, 'designs', baseName);
    if (fs.existsSync(inDefaultDesigns)) return inDefaultDesigns;

    const inPrivateStorage = path.join(projectRoot, 'storage_private', clean.replace(/^storage_private\//, ''));
    if (fs.existsSync(inPrivateStorage)) return inPrivateStorage;

    // 3. Check in brand assets folder
    if (clean.includes('brand') || clean.includes('assets')) {
      const inBrand = path.join(projectRoot, 'public', 'assets', 'brand', baseName);
      if (fs.existsSync(inBrand)) return inBrand;
    }

    return returnTargetIfMissing ? path.join(this.getPreviewsDir(), baseName) : null;
  }

  /**
   * Safely resolves a Brand Asset (logo, favicon, hero_image, banner).
   * If the custom asset is missing on disk or invalid, returns the committed brand asset.
   * NEVER SHOWS A BROKEN IMAGE.
   */
  resolveBrandAsset(type, candidateUrl) {
    const defaultAsset = BRAND_DEFAULTS[type] || '/public/assets/brand/logo.png';

    if (!candidateUrl || typeof candidateUrl !== 'string' || candidateUrl.trim() === '') {
      return defaultAsset;
    }

    const clean = candidateUrl.trim();

    if (clean.startsWith('http://') || clean.startsWith('https://')) {
      return clean;
    }

    // Check if candidate file actually exists on disk
    if (this.fileExists(clean)) {
      return clean.startsWith('/') ? clean : '/' + clean;
    }

    // Check branding subfolder in persistent storage
    const baseName = path.basename(clean);
    const inBranding = path.join(this.getBrandingDir(), baseName);
    if (fs.existsSync(inBranding)) {
      return `/public/uploads/branding/${baseName}`;
    }

    const inPreviews = path.join(this.getPreviewsDir(), baseName);
    if (fs.existsSync(inPreviews)) {
      return `/public/uploads/previews/${baseName}`;
    }

    // Candidate file is missing on disk; record notice and fall back safely to committed brand asset
    this._missingBrandAssets.add(`${type}: ${candidateUrl}`);
    return defaultAsset;
  }

  /**
   * Cloudinary direct upload helper
   */
  async uploadToCloudinary(filePathOrBuffer, publicId = null) {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) return null;

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const paramsToSign = `timestamp=${timestamp}${apiSecret}`;
      const signature = crypto.createHash('sha1').update(paramsToSign).digest('hex');

      const fileBuffer = Buffer.isBuffer(filePathOrBuffer) ? filePathOrBuffer : fs.readFileSync(filePathOrBuffer);
      const boundary = '----CloudinaryUploadBoundary' + Date.now();
      const parts = [
        `--${boundary}\r\nContent-Disposition: form-data; name="api_key"\r\n\r\n${apiKey}\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="timestamp"\r\n\r\n${timestamp}\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="signature"\r\n\r\n${signature}\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="folder"\r\n\r\naruvi_embroidery/previews\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${publicId || 'image.jpg'}"\r\nContent-Type: image/jpeg\r\n\r\n`
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
        return data.secure_url || null;
      }
    } catch (e) {
      console.warn('[Cloudinary Upload Notice]:', e.message);
    }
    return null;
  }

  getMimeType(ext) {
    const map = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.zip': 'application/zip',
      '.dst': 'application/octet-stream',
      '.pes': 'application/octet-stream',
      '.jef': 'application/octet-stream',
      '.exp': 'application/octet-stream'
    };
    return map[ext] || 'application/octet-stream';
  }

  isPathInsideRepoOrHbuilds(targetPath) {
    return isPathInsideRepoOrHbuilds(targetPath);
  }
}

const storageService = new StorageService();
storageService.initStorageDirs();
storageService.isPathInsideRepoOrHbuilds = isPathInsideRepoOrHbuilds;

module.exports = storageService;
