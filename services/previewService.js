const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const db = require('../config/db');
const storage = require('../config/storage');
const watermarkService = require('./watermarkService');

const PLACEHOLDER_URL = '/public/images/placeholder-preview.svg';
const NON_IMAGE_EXTS = new Set(['zip', 'dst', 'pes', 'jef', 'exp', 'hus', 'vip', 'vp3', 'xxx', 'sew', 'pec', 'rar', '7z']);

/**
 * Normalizes URL string, removes redundant query parameters, and adds clean version suffix
 */
function cleanAndVersionUrl(rawUrl, versionTag) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const clean = rawUrl.trim();
  if (!clean || clean.includes('placeholder-preview.svg')) return PLACEHOLDER_URL;

  // Split off any existing query parameters
  const [base] = clean.split('?');
  const pub = storage.buildPublicUrl(base);
  if (!pub) return PLACEHOLDER_URL;

  if (!versionTag) return pub;
  return `${pub}?v=${encodeURIComponent(versionTag)}`;
}

function verifyLocalFileExists(publicUrl) {
  if (!publicUrl || typeof publicUrl !== 'string') return false;
  const clean = publicUrl.split('?')[0].trim();
  if (!clean || clean.includes('placeholder-preview.svg')) return false;
  if (!clean.startsWith('/public/uploads/')) return true;
  const rel = clean.replace(/^\/public\//, '');
  const absPath = path.join(__dirname, '..', 'public', rel);
  return fs.existsSync(absPath);
}

class PreviewService {
  /**
   * Universal Single Source of Truth for Design Preview & Thumbnail URLs
   * Used across listing cards, detail page, search, wishlist, cart, orders, and emails.
   *
   * @param {Object} design - Design object or database row
   * @returns {Object} { thumbUrl, cardUrl, largeUrl, hasPreview, version, altText }
   */
  getPrimaryPreview(design) {
    if (!design) {
      return {
        thumbUrl: PLACEHOLDER_URL,
        cardUrl: PLACEHOLDER_URL,
        largeUrl: PLACEHOLDER_URL,
        hasPreview: false,
        version: '1',
        altText: 'Embroidery Design'
      };
    }

    const altText = design.title || design.sku || 'Embroidery Design';

    // 1. Resolve Primary Image Row
    let primaryRow = null;

    if (design.images && Array.isArray(design.images) && design.images.length > 0) {
      // Find explicitly flagged primary image
      primaryRow = design.images.find(img => img && (img.is_primary === 1 || img.is_primary === true || img.is_primary === '1'));
      // Fallback to lowest display_order / sort_order / first image
      if (!primaryRow) {
        primaryRow = design.images.slice().sort((a, b) => {
          const ordA = a.display_order ?? a.sort_order ?? 999;
          const ordB = b.display_order ?? b.sort_order ?? 999;
          return ordA - ordB;
        })[0];
      }
    }

    // 2. Extract Candidate URLs
    let rawLarge = primaryRow ? (primaryRow.image_url || primaryRow.storage_key) : null;
    let rawThumb = primaryRow ? (primaryRow.thumb_key || primaryRow.thumbnail_url) : null;
    let rawCard = primaryRow ? (primaryRow.card_key || primaryRow.card_url) : null;

    // Fallbacks from root design object if not in primaryRow
    if (!rawLarge) {
      rawLarge = design.large_url || design.primary_image || design.image_url || design.image || null;
    }
    if (!rawThumb) {
      rawThumb = design.thumb_key || design.thumbnail_image || design.thumbnail_url || null;
    }
    if (!rawCard) {
      rawCard = design.card_key || design.card_image || design.card_url || null;
    }

    // Filter out non-image extensions (.zip, .dst, etc.)
    if (rawLarge) {
      const ext = path.extname(rawLarge.split('?')[0]).toLowerCase().replace('.', '');
      if (NON_IMAGE_EXTS.has(ext)) rawLarge = null;
    }
    if (rawThumb) {
      const ext = path.extname(rawThumb.split('?')[0]).toLowerCase().replace('.', '');
      if (NON_IMAGE_EXTS.has(ext)) rawThumb = null;
    }
    if (rawCard) {
      const ext = path.extname(rawCard.split('?')[0]).toLowerCase().replace('.', '');
      if (NON_IMAGE_EXTS.has(ext)) rawCard = null;
    }

    // 3. Determine Version Tag
    let versionTag = null;
    if (primaryRow && primaryRow.checksum) {
      versionTag = String(primaryRow.checksum).slice(0, 10);
    } else if (primaryRow && primaryRow.version) {
      versionTag = String(primaryRow.version);
    } else if (design.checksum) {
      versionTag = String(design.checksum).slice(0, 10);
    } else if (design.updated_at) {
      versionTag = String(new Date(design.updated_at).getTime());
    } else if (primaryRow && primaryRow.updated_at) {
      versionTag = String(new Date(primaryRow.updated_at).getTime());
    } else {
      versionTag = '1';
    }

    const hasPreview = Boolean(rawLarge && !rawLarge.includes('placeholder-preview.svg'));

    if (!hasPreview) {
      return {
        thumbUrl: PLACEHOLDER_URL,
        cardUrl: PLACEHOLDER_URL,
        largeUrl: PLACEHOLDER_URL,
        hasPreview: false,
        version: versionTag,
        altText
      };
    }

    // Build Public Canonical URLs
    const largeUrl = cleanAndVersionUrl(rawLarge, versionTag);

    // Card URL: card_key -> physical card file -> largeUrl fallback
    let cardUrl = null;
    if (rawCard && verifyLocalFileExists(rawCard)) {
      cardUrl = cleanAndVersionUrl(rawCard, versionTag);
    } else {
      const baseNameWithoutExt = path.basename(rawLarge.split('?')[0], path.extname(rawLarge.split('?')[0]));
      const candidateCard = path.join(storage.getPreviewsDir(), 'cards', `${baseNameWithoutExt}.webp`);
      if (fs.existsSync(candidateCard)) {
        cardUrl = cleanAndVersionUrl(`/public/uploads/previews/cards/${baseNameWithoutExt}.webp`, versionTag);
      } else {
        cardUrl = largeUrl; // Fallback to large preview so cards NEVER show placeholder
      }
    }

    // Thumb URL: thumb_key -> physical thumb file -> cardUrl -> largeUrl fallback
    let thumbUrl = null;
    if (rawThumb && verifyLocalFileExists(rawThumb)) {
      thumbUrl = cleanAndVersionUrl(rawThumb, versionTag);
    } else {
      const baseNameWithoutExt = path.basename(rawLarge.split('?')[0], path.extname(rawLarge.split('?')[0]));
      const candidateThumb = path.join(storage.getThumbsDir(), `${baseNameWithoutExt}.webp`);
      if (fs.existsSync(candidateThumb)) {
        thumbUrl = cleanAndVersionUrl(`/public/uploads/previews/thumbs/${baseNameWithoutExt}.webp`, versionTag);
      } else {
        thumbUrl = cardUrl || largeUrl; // Guaranteed fallback: NEVER show placeholder if large exists
      }
    }

    return {
      thumbUrl: thumbUrl || largeUrl || PLACEHOLDER_URL,
      cardUrl: cardUrl || largeUrl || PLACEHOLDER_URL,
      largeUrl: largeUrl || PLACEHOLDER_URL,
      hasPreview: true,
      has_thumbnail: Boolean(thumbUrl && thumbUrl !== largeUrl && thumbUrl !== PLACEHOLDER_URL),
      version: versionTag,
      altText
    };
  }

  /**
   * Generates 3 synchronized WebP variants from any source image:
   * 1. Large Preview: Max 1200px, watermarked WebP (quality 85)
   * 2. Card Size: Max 600px, watermarked WebP (quality 85)
   * 3. Thumbnail: Max 300px, watermarked WebP (quality 80)
   */
  async generatePreviewVariants(sourcePathOrBuffer, baseFilename) {
    let inputBuffer;
    if (Buffer.isBuffer(sourcePathOrBuffer)) {
      inputBuffer = sourcePathOrBuffer;
    } else if (typeof sourcePathOrBuffer === 'string' && fs.existsSync(sourcePathOrBuffer)) {
      inputBuffer = await fs.promises.readFile(sourcePathOrBuffer);
    } else {
      throw new Error(`Source image not found for variant generation: ${sourcePathOrBuffer}`);
    }

    // Verify valid image header
    const isPng = inputBuffer[0] === 0x89 && inputBuffer[1] === 0x50 && inputBuffer[2] === 0x4E && inputBuffer[3] === 0x47;
    const isJpg = inputBuffer[0] === 0xFF && inputBuffer[1] === 0xD8 && inputBuffer[2] === 0xFF;
    const isWebp = inputBuffer.length > 12 && inputBuffer.toString('utf8', 8, 12) === 'WEBP';

    if (!isPng && !isJpg && !isWebp) {
      throw new Error(`Invalid image content for ${baseFilename}. PNG, JPG, or WEBP required.`);
    }

    const checksum = crypto.createHash('sha256').update(inputBuffer).digest('hex');
    const cleanBase = path.basename(baseFilename, path.extname(baseFilename)).replace(/[^a-zA-Z0-9_-]/g, '_');
    const uniqueBase = `${cleanBase}_${Date.now()}_${checksum.slice(0, 8)}`;

    const largeFilename = `${uniqueBase}.webp`;
    const cardFilename = `card_${uniqueBase}.webp`;
    const thumbFilename = `${uniqueBase}.webp`;

    const previewsDir = storage.getPreviewsDir();
    const thumbsDir = storage.getThumbsDir();
    const cardsDir = path.join(previewsDir, 'cards');

    if (!fs.existsSync(cardsDir)) {
      try { fs.mkdirSync(cardsDir, { recursive: true }); } catch (_) {}
    }
    if (!fs.existsSync(thumbsDir)) {
      try { fs.mkdirSync(thumbsDir, { recursive: true }); } catch (_) {}
    }

    // 1. Large preview (max 1200px with transparent watermark)
    const largeRes = await watermarkService.generateWatermarkedPreviews(inputBuffer, {
      maxWidth: 1200,
      maxHeight: 1200,
      thumbSize: 300,
      quality: 85
    });

    const largePath = path.join(previewsDir, largeFilename);
    const thumbPath = path.join(thumbsDir, thumbFilename);

    await fs.promises.writeFile(largePath, largeRes.largeBuffer);
    await fs.promises.writeFile(thumbPath, largeRes.thumbBuffer);

    // 2. Card size preview (max 600px with subtle watermark)
    const cardSharp = sharp(inputBuffer).resize(600, 600, {
      fit: 'inside',
      withoutEnlargement: true
    });
    const cardBuf = await cardSharp.toBuffer();
    const cardMeta = await sharp(cardBuf).metadata();
    const cw = cardMeta.width || 600;
    const ch = cardMeta.height || 600;
    const cardWmSvg = watermarkService.generateWatermarkSvg(cw, ch);

    const cardWatermarked = await sharp(cardBuf)
      .composite([{ input: cardWmSvg, top: 0, left: 0, blend: 'over' }])
      .webp({ quality: 85 })
      .toBuffer();

    const cardPath = path.join(cardsDir, cardFilename);
    await fs.promises.writeFile(cardPath, cardWatermarked);

    const largeKey = `/public/uploads/previews/${largeFilename}`;
    const cardKey = `/public/uploads/previews/cards/${cardFilename}`;
    const thumbKey = `/public/uploads/previews/thumbs/${thumbFilename}`;

    return {
      largeKey,
      cardKey,
      thumbKey,
      fileSize: largeRes.largeBuffer.length,
      checksum,
      version: 1
    };
  }

  /**
   * Commits primary preview record and keeps exactly ONE primary image per design
   */
  async setPrimaryPreview(designId, variants, externalConnection = null) {
    const conn = externalConnection || db;
    const { largeKey, cardKey, thumbKey, fileSize, checksum, version = 1 } = variants;

    if (db.isConnected()) {
      // Unset any previous primary flags for this design
      await conn.query('UPDATE design_images SET is_primary = 0 WHERE design_id = ?', [designId]);

      // Check for existing primary row or insert new
      const existing = await conn.query(
        'SELECT id FROM design_images WHERE design_id = ? AND (image_url = ? OR display_order = 0) ORDER BY id ASC LIMIT 1',
        [designId, largeKey]
      );

      let imageRowId = null;
      if (existing && existing.length > 0) {
        imageRowId = existing[0].id;
        try {
          await conn.query(`
            UPDATE design_images 
            SET image_url = ?, thumb_key = ?, card_key = ?, is_primary = 1, display_order = 0, file_size = ?, checksum = ?, version = version + 1, updated_at = NOW()
            WHERE id = ?
          `, [largeKey, thumbKey, cardKey, fileSize || 0, checksum || null, imageRowId]);
        } catch (_) {
          await conn.query(`
            UPDATE design_images 
            SET image_url = ?, is_primary = 1, display_order = 0, file_size = ?
            WHERE id = ?
          `, [largeKey, fileSize || 0, imageRowId]);
        }
      } else {
        try {
          const ins = await conn.query(`
            INSERT INTO design_images (design_id, image_url, thumb_key, card_key, is_primary, display_order, file_size, checksum, version)
            VALUES (?, ?, ?, ?, 1, 0, ?, ?, ?)
          `, [designId, largeKey, thumbKey, cardKey, fileSize || 0, checksum || null, version]);
          imageRowId = ins.insertId;
        } catch (_) {
          const ins = await conn.query(`
            INSERT INTO design_images (design_id, image_url, is_primary, display_order, file_size)
            VALUES (?, ?, 1, 0, ?)
          `, [designId, largeKey, fileSize || 0]);
          imageRowId = ins.insertId;
        }
      }

      // Keep exactly ONE primary image: clean duplicate primary rows
      await conn.query('UPDATE design_images SET is_primary = 0 WHERE design_id = ? AND id != ?', [designId, imageRowId]);

      // Synchronize designs table columns
      try {
        await conn.query(`
          UPDATE designs 
          SET primary_image = ?, thumbnail_image = ?, card_image = ?, updated_at = NOW() 
          WHERE id = ?
        `, [largeKey, thumbKey, cardKey, designId]);
      } catch (_) {
        try {
          await conn.query('UPDATE designs SET primary_image = ? WHERE id = ?', [largeKey, designId]);
        } catch (_) {}
      }

      // Synchronize preview record in design_files
      try {
        const pFiles = await conn.query(
          "SELECT id FROM design_files WHERE design_id = ? AND (is_preview = 1 OR file_kind = 'image') ORDER BY id ASC",
          [designId]
        );
        if (pFiles && pFiles.length > 0) {
          await conn.query(
            'UPDATE design_files SET file_name = ?, file_path = ?, file_format = "WEBP", file_size = ?, is_preview = 1 WHERE id = ?',
            [path.basename(largeKey), largeKey, fileSize || 0, pFiles[0].id]
          );
        } else {
          await conn.query(
            'INSERT INTO design_files (design_id, file_name, file_path, file_format, file_size, is_preview, file_kind) VALUES (?, ?, ?, "WEBP", ?, 1, "image")',
            [designId, path.basename(largeKey), largeKey, fileSize || 0]
          );
        }
      } catch (_) {}
    }

    return true;
  }
}

const previewService = new PreviewService();
module.exports = previewService;
