-- ============================================================================
-- Migration: 012_add_import_image_filename_to_designs.sql
-- Purpose: Add import_image_filename to designs table for spreadsheet-to-asset linking
-- Idempotent & safe for MariaDB (Hostinger) and MySQL
-- ============================================================================

-- Add import_image_filename column if it does not already exist
SET @dbname = DATABASE();
SET @tablename = 'designs';
SET @columnname = 'import_image_filename';

SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname
      AND TABLE_NAME = @tablename
      AND COLUMN_NAME = @columnname
  ) > 0,
  'SELECT 1',
  'ALTER TABLE `designs` ADD COLUMN `import_image_filename` VARCHAR(255) DEFAULT NULL AFTER `sku`;'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Add index on import_image_filename if not exists
SET @indexname = 'idx_designs_import_image_filename';

SET @preparedStatementIdx = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = @dbname
      AND TABLE_NAME = @tablename
      AND INDEX_NAME = @indexname
  ) > 0,
  'SELECT 1',
  'ALTER TABLE `designs` ADD INDEX `idx_designs_import_image_filename` (`import_image_filename`);'
));
PREPARE alterIdxIfNotExists FROM @preparedStatementIdx;
EXECUTE alterIdxIfNotExists;
DEALLOCATE PREPARE alterIdxIfNotExists;
