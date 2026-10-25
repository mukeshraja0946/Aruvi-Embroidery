-- ============================================================
-- Migration 015: Add stitch counts (front, back, sleeve) to designs table
-- Safe and idempotent: Never drops tables or deletes existing data.
-- ============================================================

SET @dbname = DATABASE();

-- 1. designs.stitch_count_front
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns 
WHERE table_schema = @dbname AND table_name = 'designs' AND column_name = 'stitch_count_front';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `stitch_count_front` INT DEFAULT NULL AFTER `stitch_count`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. designs.stitch_count_back
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns 
WHERE table_schema = @dbname AND table_name = 'designs' AND column_name = 'stitch_count_back';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `stitch_count_back` INT DEFAULT NULL AFTER `stitch_count_front`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. designs.stitch_count_sleeve
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns 
WHERE table_schema = @dbname AND table_name = 'designs' AND column_name = 'stitch_count_sleeve';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `stitch_count_sleeve` INT DEFAULT NULL AFTER `stitch_count_back`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4. Ensure designs.description exists
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns 
WHERE table_schema = @dbname AND table_name = 'designs' AND column_name = 'description';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `description` TEXT DEFAULT NULL AFTER `slug`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
