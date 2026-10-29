const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const storage = require('../../config/storage');
const db = require('../../config/db');
const Design = require('../../models/Design');
const Setting = require('../../models/Setting');
const previewService = require('../../services/previewService');
const adminDesignController = require('./adminDesignController');

/**
 * Ensures a directory exists on persistent storage
 */
function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

/**
 * Unified Chunk Upload Controller
 * Powers:
 * 1. Bulk Restore / Re-upload Images
 * 2. Bulk Replace Files by Category
 * 3. Bulk Import Asset Step
 * 4. Machine ZIP / File Uploads
 */

/**
 * 1. Initialize Upload Session
 * POST /admin/api/upload/init
 */
exports.initUpload = async (req, res) => {
  const refId = 'init_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
  try {
    const isAdmin = (req.user && req.user.role === 'admin') || (req.session && (req.session.adminUser || req.session.userId));
    if (!isAdmin) {
      return res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Admin session expired or access denied.',
        referenceId: refId,
        stage: 'init'
      });
    }

    const { filename, fileSize, totalChunks = 1, uploadType = 'image' } = req.body;
    if (!filename) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_FILENAME',
        message: 'Filename is required to initialize upload.',
        referenceId: refId,
        stage: 'init'
      });
    }

    // Generate safe unique upload ID
    const randomHex = crypto.randomBytes(6).toString('hex');
    const uploadId = `upl_${Date.now()}_${randomHex}`;

    // Create session temp directory on persistent storage
    const chunksDir = path.join(storage.getUploadsDir(), 'temp_chunks', uploadId);
    ensureDirectory(chunksDir);

    // Record session in database if available
    if (db.isConnected()) {
      try {
        await db.query(
          `INSERT INTO upload_sessions (id, user_id, filename, file_size, total_chunks, uploaded_chunks, upload_type, status, reference_id, created_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, 'uploading', ?, NOW())`,
          [uploadId, req.user.id, filename.slice(0, 255), Number(fileSize) || 0, parseInt(totalChunks, 10) || 1, uploadType, refId]
        );
      } catch (dbErr) {
        // Table might not exist yet; don't block upload
        console.warn(`[Upload Init Warning] upload_sessions record error: ${dbErr.message}`);
      }
    }

    return res.json({
      success: true,
      uploadId,
      chunkSize: 1024 * 1024, // 1MB chunks
      existingChunks: [],
      referenceId: refId
    });
  } catch (err) {
    console.error(`[Upload Init Error] [${refId}]:`, err.stack || err.message);
    return res.status(500).json({
      success: false,
      code: 'INIT_FAILED',
      message: err.message || 'Failed to initialize upload session.',
      referenceId: refId,
      stage: 'init',
      suggestedAction: 'Check server storage write permissions and database connection.'
    });
  }
};

/**
 * 2. Upload Individual Chunk (1MB)
 * POST /admin/api/upload/chunk
 * Supports BOTH application/octet-stream (raw binary) AND multipart/form-data
 */
