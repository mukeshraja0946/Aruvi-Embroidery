/**
 * Duplicate Files Detection, Cleanup, Backup, and Undo Service
 * Provides dry-run reports, safe automated cleanup (lowest id kept, download_logs remapped,
 * physical files unlinked only if no other row references the same storage_key),
 * 7-day undo functionality, and plain SQL queries for phpMyAdmin.
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const storage = require('../config/storage');
const ActivityLog = require('../models/ActivityLog');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');

class DuplicateFilesService {
  /**
   * Get Dry-Run Report of duplicates in design_files and design_images
   */
  static async getDryRunReport() {
    try {
      await db.query('SELECT 1');
    } catch (_) {}

    if (!db.isConnected()) {
      return {
        success: false,
        message: 'Database not connected',
        designFilesDuplicates: [],
        designImagesDuplicates: [],
        totalAffectedDesigns: 0,
        totalFilesToRemove: 0,
        totalImagesToRemove: 0,
        totalSpaceToFreeBytes: 0,
        plainSql: this.getPhpMyAdminSql()
      };
    }

    // 1. Group design_files duplicates by (design_id, storage_key) or (design_id, checksum_sha256) or (design_id, original_name, file_size)
    const allFiles = await db.query(`
      SELECT df.id, df.design_id, df.file_kind, df.label, df.original_name, df.storage_key,
             df.file_size, df.checksum_sha256, df.sort_order, df.is_preview, df.created_at,
             d.title as design_title, d.sku as design_sku
      FROM design_files df
      JOIN designs d ON df.design_id = d.id
      ORDER BY df.design_id ASC, df.sort_order ASC, df.id ASC
    `);

    // Group files by unique signature per design
    // Group files by design to find clusters of identical files
    const designMap = {};
    for (const f of allFiles) {
      if (!designMap[f.design_id]) designMap[f.design_id] = [];
      designMap[f.design_id].push(f);
    }

    const designFilesDuplicates = [];
    const affectedDesignIds = new Set();
    let totalFilesToRemove = 0;
    let totalSpaceToFreeBytes = 0;

    for (const [designId, files] of Object.entries(designMap)) {
      const assigned = new Set();
      for (let i = 0; i < files.length; i++) {
        if (assigned.has(files[i].id)) continue;
        const cluster = [files[i]];
        assigned.add(files[i].id);

        for (let j = i + 1; j < files.length; j++) {
          if (assigned.has(files[j].id)) continue;
          const a = files[i];
          const b = files[j];

          const sameStorage = a.storage_key && b.storage_key && a.storage_key === b.storage_key;
          const sameChecksum = a.checksum_sha256 && b.checksum_sha256 && a.checksum_sha256 === b.checksum_sha256;
          const sameNameAndSize = a.original_name && b.original_name && a.original_name === b.original_name && a.file_size && b.file_size && a.file_size === b.file_size;

          if (sameStorage || sameChecksum || sameNameAndSize) {
            cluster.push(b);
            assigned.add(b.id);
          }
        }

        if (cluster.length > 1) {
          cluster.sort((x, y) => x.id - y.id);
          const kept = cluster[0];
          const duplicates = cluster.slice(1);

          affectedDesignIds.add(kept.design_id);
          totalFilesToRemove += duplicates.length;

          for (const dup of duplicates) {
            totalSpaceToFreeBytes += parseInt(dup.file_size || 0, 10);
          }

          designFilesDuplicates.push({
            groupKey: `cluster_${kept.design_id}_${kept.id}`,
            designId: kept.design_id,
            designTitle: kept.design_title,
            designSku: kept.design_sku,
            fileKind: kept.file_kind,
            originalName: kept.original_name,
            keptRow: kept,
            duplicatesToRemove: duplicates
          });
        }
      }
    }

    // 2. Group design_images duplicates by (design_id, image_url)
    const allImages = await db.query(`
      SELECT di.id, di.design_id, di.image_url, di.is_primary, di.display_order,
             d.title as design_title, d.sku as design_sku
      FROM design_images di
      JOIN designs d ON di.design_id = d.id
      ORDER BY di.design_id ASC, di.display_order ASC, di.id ASC
    `);

    const imagesGrouped = {};
    for (const img of allImages) {
      const key = `img_${img.design_id}_${img.image_url}`;
      if (!imagesGrouped[key]) imagesGrouped[key] = [];
      imagesGrouped[key].push(img);
    }

    const designImagesDuplicates = [];
    let totalImagesToRemove = 0;

    for (const [groupKey, rows] of Object.entries(imagesGrouped)) {
      if (rows.length > 1) {
        rows.sort((a, b) => a.id - b.id);
        const kept = rows[0];
        const duplicates = rows.slice(1);

        affectedDesignIds.add(kept.design_id);
        totalImagesToRemove += duplicates.length;

        designImagesDuplicates.push({
          groupKey,
          designId: kept.design_id,
          designTitle: kept.design_title,
          designSku: kept.design_sku,
          imageUrl: kept.image_url,
          keptRow: kept,
          duplicatesToRemove: duplicates
        });
      }
    }

    return {
      success: true,
      designFilesDuplicates,
      designImagesDuplicates,
      totalAffectedDesigns: affectedDesignIds.size,
      totalFilesToRemove,
      totalImagesToRemove,
      totalSpaceToFreeBytes,
      totalSpaceToFreeFormatted: (totalSpaceToFreeBytes / (1024 * 1024)).toFixed(2) + ' MB',
      plainSql: this.getPhpMyAdminSql()
    };
  }

  /**
   * Safe Cleanup of Duplicate Files & Images
   * - Performs dry-run calculation
   * - Generates SQL backup of design_files and design_images before deletion
   * - Remaps download_logs to lowest kept ID
   * - Deletes duplicate DB rows
   * - Unlinks physical files ONLY IF no remaining row uses that storage_key
   * - Logs action and stores 7-day undo record
   */
  static async cleanDuplicates({ adminId = null, adminEmail = 'admin' } = {}) {
    const report = await this.getDryRunReport();
    if (!report.success) throw new Error(report.message);

    if (report.totalFilesToRemove === 0 && report.totalImagesToRemove === 0) {
      return {
        success: true,
        message: 'No duplicates found. Database is already clean.',
        affectedDesignsCount: 0,
        removedFilesCount: 0,
        removedImagesCount: 0,
        spaceFreedBytes: 0,
        backupFile: null
      };
    }

    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    // 1. Create SQL Backup of design_files & design_images
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `duplicate_files_backup_${timestamp}.sql`;
    const backupFilePath = path.join(BACKUP_DIR, backupFileName);

    const allDesignFiles = await db.query('SELECT * FROM design_files');
    const allDesignImages = await db.query('SELECT * FROM design_images');

    let backupSql = `-- Duplicate Files Cleanup Backup\n-- Created: ${new Date().toISOString()}\nSET FOREIGN_KEY_CHECKS = 0;\n`;

    if (allDesignFiles.length > 0) {
      const cols = Object.keys(allDesignFiles[0]);
      for (const row of allDesignFiles) {
        const vals = cols.map(c => row[c] === null ? 'NULL' : `'${String(row[c]).replace(/'/g, "''").replace(/\\/g, '\\\\')}'`);
        backupSql += `REPLACE INTO \`design_files\` (\`${cols.join('`, `')}\`) VALUES (${vals.join(', ')});\n`;
      }
    }

    if (allDesignImages.length > 0) {
      const cols = Object.keys(allDesignImages[0]);
      for (const row of allDesignImages) {
        const vals = cols.map(c => row[c] === null ? 'NULL' : `'${String(row[c]).replace(/'/g, "''").replace(/\\/g, '\\\\')}'`);
        backupSql += `REPLACE INTO \`design_images\` (\`${cols.join('`, `')}\`) VALUES (${vals.join(', ')});\n`;
      }
    }
    backupSql += `SET FOREIGN_KEY_CHECKS = 1;\n`;

    fs.writeFileSync(backupFilePath, backupSql, 'utf8');

    // Also write a metadata manifest for 7-day undo
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const manifestPath = path.join(BACKUP_DIR, `duplicate_files_manifest_${timestamp}.json`);
    const manifest = {
      backupFileName,
      timestamp,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      adminEmail,
      removedFilesCount: report.totalFilesToRemove,
      removedImagesCount: report.totalImagesToRemove,
      spaceFreedBytes: report.totalSpaceToFreeBytes
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    // 2. Perform DB Remapping & Deletion
    const fileIdsToRemove = [];
    const imageIdsToRemove = [];
    const candidatePhysicalKeys = [];

    for (const group of report.designFilesDuplicates) {
      const keptId = group.keptRow.id;
      for (const dup of group.duplicatesToRemove) {
        fileIdsToRemove.push(dup.id);
        candidatePhysicalKeys.push(dup.storage_key || dup.file_path);

        // Remap download_logs
        try {
          await db.query('UPDATE download_logs SET file_id = ? WHERE file_id = ?', [keptId, dup.id]);
        } catch (_) {}
      }
    }

    for (const group of report.designImagesDuplicates) {
      for (const dup of group.duplicatesToRemove) {
        imageIdsToRemove.push(dup.id);
      }
    }

    // Delete duplicate rows in design_files
    if (fileIdsToRemove.length > 0) {
      const placeholders = fileIdsToRemove.map(() => '?').join(',');
      await db.query(`DELETE FROM design_files WHERE id IN (${placeholders})`, fileIdsToRemove);
    }

    // Delete duplicate rows in design_images
    if (imageIdsToRemove.length > 0) {
      const placeholders = imageIdsToRemove.map(() => '?').join(',');
      await db.query(`DELETE FROM design_images WHERE id IN (${placeholders})`, imageIdsToRemove);
    }

    // 3. Delete Physical Files safely ONLY IF no remaining row uses the key
    let physicalFilesDeleted = 0;
    for (const rawKey of candidatePhysicalKeys) {
      if (!rawKey) continue;
      const [remaining] = await db.query(
        'SELECT COUNT(*) as count FROM design_files WHERE storage_key = ? OR file_path = ?',
        [rawKey, rawKey]
      );
      if (remaining && remaining.count === 0) {
        const fullPath = storage.resolveFilePath(rawKey);
        if (fullPath && fs.existsSync(fullPath)) {
          // Never delete shared system assets or defaults
          if (
            !fullPath.includes('logo.jpg') &&
            !fullPath.includes('cat_') &&
            !fullPath.includes('hero_')
          ) {
            try {
              fs.unlinkSync(fullPath);
              physicalFilesDeleted++;
            } catch (err) {
              console.warn('[cleanDuplicates] Could not delete physical file:', fullPath, err.message);
            }
          }
        }
      }
    }

    // Log Activity
    try {
      await ActivityLog.log({
        userId: adminId,
        adminName: adminEmail,
        action: 'CLEAN_DUPLICATE_FILES',
        entityType: 'TOOLS',
        details: `Removed ${fileIdsToRemove.length} duplicate file rows, ${imageIdsToRemove.length} duplicate image rows across ${report.totalAffectedDesigns} designs. Backup saved as ${backupFileName}.`
      });
    } catch (_) {}

    return {
      success: true,
      message: `Successfully removed ${fileIdsToRemove.length} duplicate files and ${imageIdsToRemove.length} duplicate images. Backup saved.`,
      affectedDesignsCount: report.totalAffectedDesigns,
      removedFilesCount: fileIdsToRemove.length,
      removedImagesCount: imageIdsToRemove.length,
      physicalFilesDeleted,
      spaceFreedBytes: report.totalSpaceToFreeBytes,
      backupFileName,
      expiresAt: expiresAt.toISOString()
    };
  }

  /**
   * List available cleanup backups with undo availability (within 7 days)
   */
  static listCleanups() {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    const files = fs.readdirSync(BACKUP_DIR);
    const manifests = files.filter(f => f.startsWith('duplicate_files_manifest_') && f.endsWith('.json'));

    const cleanups = [];
    for (const m of manifests) {
      try {
        const raw = fs.readFileSync(path.join(BACKUP_DIR, m), 'utf8');
        const data = JSON.parse(raw);
        const expiresAt = new Date(data.expiresAt);
        const isExpired = Date.now() > expiresAt.getTime();
        const sqlExists = fs.existsSync(path.join(BACKUP_DIR, data.backupFileName));
        cleanups.push({
          ...data,
          manifestFile: m,
          canUndo: !isExpired && sqlExists,
          isExpired
        });
      } catch (_) {}
    }

    cleanups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return cleanups;
  }

  /**
   * Revert / Undo a Duplicate Cleanup within 7 days
   */
  static async undoCleanup(backupFileName) {
    if (!backupFileName) throw new Error('Backup file name is required.');
    const safeName = path.basename(backupFileName);
    const backupFilePath = path.join(BACKUP_DIR, safeName);

    if (!fs.existsSync(backupFilePath)) {
      throw new Error(`Backup file "${safeName}" not found.`);
    }

    // Check 7-day expiration from manifest if present
    const manifestName = safeName.replace('duplicate_files_backup_', 'duplicate_files_manifest_').replace('.sql', '.json');
    const manifestPath = path.join(BACKUP_DIR, manifestName);
    if (fs.existsSync(manifestPath)) {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (Date.now() > new Date(m.expiresAt).getTime()) {
        throw new Error('This cleanup backup has expired (retention is 7 days).');
      }
    }

    const sqlContent = fs.readFileSync(backupFilePath, 'utf8');
    const statements = sqlContent
      .split(';\n')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    let restoredRows = 0;
    try {
      for (const stmt of statements) {
        if (stmt.toUpperCase().startsWith('REPLACE') || stmt.toUpperCase().startsWith('INSERT')) {
          restoredRows++;
        }
        await db.query(stmt);
      }
    } finally {
      await db.query('SET FOREIGN_KEY_CHECKS = 1');
    }

    return {
      success: true,
      restoredRows,
      message: `Successfully restored ${restoredRows} records from backup.`
    };
  }

  /**
   * Plain SQL for phpMyAdmin Execution
   */
  static getPhpMyAdminSql() {
    return `-- ============================================================================
-- SQL TO CLEAN DUPLICATE FILES AND IMAGES IN phpMyAdmin
-- Keeps the lowest id of each group, remaps download_logs, and deletes duplicates
-- ============================================================================

-- 1. Remap download_logs to lowest design_files ID
UPDATE download_logs dl
JOIN (
  SELECT df.id as duplicate_id, kept.min_id as target_id
  FROM design_files df
  JOIN (
    SELECT design_id, storage_key, MIN(id) as min_id
    FROM design_files
    WHERE storage_key IS NOT NULL AND storage_key != ''
    GROUP BY design_id, storage_key
    HAVING COUNT(*) > 1
  ) kept ON df.design_id = kept.design_id AND df.storage_key = kept.storage_key
  WHERE df.id != kept.min_id
) map ON dl.file_id = map.duplicate_id
SET dl.file_id = map.target_id;

-- 2. Delete duplicate rows from design_files (keeping lowest ID)
DELETE df FROM design_files df
JOIN (
  SELECT design_id, storage_key, MIN(id) as min_id
  FROM design_files
  WHERE storage_key IS NOT NULL AND storage_key != ''
  GROUP BY design_id, storage_key
  HAVING COUNT(*) > 1
) kept ON df.design_id = kept.design_id AND df.storage_key = kept.storage_key
WHERE df.id != kept.min_id;

-- 3. Delete duplicate rows by checksum_sha256 from design_files
DELETE df FROM design_files df
JOIN (
  SELECT design_id, checksum_sha256, MIN(id) as min_id
  FROM design_files
  WHERE checksum_sha256 IS NOT NULL AND checksum_sha256 != ''
  GROUP BY design_id, checksum_sha256
  HAVING COUNT(*) > 1
) kept ON df.design_id = kept.design_id AND df.checksum_sha256 = kept.checksum_sha256
WHERE df.id != kept.min_id;

-- 4. Delete duplicate rows from design_images (keeping lowest ID)
DELETE di FROM design_images di
JOIN (
  SELECT design_id, image_url, MIN(id) as min_id
  FROM design_images
  GROUP BY design_id, image_url
  HAVING COUNT(*) > 1
) kept ON di.design_id = kept.design_id AND di.image_url = kept.image_url
WHERE di.id != kept.min_id;

-- 5. Add UNIQUE constraint to prevent future duplicate inserts on same design
-- (Only for design_files where checksum_sha256 IS NOT NULL)
ALTER TABLE design_files ADD UNIQUE INDEX idx_design_file_unique (design_id, checksum_sha256);
`;
  }
}

module.exports = DuplicateFilesService;
