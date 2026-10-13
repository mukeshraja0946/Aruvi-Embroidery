-- ============================================================================
-- Migration: 013_add_import_zip_filename_to_designs.sql
-- Purpose: Add import_zip_filename to designs table & checksum to design_files
-- Idempotent & safe for MariaDB (Hostinger) and MySQL
-- ============================================================================

-- 1. Add import_zip_filename to designs if not already exists
SET @dbname = DATABASE();
SET @tablename = 'designs';
SET @columnname = 'import_zip_filename';

SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname
      AND TABLE_NAME = @tablename
      AND COLUMN_NAME = @columnname
  ) > 0,
  'SELECT 1',
  'ALTER TABLE `designs` ADD COLUMN `import_zip_filename` VARCHAR(255) DEFAULT NULL AFTER `import_image_filename`'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 2. Add index on import_zip_filename if not exists
SET @indexname = 'idx_designs_import_zip_filename';

SET @preparedStatementIdx = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = @dbname
      AND TABLE_NAME = @tablename
      AND INDEX_NAME = @indexname
  ) > 0,
  'SELECT 1',
  'ALTER TABLE `designs` ADD INDEX `idx_designs_import_zip_filename` (`import_zip_filename`)'
));
PREPARE alterIdxIfNotExists FROM @preparedStatementIdx;
EXECUTE alterIdxIfNotExists;
DEALLOCATE PREPARE alterIdxIfNotExists;

-- 3. Add checksum to design_files if not already exists
SET @tablename2 = 'design_files';
SET @columnname2 = 'checksum';

SET @preparedStatementFile = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname
      AND TABLE_NAME = @tablename2
      AND COLUMN_NAME = @columnname2
  ) > 0,
  'SELECT 1',
  'ALTER TABLE `design_files` ADD COLUMN `checksum` VARCHAR(64) DEFAULT NULL AFTER `file_size`'
));
PREPARE alterFileColIfNotExists FROM @preparedStatementFile;
EXECUTE alterFileColIfNotExists;
DEALLOCATE PREPARE alterFileColIfNotExists;
