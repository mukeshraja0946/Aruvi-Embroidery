const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

/**
 * Aruvi Embroidery — Universal Persistent Storage Service
 * 
 * Supports:
 * 1. "local": Persistent volume/directory OUTSIDE the git code repo (e.g. UPLOAD_DIR=/var/data/aruvi-uploads).
 * 2. "s3": Cloudflare R2 / AWS S3 / MinIO compatible object storage with private signed URLs for paid files.
 * 3. "cloudinary": Direct preview image upload driver.
 * 
 * Architectural Guarantees:
 * - Public preview images, banners, logo, favicon: publicly accessible.
 * - Paid machine files (DST, PES, JEF, EXP, ZIP): strictly private, downloaded only via authenticated signed links.
 * - Brand assets: fallback to committed /public/assets/brand/ files if user-uploaded asset is missing.
 * - Deploy Safety: Startup check warns if UPLOAD_DIR is located inside the project repository.
 */

const projectRoot = path.resolve(__dirname, '..');
const defaultUploadsDir = path.join(projectRoot, 'public', 'uploads');

const BRAND_DEFAULTS = {
  logo: '/public/assets/brand/logo.png',
  mobile_logo: '/public/assets/brand/logo.png',
  favicon: '/public/assets/brand/favicon.ico',
  hero_image: '/public/assets/brand/hero_embroidery.jpg'
};

class StorageService {
  constructor() {
    this.s3Client = null;
    this.initS3Client();
  }

  getDriver() {
    return (process.env.STORAGE_DRIVER || 'local').toLowerCase().trim();
  }

  getUploadsDir() {
    const custom = process.env.UPLOAD_DIR || process.env.PERSISTENT_UPLOADS_DIR || process.env.UPLOADS_DIR;
    if (custom && custom.trim() !== '') {
      return path.resolve(custom.trim());
    }
    return defaultUploadsDir;
  }

