const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const storage = require('../config/storage');

class HealthCheckService {
  /**
   * Checks file existence safely with async fs.promises.access wrapped in try/catch.
   * Returns 'ok', 'missing', or 'none'.
   */
  async checkAssetStatus(filePathOrUrl) {
    if (!filePathOrUrl || typeof filePathOrUrl !== 'string' || !filePathOrUrl.trim()) {
      return 'none'; // No file uploaded
    }
    try {
      const exists = await storage.fileExistsAsync(filePathOrUrl);
      return exists ? 'ok' : 'missing';
    } catch {
      return 'missing';
    }
  }

  /**
   * Retrieves paginated designs with their primary image and design file,
   * checking file existence on-the-fly for only that page in fast async batches.
   */
  async getPaginatedDesignsWithStatus({ page = 1, limit = 50, filter = 'all', search = '' }) {
    if (!db.isConnected()) {
      await db.initPool();
    }

    const offset = Math.max(0, (page - 1) * limit);
    const params = [];
    let whereClauses = [];

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      whereClauses.push('(d.title LIKE ? OR d.sku LIKE ? OR d.slug LIKE ?)');
      params.push(q, q, q);
    }

    const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    // 1. Get total design count
    const [countRow] = await db.query(`SELECT COUNT(*) AS total FROM designs d ${whereSql}`, params);
    const totalCount = countRow ? countRow.total : 0;

    // 2. Query design page with primary image and primary machine file
    const querySql = `
      SELECT 
        d.id, d.title, d.sku, d.slug, d.price, d.is_active,
        c.name AS category_name,
        (
          SELECT di.image_url 
          FROM design_images di 
          WHERE di.design_id = d.id 
          ORDER BY di.is_primary DESC, di.id ASC 
          LIMIT 1
        ) AS image_url,
        (
          SELECT df.file_path 
          FROM design_files df 
          WHERE df.design_id = d.id AND df.is_preview = 0 
          ORDER BY df.id ASC 
          LIMIT 1
        ) AS file_path,
        (
          SELECT df.file_name 
          FROM design_files df 
          WHERE df.design_id = d.id AND df.is_preview = 0 
          ORDER BY df.id ASC 
          LIMIT 1
        ) AS file_name
      FROM designs d
      LEFT JOIN categories c ON d.category_id = c.id
      ${whereSql}
      ORDER BY d.id DESC
      LIMIT ? OFFSET ?
    `;

    const queryParams = [...params, parseInt(limit, 10), parseInt(offset, 10)];
    const rawDesigns = await db.query(querySql, queryParams);

    // 3. Check existence asynchronously for the current 50 rows in parallel
    const checkedRows = await Promise.all(rawDesigns.map(async (row) => {
      const imageStatus = await this.checkAssetStatus(row.image_url);
      const fileStatus = await this.checkAssetStatus(row.file_path);

      const hasImageIssue = imageStatus === 'missing' || imageStatus === 'none';
      const hasFileIssue = fileStatus === 'missing' || fileStatus === 'none';
      const hasAnyIssue = hasImageIssue || hasFileIssue;

      return {
        id: row.id,
        title: row.title || 'Untitled Design',
        sku: row.sku || `AED-${row.id}`,
        slug: row.slug,
        price: row.price,
        is_active: row.is_active,
        category_name: row.category_name || 'Uncategorized',
        image_url: row.image_url || null,
        image_status: imageStatus,
        file_path: row.file_path || null,
        file_name: row.file_name || null,
        file_status: fileStatus,
        has_any_issue: hasAnyIssue,
        has_missing_both: (imageStatus === 'missing' || imageStatus === 'none') && (fileStatus === 'missing' || fileStatus === 'none')
      };
    }));

    // Filter in-memory for the requested filter if filtered view
    let finalRows = checkedRows;
    if (filter === 'missing_image') {
      finalRows = checkedRows.filter(r => r.image_status === 'missing');
    } else if (filter === 'missing_file') {
      finalRows = checkedRows.filter(r => r.file_status === 'missing');
    } else if (filter === 'no_upload') {
      finalRows = checkedRows.filter(r => r.image_status === 'none' || r.file_status === 'none');
    } else if (filter === 'issues') {
      finalRows = checkedRows.filter(r => r.has_any_issue);
    } else if (filter === 'healthy') {
      finalRows = checkedRows.filter(r => !r.has_any_issue);
    }

