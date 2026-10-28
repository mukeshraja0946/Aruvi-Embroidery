const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const Setting = require('../models/Setting');

class WatermarkService {
  constructor() {
    this.watermarkCache = new Map();
  }

  /**
   * Optional PNG logo watermark applier.
   * Default: OFF.
   * Never renders SVG text or fonts, eliminating broken tofu characters (□□□□).
   * Only applies when explicitly enabled in admin settings with a valid PNG logo file.
   */
  async applyWatermark(inputBufferOrPath, { format = null, quality = 85 } = {}) {
    try {
      let inputBuffer;
      if (Buffer.isBuffer(inputBufferOrPath)) {
        inputBuffer = inputBufferOrPath;
      } else if (typeof inputBufferOrPath === 'string' && fs.existsSync(inputBufferOrPath)) {
        inputBuffer = await fs.promises.readFile(inputBufferOrPath);
      } else {
        throw new Error('Invalid image input for watermark check');
      }

      // Check if optional PNG logo watermark is enabled (Default: OFF)
      let settings = {};
      try {
        settings = await Setting.getAll();
      } catch (_) {}

      const isEnabled = settings.watermark_enabled === '1';
      if (!isEnabled) {
        // Return clean image untouched (or converted to requested format)
        if (format) {
          let pipeline = sharp(inputBuffer).rotate();
          if (format === 'png') {
            pipeline = pipeline.png({ compressionLevel: 8 });
          } else if (format === 'webp') {
            pipeline = pipeline.webp({ quality });
          } else {
            pipeline = pipeline.jpeg({ quality, mozjpeg: true });
          }
          return await pipeline.toBuffer();
        }
        return inputBuffer;
      }

      // If enabled, resolve configured PNG logo file
      const logoPath = settings.watermark_logo_path || path.join(__dirname, '..', 'public', 'assets', 'brand', 'logo.png');
      if (!fs.existsSync(logoPath)) {
        console.warn('[WatermarkService] Optional logo file not found, serving clean image:', logoPath);
        return inputBuffer;
      }

      const opacity = Math.max(5, Math.min(100, parseInt(settings.watermark_opacity, 10) || 25)) / 100;
      const position = settings.watermark_position || 'center';

      const image = sharp(inputBuffer).rotate();
      const metadata = await image.metadata();
      const imgWidth = metadata.width || 800;
      const imgHeight = metadata.height || 800;

      // Resize logo to ~30% of image width
      const targetLogoWidth = Math.max(80, Math.min(Math.round(imgWidth * 0.3), 500));
      const logoBuffer = await sharp(logoPath)
        .resize({ width: targetLogoWidth, withoutEnlargement: true })
        .ensureAlpha(opacity)
        .toBuffer();

      const logoMeta = await sharp(logoBuffer).metadata();
      const lw = logoMeta.width || targetLogoWidth;
      const lh = logoMeta.height || targetLogoWidth;

      let left = Math.round((imgWidth - lw) / 2);
      let top = Math.round((imgHeight - lh) / 2);

      if (position === 'bottom-right') {
        left = imgWidth - lw - 24;
        top = imgHeight - lh - 24;
      } else if (position === 'bottom-left') {
        left = 24;
        top = imgHeight - lh - 24;
      } else if (position === 'top-right') {
        left = imgWidth - lw - 24;
        top = 24;
      } else if (position === 'top-left') {
        left = 24;
        top = 24;
      }

      let pipeline = image.composite([
        {
          input: logoBuffer,
          top: Math.max(0, top),
          left: Math.max(0, left),
          blend: 'over'
        }
      ]);

      const outFormat = format || (metadata.format === 'png' ? 'png' : 'jpeg');
      if (outFormat === 'png') {
        pipeline = pipeline.png({ compressionLevel: 8 });
      } else if (outFormat === 'webp') {
        pipeline = pipeline.webp({ quality });
      } else {
        pipeline = pipeline.jpeg({ quality, mozjpeg: true });
      }

      return await pipeline.toBuffer();
    } catch (err) {
      console.warn('[WatermarkService Warning]: Failed optional watermark overlay, returning clean image:', err.message);
      if (Buffer.isBuffer(inputBufferOrPath)) return inputBufferOrPath;
      return await fs.promises.readFile(inputBufferOrPath);
    }
  }

  /**
   * Generates clean large preview (~1200px) and clean 300px thumbnail.
   * No text or SVG watermark overlay.
   */
  async generateWatermarkedPreviews(inputBufferOrPath, { maxWidth = 1200, maxHeight = 1200, thumbSize = 300, quality = 85 } = {}) {
    let inputBuffer;
    if (Buffer.isBuffer(inputBufferOrPath)) {
      inputBuffer = inputBufferOrPath;
    } else if (typeof inputBufferOrPath === 'string' && fs.existsSync(inputBufferOrPath)) {
      inputBuffer = await fs.promises.readFile(inputBufferOrPath);
    } else {
      throw new Error('Invalid image input for preview generation');
    }

    // 1. Clean large preview: auto-rotate & resize to inside maxWidth x maxHeight
    const largeSharp = sharp(inputBuffer)
      .rotate()
      .resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality });
    const largeBuffer = await largeSharp.toBuffer();
    const largeMeta = await sharp(largeBuffer).metadata();
    const width = largeMeta.width || 800;
    const height = largeMeta.height || 800;

    // 2. Clean 300px thumbnail: auto-rotate & resize to inside thumbSize x thumbSize
    const thumbBuffer = await sharp(inputBuffer)
      .rotate()
      .resize(thumbSize, thumbSize, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    const thumbMeta = await sharp(thumbBuffer).metadata();
    const tw = thumbMeta.width || thumbSize;
    const th = thumbMeta.height || thumbSize;

    return {
      largeBuffer,
      thumbBuffer,
      width,
      height,
      thumbWidth: tw,
      thumbHeight: th,
      format: 'webp'
    };
  }
}

module.exports = new WatermarkService();
