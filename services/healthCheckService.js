const db = require('../config/db');
const storage = require('../config/storage');

class HealthCheckService {
  /**
   * Scans all designs in the database against physical/remote storage.
   * Returns a complete diagnostic summary.
   */
  async runHealthScan() {
    try {
      if (!db.isConnected()) {
        await db.initPool();
      }
    } catch (e) {
      console.warn('[HEALTH CHECK] db.initPool error:', e.message);
    }

    if (!db.isConnected()) {
      return {
        healthy: true,
        offlineDb: true,
        totalDesigns: 0,
        missingImagesCount: 0,
        missingFilesCount: 0,
        missingBothCount: 0,
        missingDesigns: []
      };
    }

    // 1. Fetch all active designs with their primary image and design files
    const designs = await db.query(`
      SELECT d.id, d.title, d.sku, d.slug, d.is_active, d.price, c.name AS category_name
      FROM designs d
      LEFT JOIN categories c ON d.category_id = c.id
      ORDER BY d.id DESC
    `);

    // 2. Fetch all images
    const images = await db.query(`
      SELECT id, design_id, image_url, is_primary
      FROM design_images
    `);

    // 3. Fetch all machine files
    const files = await db.query(`
      SELECT id, design_id, file_name, file_path, file_format, is_preview
      FROM design_files
      WHERE is_preview = 0
    `);

    // Map images by design_id
    const imageMap = {};
    for (const img of images) {
      if (!imageMap[img.design_id]) imageMap[img.design_id] = [];
      imageMap[img.design_id].push(img);
    }

    // Map files by design_id
    const fileMap = {};
    for (const f of files) {
      if (!fileMap[f.design_id]) fileMap[f.design_id] = [];
      fileMap[f.design_id].push(f);
    }

    const missingDesigns = [];
    let missingImagesCount = 0;
    let missingFilesCount = 0;
    let missingBothCount = 0;

    for (const d of designs) {
      const designImgs = imageMap[d.id] || [];
      const designFiles = fileMap[d.id] || [];

      // Check Image existence
      let hasValidImage = false;
      let primaryImgRecord = designImgs.find(i => i.is_primary) || designImgs[0];
      if (primaryImgRecord && primaryImgRecord.image_url) {
        hasValidImage = storage.fileExists(primaryImgRecord.image_url);
      }

      // Check Machine File existence
      let hasValidFile = false;
      let primaryFileRecord = designFiles[0];
      if (primaryFileRecord && primaryFileRecord.file_path) {
        hasValidFile = storage.fileExists(primaryFileRecord.file_path);
      }

      const isImageMissing = !hasValidImage;
      const isFileMissing = !hasValidFile;

      if (isImageMissing || isFileMissing) {
        if (isImageMissing && isFileMissing) missingBothCount++;
        else if (isImageMissing) missingImagesCount++;
        else if (isFileMissing) missingFilesCount++;

        missingDesigns.push({
          id: d.id,
          title: d.title,
          sku: d.sku || `AED-${d.id}`,
          slug: d.slug,
          category_name: d.category_name || 'Uncategorized',
          price: d.price,
          is_active: d.is_active,
          image_url: primaryImgRecord ? primaryImgRecord.image_url : null,
          image_missing: isImageMissing,
          file_name: primaryFileRecord ? primaryFileRecord.file_name : null,
          file_path: primaryFileRecord ? primaryFileRecord.file_path : null,
          file_missing: isFileMissing
        });
      }
    }

    const totalIssues = missingDesigns.length;
    const healthy = totalIssues === 0;

    return {
      healthy,
      scanTime: new Date().toISOString(),
      totalDesigns: designs.length,
      healthyDesignsCount: designs.length - totalIssues,
      totalIssues,
      missingImagesCount: missingImagesCount + missingBothCount,
      missingFilesCount: missingFilesCount + missingBothCount,
      missingBothCount,
      missingDesigns
    };
  }
}

module.exports = new HealthCheckService();