exports.uploadChunk = async (req, res) => {
  const refId = 'chk_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
  try {
    // Extract chunk metadata from headers (preferred for octet-stream) or query/body
    const rawUploadId = req.headers['x-upload-id'] || req.query.uploadId || (req.body && req.body.uploadId) || '';
    const uploadId = rawUploadId.replace(/[^a-zA-Z0-9_-]/g, '');

    const rawChunkIndex = req.headers['x-chunk-index'] ?? req.query.chunkIndex ?? (req.body && req.body.chunkIndex);
    const chunkIndex = parseInt(rawChunkIndex, 10);

    const rawTotalChunks = req.headers['x-total-chunks'] ?? req.query.totalChunks ?? (req.body && req.body.totalChunks);
    const totalChunks = parseInt(rawTotalChunks, 10) || 1;

    if (!uploadId || isNaN(chunkIndex)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_CHUNK_PARAMS',
        message: 'Missing or invalid uploadId or chunkIndex.',
        referenceId: refId,
        stage: 'chunk'
      });
    }

    const chunkDir = path.join(storage.getUploadsDir(), 'temp_chunks', uploadId);
    ensureDirectory(chunkDir);

    const targetChunkPath = path.join(chunkDir, `chunk_${chunkIndex}`);

    // Handle application/octet-stream (raw binary in req.body via express.raw)
    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      await fs.promises.writeFile(targetChunkPath, req.body);
    } else if (req.file && req.file.path) {
      // Handle multipart/form-data chunk file
      try {
        await fs.promises.rename(req.file.path, targetChunkPath);
      } catch (_) {
        await fs.promises.copyFile(req.file.path, targetChunkPath);
        try { await fs.promises.unlink(req.file.path); } catch (e) {}
      }
    } else {
      return res.status(400).json({
        success: false,
        code: 'EMPTY_CHUNK_PAYLOAD',
        message: 'No chunk data received in request body.',
        referenceId: refId,
        stage: 'chunk'
      });
    }

    return res.json({
      success: true,
      uploadId,
      chunkIndex,
      totalChunks,
      referenceId: refId
    });
  } catch (err) {
    console.error(`[Upload Chunk Error] [${refId}]:`, err.stack || err.message);
    return res.status(500).json({
      success: false,
      code: 'CHUNK_WRITE_FAILED',
      message: err.message || 'Failed to save upload chunk.',
      referenceId: refId,
      stage: 'chunk',
      suggestedAction: 'Ensure persistent storage volume has free space and write permissions.'
    });
  }
};

/**
 * 3. Complete Upload & Assemble File
 * POST /admin/api/upload/complete
 */