    const totalPages = Math.ceil(totalCount / limit) || 1;

    return {
      designs: finalRows,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    };
  }

  /**
   * Retrieves the latest completed background scan summary or falls back safely.
   */
  async getScanSummary() {
    if (!db.isConnected()) {
      await db.initPool();
    }

    try {
      const [lastJob] = await db.query(
        'SELECT * FROM scan_jobs ORDER BY id DESC LIMIT 1'
      );

      const [designCountRow] = await db.query('SELECT COUNT(*) AS total FROM designs');
      const totalDesigns = designCountRow ? designCountRow.total : 0;

      if (lastJob) {
        return {
          jobId: lastJob.id,
          status: lastJob.status,
          totalDesigns: lastJob.total_designs || totalDesigns,
          scannedDesigns: lastJob.scanned_designs,
          missingImages: lastJob.missing_images,
          missingFiles: lastJob.missing_files,
          missingBoth: lastJob.missing_both,
          healthyDesigns: Math.max(0, (lastJob.total_designs || totalDesigns) - (lastJob.missing_images + lastJob.missing_files - lastJob.missing_both)),
          startedAt: lastJob.started_at,
          completedAt: lastJob.completed_at
        };
      }

      return {
        jobId: null,
        status: 'idle',
        totalDesigns,
        scannedDesigns: 0,
        missingImages: 0,
        missingFiles: 0,
        missingBoth: 0,
        healthyDesigns: totalDesigns,
        startedAt: null,
        completedAt: null
      };
    } catch (err) {
      console.warn('[getScanSummary warning]:', err.message);
      return {
        jobId: null,
        status: 'idle',
        totalDesigns: 0,
        scannedDesigns: 0,
        missingImages: 0,
        missingFiles: 0,
        missingBoth: 0,
        healthyDesigns: 0,
        startedAt: null,
        completedAt: null
      };
    }
  }

  /**
   * Starts an asynchronous background integrity scan across ALL designs in batches.
   * Updates scan_jobs and file_scan_results tables so progress can be monitored in real time.
   */
  async triggerBackgroundScan() {
    if (!db.isConnected()) {
      await db.initPool();
    }

    // Check if an active scan is already running
    const [runningJob] = await db.query(
      "SELECT id FROM scan_jobs WHERE status = 'running' ORDER BY id DESC LIMIT 1"
    );
    if (runningJob) {
      return { success: false, message: 'A background scan is already in progress.', jobId: runningJob.id };
    }

    const [totalRow] = await db.query('SELECT COUNT(*) AS total FROM designs');
    const totalDesigns = totalRow ? totalRow.total : 0;

    // Create new job
    const insertRes = await db.query(
      "INSERT INTO scan_jobs (status, total_designs, scanned_designs, started_at) VALUES ('running', ?, 0, NOW())",
      [totalDesigns]
    );
    const jobId = insertRes.insertId;

    // Run detached in background (does not block caller)
    setImmediate(() => {
      this.executeScanJob(jobId, totalDesigns).catch(err => {
        console.error(`[Background Scan Job #${jobId} Error]:`, err);
      });
    });

    return { success: true, jobId, totalDesigns };
  }

  /**
   * Background runner worker
   */
  async executeScanJob(jobId, totalDesigns) {
    console.log(`[BACKGROUND SCAN] Starting Scan Job #${jobId} for ${totalDesigns} designs...`);
    const batchSize = 100;
    let offset = 0;
    let scannedCount = 0;
    let missingImagesCount = 0;
    let missingFilesCount = 0;
    let missingBothCount = 0;

    try {
      // Clear previous scan results to keep table fresh
      await db.query('TRUNCATE TABLE file_scan_results');

      while (offset < totalDesigns) {
        const rows = await db.query(`
          SELECT 
            d.id, d.title, d.sku, d.price, d.is_active,
            c.name AS category_name,
            (SELECT di.image_url FROM design_images di WHERE di.design_id = d.id ORDER BY di.is_primary DESC, di.id ASC LIMIT 1) AS image_url,
            (SELECT df.file_path FROM design_files df WHERE df.design_id = d.id AND df.is_preview = 0 ORDER BY df.id ASC LIMIT 1) AS file_path,
            (SELECT df.file_name FROM design_files df WHERE df.design_id = d.id AND df.is_preview = 0 ORDER BY df.id ASC LIMIT 1) AS file_name
          FROM designs d
          LEFT JOIN categories c ON d.category_id = c.id
          ORDER BY d.id ASC
          LIMIT ? OFFSET ?
        `, [batchSize, offset]);

        if (!rows || rows.length === 0) break;

        const evaluated = await Promise.all(rows.map(async (r) => {
          const imgStatus = await this.checkAssetStatus(r.image_url);
          const fileStatus = await this.checkAssetStatus(r.file_path);
          return {
            design_id: r.id,
            title: r.title || '',
            sku: r.sku || `AED-${r.id}`,
            category_name: r.category_name || 'Uncategorized',
            price: r.price || 0,
            is_active: r.is_active || 1,
            image_url: r.image_url,
            image_status: imgStatus,
            file_path: r.file_path,
            file_name: r.file_name,
            file_status: fileStatus
          };
        }));

        // Insert results in bulk
        if (evaluated.length > 0) {
          const valuePlaceholders = evaluated.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
          const params = [];
          for (const ev of evaluated) {
            params.push(
              ev.design_id, ev.title, ev.sku, ev.category_name, ev.price, ev.is_active,
              ev.image_url, ev.image_status, ev.file_path, ev.file_name, ev.file_status
            );

            const isImgMissing = ev.image_status === 'missing' || ev.image_status === 'none';
            const isFileMissing = ev.file_status === 'missing' || ev.file_status === 'none';

            if (isImgMissing && isFileMissing) missingBothCount++;
            else if (isImgMissing) missingImagesCount++;
            else if (isFileMissing) missingFilesCount++;
          }

          await db.query(`
            INSERT INTO file_scan_results 
              (design_id, title, sku, category_name, price, is_active, image_url, image_status, file_path, file_name, file_status)
            VALUES ${valuePlaceholders}
          `, params);
        }

        scannedCount += rows.length;
        offset += batchSize;

        // Update progress in scan_jobs
        await db.query(
          'UPDATE scan_jobs SET scanned_designs = ?, missing_images = ?, missing_files = ?, missing_both = ? WHERE id = ?',
          [scannedCount, missingImagesCount + missingBothCount, missingFilesCount + missingBothCount, missingBothCount, jobId]
        );
      }

      await db.query(
        "UPDATE scan_jobs SET status = 'completed', completed_at = NOW(), scanned_designs = ? WHERE id = ?",
        [scannedCount, jobId]
      );
      console.log(`[BACKGROUND SCAN SUCCESS] Job #${jobId} completed: ${scannedCount} designs scanned.`);

    } catch (err) {
      console.error(`[BACKGROUND SCAN ERROR] Job #${jobId}:`, err);
      await db.query(
        "UPDATE scan_jobs SET status = 'failed', error_message = ?, completed_at = NOW() WHERE id = ?",
        [err.message, jobId]
      );
    }
  }

  /**
   * Fast summary for dashboard banner
   */
  async runHealthScan() {
    const summary = await this.getScanSummary();
    const totalIssues = summary.missingImages + summary.missingFiles - summary.missingBoth;
    return {
      healthy: totalIssues === 0,
      totalDesigns: summary.totalDesigns,
      healthyDesignsCount: summary.healthyDesigns,
      missingImagesCount: summary.missingImages,
      missingFilesCount: summary.missingFiles,
      missingBothCount: summary.missingBoth,
      totalIssues,
      scanTime: summary.completedAt ? summary.completedAt.toISOString() : new Date().toISOString()
    };
  }
}

module.exports = new HealthCheckService();
