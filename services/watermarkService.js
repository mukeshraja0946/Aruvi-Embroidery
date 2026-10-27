const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

class WatermarkService {
  constructor() {
    this.watermarkCache = new Map();
    this.maxCacheEntries = 100;
  }

  /**
   * Generates a clean, transparent SVG watermark banner with brand typography.
   * Matches "Aruvi EMBROIDERY — Where Threads Tell Stories".
   */
  generateWatermarkSvg(targetWidth, targetHeight) {
    const scale = Math.max(0.4, Math.min(1.5, targetWidth / 1000));
    const fontSizeTitle = Math.round(38 * scale);
    const fontSizeSub = Math.round(14 * scale);
    const boxWidth = Math.round(520 * scale);
    const boxHeight = Math.round(130 * scale);

    return Buffer.from(`
      <svg width="${targetWidth}" height="${targetHeight}" xmlns="http://www.w3.org/2000/svg">
        <style>
          .wm-title { font-family: 'Playfair Display', Georgia, serif; font-size: ${fontSizeTitle}px; font-weight: 700; fill: #A32A38; fill-opacity: 0.38; }
          .wm-sub { font-family: 'Poppins', sans-serif; font-size: ${fontSizeSub}px; font-weight: 600; letter-spacing: 2px; fill: #6E3B45; fill-opacity: 0.40; text-transform: uppercase; }
          .wm-bg { fill: rgba(255, 255, 255, 0.42); stroke: rgba(163, 42, 56, 0.28); stroke-width: 1.5; rx: 16px; }
        </style>
        <g transform="translate(${(targetWidth - boxWidth) / 2}, ${(targetHeight - boxHeight) / 2})">
          <rect width="${boxWidth}" height="${boxHeight}" class="wm-bg" />
          <text x="${boxWidth / 2}" y="${boxHeight * 0.48}" text-anchor="middle" class="wm-title">Aruvi</text>
          <text x="${boxWidth / 2}" y="${boxHeight * 0.76}" text-anchor="middle" class="wm-sub">EMBROIDERY STUDIO</text>
        </g>
      </svg>
    `);
  }

  /**
   * Applies the Aruvi brand watermark to an image buffer or file path.
   * Preserves image dimensions and quality.
   */
  async applyWatermark(inputBufferOrPath, { format = null, quality = 90 } = {}) {
    try {
      let inputBuffer;
      if (Buffer.isBuffer(inputBufferOrPath)) {
        inputBuffer = inputBufferOrPath;
      } else if (typeof inputBufferOrPath === 'string' && fs.existsSync(inputBufferOrPath)) {
        inputBuffer = await fs.promises.readFile(inputBufferOrPath);
      } else {
        throw new Error('Invalid image input for watermarking');
      }

      const image = sharp(inputBuffer);
      const metadata = await image.metadata();
      const width = metadata.width || 800;
      const height = metadata.height || 800;

      // Do not stamp brand logo file in preview image
      const composites = [
        {
          input: this.generateWatermarkSvg(width, height),
          top: 0,
          left: 0,
          blend: 'over'
        }
      ];

      let pipeline = image.composite(composites);

      const outFormat = format || (metadata.format === 'png' ? 'png' : 'jpeg');
      if (outFormat === 'png') {
        pipeline = pipeline.png({ compressionLevel: 8, adaptiveFiltering: true });
      } else if (outFormat === 'webp') {
        pipeline = pipeline.webp({ quality });
      } else {
        pipeline = pipeline.jpeg({ quality, mozjpeg: true });
      }

      return await pipeline.toBuffer();
    } catch (err) {
      console.warn('[WatermarkService Warning]: Failed to apply watermark, returning original:', err.message);
      if (Buffer.isBuffer(inputBufferOrPath)) return inputBufferOrPath;
      return await fs.promises.readFile(inputBufferOrPath);
    }
  }
}

module.exports = new WatermarkService();
