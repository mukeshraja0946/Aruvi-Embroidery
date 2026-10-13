-- Migration 011: Safely rename reserved keyword column row_number to row_no in import_job_items
-- Compatible with MariaDB 10.x and MySQL 8.x
-- Fully idempotent: checks information_schema first, never drops data or tables.

SET @dbname = DATABASE();

-- 1. Check if import_job_items table exists
SET @table_exists = 0;
SELECT COUNT(*) INTO @table_exists 
FROM information_schema.tables 
WHERE table_schema = @dbname AND table_name = 'import_job_items';

-- 2. Check if legacy row_number column exists
SET @legacy_col_exists = 0;
SELECT COUNT(*) INTO @legacy_col_exists 
FROM information_schema.columns 
WHERE table_schema = @dbname AND table_name = 'import_job_items' AND column_name = 'row_number';

-- 3. Check if new row_no column exists
SET @new_col_exists = 0;
SELECT COUNT(*) INTO @new_col_exists 
FROM information_schema.columns 
WHERE table_schema = @dbname AND table_name = 'import_job_items' AND column_name = 'row_no';

-- 4. If table exists and row_number exists but row_no does not, rename safely using CHANGE COLUMN
SET @rename_query = IF(
  @table_exists > 0 AND @legacy_col_exists > 0 AND @new_col_exists = 0,
  'ALTER TABLE `import_job_items` CHANGE COLUMN `row_number` `row_no` INT NOT NULL',
  'SELECT 1'
);
PREPARE stmt_rename FROM @rename_query;
EXECUTE stmt_rename;
DEALLOCATE PREPARE stmt_rename;

-- 5. If table exists and neither column exists, add row_no safely
SET @add_query = IF(
  @table_exists > 0 AND @legacy_col_exists = 0 AND @new_col_exists = 0,
  'ALTER TABLE `import_job_items` ADD COLUMN `row_no` INT NOT NULL AFTER `job_id`',
  'SELECT 1'
);
PREPARE stmt_add FROM @add_query;
EXECUTE stmt_add;
DEALLOCATE PREPARE stmt_add;