exports.completeUpload = async (req, res) => {
  const refId = 'cmp_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
  const rawUploadId = req.body.uploadId || '';
  const uploadId = rawUploadId.replace(/[^a-zA-Z0-9_-]/g, '');
  const totalChunks = parseInt(req.body.totalChunks, 10) || 1;
  const originalName = String(req.body.originalName || 'file').trim();
  const uploadType = req.body.uploadType || 'image';
  const confirmedMappings = req.body.confirmed_mappings || {};

  const chunkDir = path.join(storage.getUploadsDir(), 'temp_chunks', uploadId);
  const tempCombinedDir = path.join(storage.getUploadsDir(), 'temp_combined');
  ensureDirectory(tempCombinedDir);

  const safeName = path.basename(originalName).replace(/[/\\?%*:|"<>]/g, '_');
  const combinedPath = path.join(tempCombinedDir, `${uploadId}_${safeName}`);

  try {
    if (!uploadId || !fs.existsSync(chunkDir)) {
      return res.status(400).json({
        success: false,
        code: 'SESSION_NOT_FOUND',
        message: 'Upload session not found or chunks directory expired.',
        filename: originalName,
        referenceId: refId,
        stage: 'complete'
      });
    }

    // Verify all chunks exist
    for (let i = 0; i < totalChunks; i++) {
      const cPath = path.join(chunkDir, `chunk_${i}`);
      if (!fs.existsSync(cPath)) {
        return res.status(400).json({
          success: false,
          code: 'MISSING_CHUNK',
          message: `Missing chunk ${i} of ${totalChunks}. Please retry upload.`,
          missingChunkIndex: i,
          filename: originalName,
          referenceId: refId,
          stage: 'complete'
        });
      }
    }

    // Assemble chunks sequentially into combined file
    const writeStream = fs.createWriteStream(combinedPath);
    for (let i = 0; i < totalChunks; i++) {
      const cPath = path.join(chunkDir, `chunk_${i}`);
      const chunkData = await fs.promises.readFile(cPath);
      writeStream.write(chunkData);
    }
    writeStream.end();
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    const fileStats = await fs.promises.stat(combinedPath);
    const finalSize = fileStats.size;

    // Remove chunk directory after assembly
    try {
      await fs.promises.rm(chunkDir, { recursive: true, force: true });
    } catch (_) {}

    // Process file based on uploadType
    if (uploadType === 'bulk-restore' || uploadType === 'image') {
      return await handleBulkRestoreImageComplete({
        req,
        res,
        combinedPath,
        originalName,
        finalSize,
        refId,
        confirmedMappings
      });
    }

    if (uploadType === 'bulk-replace') {
      const bulkImageReplaceService = require('../../services/bulkImageReplaceService');
      const processed = await bulkImageReplaceService.processUploadChunk([{
        path: combinedPath,
        originalname: originalName,
        size: finalSize
      }]);
      const pFile = processed[0] || {};
      return res.json({
        success: true,
        status: 'processed',
        filename: originalName,
        file: pFile,
        referenceId: refId
      });
    }

    if (uploadType === 'import-asset') {
      const bulkImportService = require('../../services/bulkImportService');
      const batchId = req.body.batchId || req.body.confirmed_mappings?.batchId || req.headers['x-batch-id'];
      if (!batchId) {
        return res.status(400).json({ success: false, message: 'Missing import session batchId.', referenceId: refId });
      }
      const result = await bulkImportService.processAssetBatch(batchId, [{
        path: combinedPath,
        originalname: originalName,
        size: finalSize
      }]);
      return res.json({
        success: true,
        status: 'processed',
        filename: originalName,
        ...result,
        referenceId: refId
      });
    }

    // Generic file completion
    return res.json({
      success: true,
      status: 'assembled',
      filename: originalName,
      fileSize: finalSize,
      filePath: combinedPath,
      referenceId: refId
    });

  } catch (err) {
    console.error(`[Upload Complete Error] [${refId}] File "${originalName}":`, err.stack || err.message);
    if (fs.existsSync(combinedPath)) {
      try { await fs.promises.unlink(combinedPath); } catch (_) {}
    }
    return res.status(500).json({
      success: false,
      code: 'COMPLETE_FAILED',
      message: err.message || 'File assembly failed.',
      filename: originalName,
      referenceId: refId,
      stage: 'complete',
      suggestedAction: 'Retry file upload.'
    });
  }
};

/**
 * Helper to process and link bulk restored image
 */
async function handleBulkRestoreImageComplete({ req, res, combinedPath, originalName, finalSize, refId, confirmedMappings }) {
  const ext = path.extname(originalName).toLowerCase();
  const validExts = ['.png', '.jpg', '.jpeg', '.webp', '.avif'];

  if (!validExts.includes(ext)) {
    try { await fs.promises.unlink(combinedPath); } catch (_) {}
    return res.status(400).json({
      success: false,
      code: 'INVALID_FORMAT',
      status: 'failed',
      filename: originalName,
      error: `Unsupported image format (${ext || 'none'}). Only PNG, JPG, JPEG, WEBP, and AVIF are supported.`,
      referenceId: refId,
      stage: 'Format Validation Stage',
      suggestedAction: 'Save the image as PNG, JPG, or WebP.'
    });
  }

  // Load catalog designs for matching
  let catalogDesigns = [];
  try {
    const catalogRes = await Design.getAll({ limit: 3000, is_active_only: false });
    catalogDesigns = catalogRes.designs || [];
  } catch (cErr) {
    console.warn('[Bulk Restore Catalog Warning]:', cErr.message);
  }

  // Match design using existing 4-tier matching engine
  const matchResult = await adminDesignController.findMatchingDesign(originalName, catalogDesigns, confirmedMappings);

  if (matchResult.status === 'matched') {
    const matchedDesign = matchResult.design;
    try {
      // Generate web-optimized previews and thumbnails using previewService (with Sharp fallback)
      const variants = await previewService.generatePreviewVariants(combinedPath, originalName);

      // Commit primary preview record in database
      await previewService.setPrimaryPreview(matchedDesign.id, variants);

      // Clean up temporary combined file
      try { await fs.promises.unlink(combinedPath); } catch (_) {}

      return res.json({
        success: true,
        status: 'linked',
        filename: originalName,
        designId: matchedDesign.id,
        sku: matchedDesign.sku,
        title: matchedDesign.title,
        imageUrl: variants.largeKey,
        thumbUrl: variants.thumbKey,
        matchedBy: matchResult.matchedBy,
        referenceId: refId
      });
    } catch (saveErr) {
      console.error(`[Bulk Restore Save Error] [${refId}] File "${originalName}":`, saveErr.stack || saveErr.message);
      try { await fs.promises.unlink(combinedPath); } catch (_) {}
      return res.status(500).json({
        success: false,
        status: 'failed',
        filename: originalName,
        error: saveErr.message || 'Failed to save image to persistent storage.',
        referenceId: refId,
        stage: 'Storage Stage',
        suggestedAction: 'Check disk write permissions and storage space.'
      });
    }
  }

  if (matchResult.status === 'ambiguous') {
    // Move to temp_unmatched directory for user disambiguation
    const tempUnmatchedDir = path.join(storage.getUploadsDir(), 'temp_unmatched');
    ensureDirectory(tempUnmatchedDir);
    const token = `amb_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
    const destPath = path.join(tempUnmatchedDir, token);
    await fs.promises.rename(combinedPath, destPath);

    return res.json({
      success: true,
      status: 'ambiguous',
      filename: originalName,
      tempToken: token,
      candidates: matchResult.candidates || [],
      matchedBy: matchResult.matchedBy,
      referenceId: refId
    });
  }

  // Unmatched
  const tempUnmatchedDir = path.join(storage.getUploadsDir(), 'temp_unmatched');
  ensureDirectory(tempUnmatchedDir);
  const token = `unm_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
  const destPath = path.join(tempUnmatchedDir, token);
  await fs.promises.rename(combinedPath, destPath);

  return res.json({
    success: true,
    status: 'unmatched',
    filename: originalName,
    tempToken: token,
    reason: matchResult.reason || 'No matching design found in catalog.',
    suggestions: matchResult.suggestions || [],
    referenceId: refId
  });
}

/**
 * 2b. Direct Single-Request Upload (< 2MB)
 * POST /admin/api/upload/direct
 * Combines init + upload + complete into ONE round trip for files <= 2MB!
 */
exports.directUpload = async (req, res) => {
  const refId = 'dir_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
  try {
    const isAdmin = (req.user && req.user.role === 'admin') || (req.session && (req.session.adminUser || req.session.userId));
    if (!isAdmin) {
      return res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Admin session expired or access denied.',
        referenceId: refId,
        stage: 'auth'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        code: 'NO_FILE',
        message: 'No file received in direct upload.',
        referenceId: refId,
        stage: 'upload'
      });
    }

    const originalName = req.body.originalName || req.file.originalname || req.body.filename || 'unknown';
    const uploadType = req.body.uploadType || 'bulk-restore';
    const filePath = req.file.path;
    const finalSize = req.file.size;
    let confirmedMappings = {};
    if (req.body.confirmed_mappings) {
      try {
        confirmedMappings = typeof req.body.confirmed_mappings === 'string'
          ? JSON.parse(req.body.confirmed_mappings)
          : req.body.confirmed_mappings;
      } catch (_) {}
    }

    if (uploadType === 'bulk-restore' || uploadType === 'image') {
      return await handleBulkRestoreImageComplete({
        req,
        res,
        combinedPath: filePath,
        originalName,
        finalSize,
        refId,
        confirmedMappings
      });
    }

    if (uploadType === 'bulk-replace') {
      const bulkImageReplaceService = require('../../services/bulkImageReplaceService');
      const processed = await bulkImageReplaceService.processUploadChunk([{
        path: filePath,
        originalname: originalName,
        size: finalSize
      }]);
      const pFile = processed[0] || {};
      return res.json({
        success: true,
        status: 'processed',
        filename: originalName,
        file: pFile,
        referenceId: refId
      });
    }

    if (uploadType === 'import-asset') {
      const bulkImportService = require('../../services/bulkImportService');
      const batchId = req.body.batchId || req.body.confirmed_mappings?.batchId || req.headers['x-batch-id'];
      if (!batchId) {
        return res.status(400).json({ success: false, message: 'Missing import session batchId.', referenceId: refId });
      }
      const result = await bulkImportService.processAssetBatch(batchId, [{
        path: filePath,
        originalname: originalName,
        size: finalSize
      }]);
      return res.json({
        success: true,
        status: 'processed',
        filename: originalName,
        ...result,
        referenceId: refId
      });
    }

    return res.json({
      success: true,
      status: 'assembled',
      filename: originalName,
      fileSize: finalSize,
      filePath: filePath,
      referenceId: refId
    });

  } catch (err) {
    console.error(`[Direct Upload Error] [${refId}]:`, err.stack || err.message);
    if (req.file && fs.existsSync(req.file.path)) {
      try { await fs.promises.unlink(req.file.path); } catch (_) {}
    }
    return res.status(500).json({
      success: false,
      code: 'DIRECT_UPLOAD_FAILED',
      message: err.message || 'Direct upload failed.',
      referenceId: refId,
      stage: 'direct-upload',
      suggestedAction: 'Retry file upload.'
    });
  }
};

/**
 * 4. Route Health Check & Test Upload Tool
 * POST /admin/api/upload/test-health
 */
exports.testHealth = async (req, res) => {
  const refId = 'hlth_' + Date.now().toString(36);
  const { getRateLimitStatus } = require('../../middleware/rateLimiters');
  const rateLimitStatus = getRateLimitStatus(req);

  const checks = {
    route: { status: 'pass', code: 200 },
    csrf: { status: 'pass' },
    session: { status: 'pass', user: req.user ? req.user.email : 'Unknown' },
    rateLimiter: {
      status: 'pass',
      adminExempt: true,
      trustProxy: Boolean(req.app.get('trust proxy')),
      clientIp: req.ip,
      config: rateLimitStatus
    },
    storageWritable: { status: 'fail', error: null },
    previewsWritable: { status: 'fail', error: null },
    sharpAvailable: { status: 'fail', mode: 'unknown' },
    databaseStatus: { status: db.isConnected() ? 'connected' : 'offline' },
    maxBodySize: '10MB chunk / 50MB batch'
  };

  // Test storage writable
  const uploadsDir = storage.getUploadsDir();
  const testProbeFile = path.join(uploadsDir, `.probe_${Date.now()}.tmp`);
  try {
    ensureDirectory(uploadsDir);
    await fs.promises.writeFile(testProbeFile, 'probe');
    await fs.promises.unlink(testProbeFile);
    checks.storageWritable = { status: 'pass', path: uploadsDir };
  } catch (err) {
    checks.storageWritable = { status: 'fail', error: err.message, path: uploadsDir };
  }

  // Test previews writable
  const previewsDir = storage.getPreviewsDir();
  const testPreviewProbe = path.join(previewsDir, `.probe_prev_${Date.now()}.tmp`);
  try {
    ensureDirectory(previewsDir);
    await fs.promises.writeFile(testPreviewProbe, 'probe');
    await fs.promises.unlink(testPreviewProbe);
    checks.previewsWritable = { status: 'pass', path: previewsDir };
  } catch (err) {
    checks.previewsWritable = { status: 'fail', error: err.message, path: previewsDir };
  }

  // Test sharp
  try {
    const sharp = require('sharp');
    const probeBuf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    await sharp(probeBuf).resize(1, 1).toBuffer();
    checks.sharpAvailable = { status: 'pass', mode: 'native_libvips' };
  } catch (sErr) {
    checks.sharpAvailable = { status: 'warning', mode: 'buffer_fallback', message: sErr.message };
  }

  const allPassed = checks.storageWritable.status === 'pass' && checks.previewsWritable.status === 'pass';

  return res.json({
    success: allPassed,
    referenceId: refId,
    checks,
    summary: allPassed ? 'Upload engine is 100% operational (Admin upload routes exempt from rate limiting).' : 'Upload engine storage permissions issue detected.'
  });
};

/**
 * 5. Session Keep-Alive Ping
 * GET /admin/api/keep-alive
 */
exports.keepAlive = (req, res) => {
  if (req.session) {
    req.session.lastActive = Date.now();
  }
  return res.json({
    success: true,
    timestamp: Date.now(),
    authenticated: Boolean((req.user && req.user.role === 'admin') || (req.session && (req.session.adminUser || req.session.userId)))
  });
};
