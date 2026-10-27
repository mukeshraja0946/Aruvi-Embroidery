const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const storage = require('../config/storage');

class BrokenImageService {
  /**
   * Dry-run scan to identify broken/missing rows in design_images and design_files
   */
  async getBrokenImageRowsDryRun() {
    if (!db.isConnected()) {
      await db.initPool();
    }

    // 1. Fetch all rows in design_images
    const rows = (await db.query(`
      SELECT di.id, di.design_id, di.image_url, di.is_primary, di.display_order,
             d.sku, d.title, d.category_id
      FROM design_images di
      LEFT JOIN designs d ON di.design_id = d.id
      ORDER BY di.design_id ASC, di.is_primary DESC, di.id ASC
    `)) || [];

    const brokenRows = [];
    const validRows = [];
    const duplicateRows = [];
    const seenMap = new Map();

    for (const r of rows) {
      const url = r.image_url ? String(r.image_url).trim() : '';
      if (!url || url === 'undefined' || url === 'null') {
        brokenRows.push({ ...r, reason: 'Empty or invalid URL' });
        continue;
      }

      // Check duplicates for same design + same url
      const key = `${r.design_id}_${url.toLowerCase()}`;
      if (seenMap.has(key)) {
        duplicateRows.push({ ...r, reason: 'Duplicate row for same image URL' });
        continue;
      }
      seenMap.set(key, r.id);

      // Verify physical file existence
      const exists = await storage.fileExistsAsync(url);
      if (!exists) {
        brokenRows.push({ ...r, reason: 'Physical file missing on server' });
      } else {
        validRows.push(r);
      }
    }

    // 2. Scan design_files for preview records whose file is missing
    const previewFiles = (await db.query(`
      SELECT df.id, df.design_id, df.file_path, df.file_name, df.storage_key,
             d.sku, d.title
      FROM design_files df
      LEFT JOIN designs d ON df.design_id = d.id
      WHERE df.is_preview = 1 OR df.file_kind = 'image'
    `)) || [];

    const brokenPreviewFiles = [];
    for (const f of previewFiles) {
      const target = f.storage_key || f.file_path;
      if (!target) {
        brokenPreviewFiles.push({ ...f, reason: 'Empty file path' });
      } else {
        const exists = await storage.fileExistsAsync(target);
        if (!exists) {
          brokenPreviewFiles.push({ ...f, reason: 'Physical preview file missing' });
        }
      }
    }

    return {
      summary: {
        totalRowsChecked: rows.length,
        brokenRowsCount: brokenRows.length,
        duplicateRowsCount: duplicateRows.length,
        brokenPreviewFilesCount: brokenPreviewFiles.length,
        validRowsCount: validRows.length
      },
      brokenRows,
      duplicateRows,
      brokenPreviewFiles
    };
  }

  /**
   * Generates a plain SQL string that the user can copy-paste directly into phpMyAdmin.
   */
  generatePhpMyAdminSql(brokenRowIds = [], duplicateRowIds = []) {
    const timestamp = new Date().toISOString();
    let sql = `-- ==========================================================\n`;
    sql += `-- Aruvi Embroidery — Cleanup Broken & Duplicate design_images\n`;
    sql += `-- Generated on: ${timestamp}\n`;
    sql += `-- IMPORTANT: In phpMyAdmin, export your 'design_images' table first as a backup!\n`;
    sql += `-- ==========================================================\n\n`;

    sql += `-- 1. Remove obvious invalid or null URLs\n`;
    sql += `DELETE FROM \`design_images\` \nWHERE \`image_url\` IS NULL \n   OR TRIM(\`image_url\`) = '' \n   OR \`image_url\` LIKE '%undefined%' \n   OR \`image_url\` LIKE '%null%';\n\n`;

    sql += `-- 2. Remove duplicate rows for same design & image_url (keeping lowest ID)\n`;
    sql += `DELETE di FROM \`design_images\` di\nJOIN \`design_images\` di2 ON di.design_id = di2.design_id AND di.id > di2.id\nWHERE di.image_url = di2.image_url;\n\n`;

    if (brokenRowIds.length > 0) {
      const chunks = [];
      for (let i = 0; i < brokenRowIds.length; i += 200) {
        chunks.push(brokenRowIds.slice(i, i + 200).join(', '));
      }
      sql += `-- 3. Delete specifically identified broken rows with missing physical files (${brokenRowIds.length} rows)\n`;
      for (const chunk of chunks) {
        sql += `DELETE FROM \`design_images\` WHERE \`id\` IN (${chunk});\n`;
      }
      sql += `\n`;
    }

    sql += `-- 4. Synchronize designs.primary_image with the top valid primary row\n`;
    sql += `UPDATE \`designs\` d\nJOIN (\n  SELECT design_id, image_url\n  FROM (\n    SELECT design_id, image_url, ROW_NUMBER() OVER (PARTITION BY design_id ORDER BY is_primary DESC, id ASC) as rn\n    FROM \`design_images\`\n  ) ordered\n  WHERE ordered.rn = 1\n) top_img ON d.id = top_img.design_id\nSET d.primary_image = top_img.image_url;\n\n`;

    sql += `-- 5. Clean orphan designs.primary_image where no row exists\n`;
    sql += `UPDATE \`designs\` d\nLEFT JOIN \`design_images\` di ON d.id = di.design_id\nSET d.primary_image = NULL\nWHERE di.id IS NULL AND (d.primary_image IS NOT NULL AND d.primary_image NOT LIKE '/public/images/%');\n`;

    return sql;
  }