  getPrivateUploadsDir() {
    const custom = process.env.PRIVATE_UPLOADS_DIR;
    if (custom && custom.trim() !== '') {
      return path.resolve(custom.trim());
    }
    // Strictly outside public web root and not served by express.static
    const dir = path.join(projectRoot, 'storage_private');
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    }
    return dir;
  }

  getPreviewsDir() {
    const dir = path.join(this.getUploadsDir(), 'previews');
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    }
    return dir;
  }

  getCardsDir() {
    const dir = path.join(this.getPreviewsDir(), 'cards');
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    }
    return dir;
  }

  getThumbsDir() {
    const dir = path.join(this.getPreviewsDir(), 'thumbs');
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    }
    return dir;
  }

  getDesignsDir() {
    const dir = this.getPrivateUploadsDir();
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    }
    return dir;
  }

  getOriginalsDir() {
    const dir = path.join(this.getUploadsDir(), 'private', 'originals');
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    }
    return dir;
  }

  initStorageDirs() {
    try {
      this.getPreviewsDir();
      this.getCardsDir();
      this.getThumbsDir();
      this.getDesignsDir();
      this.getOriginalsDir();
      
      // Fallback local dirs inside project root
      const defaultPreviews = path.join(defaultUploadsDir, 'previews');
      const defaultCards = path.join(defaultPreviews, 'cards');
      const defaultThumbs = path.join(defaultPreviews, 'thumbs');
      const defaultDesigns = path.join(defaultUploadsDir, 'designs');
      if (!fs.existsSync(defaultPreviews)) {
        try { fs.mkdirSync(defaultPreviews, { recursive: true }); } catch (e) {}
      }
      if (!fs.existsSync(defaultCards)) {
        try { fs.mkdirSync(defaultCards, { recursive: true }); } catch (e) {}
      }
      if (!fs.existsSync(defaultThumbs)) {
        try { fs.mkdirSync(defaultThumbs, { recursive: true }); } catch (e) {}
      }
      if (!fs.existsSync(defaultDesigns)) {
        try { fs.mkdirSync(defaultDesigns, { recursive: true }); } catch (e) {}
      }
    } catch (err) {
      console.warn('[StorageService] Directory initialization warning:', err.message);
    }
  }

  /**
   * Validates storage configuration on server boot and logs clear guidance.
   */
  validateStorageConfiguration() {
    const driver = this.getDriver();
    const uploadsDir = this.getUploadsDir();
    const relativeToRoot = path.relative(projectRoot, uploadsDir);
    const isInsideProject = !relativeToRoot.startsWith('..') && !path.isAbsolute(relativeToRoot);

    console.log('====================================================');
    console.log(`📦 Storage Driver: ${driver.toUpperCase()}`);

    if (driver === 's3') {
      const bucket = process.env.S3_BUCKET || process.env.R2_BUCKET;
      const endpoint = process.env.S3_ENDPOINT || process.env.R2_ENDPOINT;
      console.log(`   - Provider: Cloudflare R2 / AWS S3 Compatible`);
      console.log(`   - Bucket: ${bucket || 'NOT CONFIGURED'}`);
      console.log(`   - Endpoint: ${endpoint || 'Default AWS S3'}`);
      if (!bucket || !process.env.S3_ACCESS_KEY_ID) {
        console.warn('   ⚠️ [WARNING]: S3 credentials incomplete. Local storage will act as fallback.');
      }
    } else if (driver === 'cloudinary') {
      console.log(`   - Cloudinary Cloud: ${process.env.CLOUDINARY_CLOUD_NAME || 'NOT CONFIGURED'}`);
    } else {
      console.log(`   - Persistent Disk: ${uploadsDir}`);
      if (isInsideProject) {
        console.warn('   ⚠️ [STORAGE WARNING]: UPLOAD_DIR is located INSIDE the project repository!');
        console.warn('      On ephemeral deploy platforms (Render, Railway, Heroku), all files uploaded here');
        console.warn('      will be lost on every git push or redeploy.');
        console.warn('      FIX: Mount a persistent disk and set UPLOAD_DIR=/var/data/aruvi-uploads in .env');
        console.warn('           or switch to STORAGE_DRIVER=s3 (Cloudflare R2 / AWS S3).');
      } else {
        console.log(`   ✓ Persistent volume confirmed outside git repository: ${uploadsDir}`);
      }
    }
    console.log('====================================================');
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
          config.forcePathStyle = true; // Required for Cloudflare R2 & MinIO
        }

        this.s3Client = new S3Client(config);
      } catch (err) {
        console.warn('[StorageService] S3 Client initialization error:', err.message);
        this.s3Client = null;
      }
    }
  }

  /**
   * Generates a collision-free unique filename
   */
  generateUniqueFilename(originalName, prefix = 'file') {
    const ext = path.extname(originalName).toLowerCase();
    const randomHex = crypto.randomBytes(8).toString('hex');
    return `${prefix}-${Date.now()}-${randomHex}${ext || ''}`;
  }

  /**
   * Generates a fast 300px WebP thumbnail using sharp.
   */
  async generateThumbnail(sourcePathOrBuffer, filename) {
    try {
      const sharp = require('sharp');
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
        .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toFile(thumbDestPath);

      return `/public/uploads/previews/thumbs/${thumbFilename}`;
    } catch (err) {
      console.warn('[Thumbnail Generation Warning]:', err.message);
      return null;
    }
  }

  /**
   * Saves a PUBLIC preview image, banner, logo, or favicon.
   * Generates a 300px WebP thumbnail for fast admin listing.
   * Returns web-accessible URL or path.
   */
  async savePublicFile(filePathOrBuffer, originalName, mimeType = null) {
    const driver = this.getDriver();
    const ext = path.extname(originalName).toLowerCase();
    const uniqueFilename = this.generateUniqueFilename(originalName, 'preview');

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
        const key = `previews/${uniqueFilename}`;
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
    const destPath = path.join(this.getPreviewsDir(), uniqueFilename);
    if (Buffer.isBuffer(filePathOrBuffer)) {
      fs.writeFileSync(destPath, filePathOrBuffer);
    } else {
      fs.copyFileSync(filePathOrBuffer, destPath);
    }

    // Generate 300px WebP thumbnail for images
    if (['.jpg', '.jpeg', '.png', '.webp', '.avif', '.jfif', '.bmp'].includes(ext)) {
      await this.generateThumbnail(destPath, uniqueFilename);
    }

    return `/public/uploads/previews/${uniqueFilename}`;
  }

  /**
   * Builds the canonical browser-loadable public URL from any relative key, path, or remote URL.
   */
  buildPublicUrl(keyOrPath) {
    if (!keyOrPath || typeof keyOrPath !== 'string') return null;
    const clean = keyOrPath.trim();
    if (!clean) return null;

    // Remote HTTP / HTTPS URL
    if (clean.startsWith('http://') || clean.startsWith('https://')) {
      return clean;
    }

    // Normalizing slashes
    const normalized = clean.replace(/\\/g, '/');

    // Already public URL
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

    // Relative key e.g. "previews/xyz.jpg" or "previews/thumbs/xyz.webp"
    if (normalized.startsWith('previews/') || normalized.startsWith('/previews/')) {
      return `/public/uploads/${normalized.replace(/^\/+/, '')}`;
    }

    // Plain filename e.g. "preview-123.jpg"
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
   * Returns storage key or relative private path (outside public web root).
   */
  async savePrivateFile(filePathOrBuffer, originalName, mimeType = 'application/octet-stream', designId = null) {
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
    const targetFolder = path.join(this.getPrivateUploadsDir(), 'design-files', subFolder);
    if (!fs.existsSync(targetFolder)) {
      try { fs.mkdirSync(targetFolder, { recursive: true }); } catch (e) {}
    }

    const destPath = path.join(targetFolder, uniqueFilename);
    if (Buffer.isBuffer(filePathOrBuffer)) {
      fs.writeFileSync(destPath, filePathOrBuffer);
    } else {
      fs.copyFileSync(filePathOrBuffer, destPath);
    }

    return relativeKey;
  }

  /**
   * Generates a signed temporary download URL for paid design files.
   * Expires after expiresInSeconds (default: 3600s / 1 hour).
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
   * Uses fs.promises.access and wraps all checks in try/catch so corrupted paths never throw.
   */
  async fileExistsAsync(filePathOrUrl) {
    if (!filePathOrUrl || typeof filePathOrUrl !== 'string' || !filePathOrUrl.trim()) return false;

    // Remote HTTP / HTTPS URLs (Cloudinary, Cloudflare R2 CDN, S3)
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

    // Remote HTTP / HTTPS URLs (Cloudinary, Cloudflare R2 CDN, S3)
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

    // If already absolute on disk
    if (path.isAbsolute(clean) && fs.existsSync(clean)) {
      return clean;
    }

    clean = clean.replace(/\\/g, '/').replace(/^\/+/, '');
    const baseName = path.basename(clean);

    // 1. Direct path check inside UPLOAD_DIR
    const directUploads = path.join(this.getUploadsDir(), clean);
    if (fs.existsSync(directUploads)) return directUploads;

    // 1b. Direct path check inside private uploads dir (outside web root)
    const privateDirect = path.join(this.getPrivateUploadsDir(), clean);
    if (fs.existsSync(privateDirect)) return privateDirect;

    const cleanWithoutPrivate = clean.replace(/^(storage_private\/)+/, '');
    const privateFromClean = path.join(this.getPrivateUploadsDir(), cleanWithoutPrivate);
    if (fs.existsSync(privateFromClean)) return privateFromClean;

    const privateFiles = path.join(this.getPrivateUploadsDir(), cleanWithoutPrivate.replace(/^design-files\//, 'design-files/'));
    if (fs.existsSync(privateFiles)) return privateFiles;

    // 2. Direct path check inside projectRoot
    const rootDirect = path.join(projectRoot, clean);
    if (fs.existsSync(rootDirect)) return rootDirect;

    const publicDirect = path.join(projectRoot, 'public', clean.replace(/^public\//, ''));
    if (fs.existsSync(publicDirect)) return publicDirect;

    // 3. Check by filename in persistent previews, thumbs, designs
    const persistentPreviews = path.join(this.getPreviewsDir(), baseName);
    if (fs.existsSync(persistentPreviews)) return persistentPreviews;

    const persistentThumbs = path.join(this.getThumbsDir(), baseName);
    if (fs.existsSync(persistentThumbs)) return persistentThumbs;

    const persistentDesigns = path.join(this.getDesignsDir(), baseName);
    if (fs.existsSync(persistentDesigns)) return persistentDesigns;

    const persistentOriginals = path.join(this.getOriginalsDir(), baseName);
    if (fs.existsSync(persistentOriginals)) return persistentOriginals;

    // 4. Check by filename in default project uploads
    const inDefaultPreviews = path.join(defaultUploadsDir, 'previews', baseName);
    if (fs.existsSync(inDefaultPreviews)) return inDefaultPreviews;

    const inDefaultThumbs = path.join(defaultUploadsDir, 'previews', 'thumbs', baseName);
    if (fs.existsSync(inDefaultThumbs)) return inDefaultThumbs;

    const inDefaultDesigns = path.join(defaultUploadsDir, 'designs', baseName);
    if (fs.existsSync(inDefaultDesigns)) return inDefaultDesigns;

    // 5. Check in brand assets folder
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

    // If it is a remote cloud URL (Cloudinary / S3)
    if (clean.startsWith('http://') || clean.startsWith('https://')) {
      return clean;
    }

    // Direct check: does the file actually exist at the requested project path or persistent uploads path?
    const cleanRel = clean.replace(/^\/+/, '');
    const inRoot = path.join(projectRoot, cleanRel);
    if (fs.existsSync(inRoot) && fs.statSync(inRoot).isFile()) {
      return clean.startsWith('/') ? clean : '/' + clean;
    }

    const baseName = path.basename(clean);
    const inPreviews = path.join(this.getPreviewsDir(), baseName);
    if (fs.existsSync(inPreviews) && fs.statSync(inPreviews).isFile()) {
      return `/public/uploads/previews/${baseName}`;
    }

    // Candidate file is missing on disk; fall back safely to committed brand asset
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
      console.warn('[Cloudinary Upload Error]:', e.message);
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
}

const storageService = new StorageService();
storageService.initStorageDirs();

module.exports = storageService;