  /**
   * One-click removal of broken image rows with automatic SQL backup
   */
  async removeBrokenImageRows() {
    const dryRun = await this.getBrokenImageRowsDryRun();
    const rowsToDelete = [...dryRun.brokenRows, ...dryRun.duplicateRows];

    if (rowsToDelete.length === 0 && dryRun.brokenPreviewFiles.length === 0) {
      return {
        success: true,
        message: 'No broken image rows found. Catalog is clean!',
        removedCount: 0,
        phpMyAdminSql: this.generatePhpMyAdminSql([], [])
      };
    }

    const rowIds = rowsToDelete.map(r => r.id);
    const previewFileIds = dryRun.brokenPreviewFiles.map(f => f.id);

    // Create SQL Backup file
    const backupsDir = path.resolve(__dirname, '..', 'backups');
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

    const backupFileName = `backup_broken_images_${Date.now()}.sql`;
    const backupFilePath = path.join(backupsDir, backupFileName);

    let backupSql = `-- Backup of broken/duplicate design_images before deletion\n-- Date: ${new Date().toISOString()}\n\n`;
    if (rowIds.length > 0) {
      const backupData = await db.query(`SELECT * FROM design_images WHERE id IN (${rowIds.join(',')})`);
      for (const row of backupData) {
        backupSql += `REPLACE INTO \`design_images\` (\`id\`, \`design_id\`, \`image_url\`, \`is_primary\`, \`display_order\`) VALUES (${row.id}, ${row.design_id}, ${db.escape(row.image_url)}, ${row.is_primary}, ${row.display_order});\n`;
      }
    }
    fs.writeFileSync(backupFilePath, backupSql, 'utf8');

    // Delete broken rows in design_images
    if (rowIds.length > 0) {
      await db.query(`DELETE FROM design_images WHERE id IN (${rowIds.join(',')})`);
    }

    // Delete broken rows in design_files
    if (previewFileIds.length > 0) {
      await db.query(`DELETE FROM design_files WHERE id IN (${previewFileIds.join(',')})`);
    }

    // Repair primary flags on affected designs
    const affectedDesignIds = [...new Set(rowsToDelete.map(r => r.design_id))];
    for (const dId of affectedDesignIds) {
      const remaining = await db.query(
        'SELECT id, image_url FROM design_images WHERE design_id = ? ORDER BY is_primary DESC, id ASC',
        [dId]
      );
      if (remaining && remaining.length > 0) {
        await db.query('UPDATE design_images SET is_primary = 1 WHERE id = ?', [remaining[0].id]);
        try {
          await db.query('UPDATE designs SET primary_image = ? WHERE id = ?', [remaining[0].image_url, dId]);
        } catch (_) {}
      } else {
        try {
          await db.query('UPDATE designs SET primary_image = NULL WHERE id = ?', [dId]);
        } catch (_) {}
      }
    }

    const phpMyAdminSql = this.generatePhpMyAdminSql(
      dryRun.brokenRows.map(r => r.id),
      dryRun.duplicateRows.map(r => r.id)
    );

    return {
      success: true,
      removedCount: rowIds.length,
      removedPreviewFilesCount: previewFileIds.length,
      backupFile: backupFileName,
      phpMyAdminSql
    };
  }
}

module.exports = new BrokenImageService();
