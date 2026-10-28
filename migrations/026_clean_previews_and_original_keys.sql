-- Migration 026: Add original_key to design_images and needs_reupload to designs
-- Idempotent, safe for MariaDB 10.2+ and MySQL 5.7+, no reserved words, no data loss.

-- 1. Add original_key to design_images
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'design_images' AND COLUMN_NAME = 'original_key');
SET @sql := IF(@exist = 0, 'ALTER TABLE `design_images` ADD COLUMN `original_key` VARCHAR(500) NULL DEFAULT NULL AFTER `card_key`', 'SELECT "Column original_key already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Add needs_reupload to designs
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'designs' AND COLUMN_NAME = 'needs_reupload');
SET @sql := IF(@exist = 0, 'ALTER TABLE `designs` ADD COLUMN `needs_reupload` TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_active`', 'SELECT "Column needs_reupload already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. Add original_image_url to designs
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'designs' AND COLUMN_NAME = 'original_image_url');
SET @sql := IF(@exist = 0, 'ALTER TABLE `designs` ADD COLUMN `original_image_url` VARCHAR(500) NULL DEFAULT NULL AFTER `primary_image`', 'SELECT "Column original_image_url already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4. Add index on designs(needs_reupload)
SET @idx_exist := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'designs' AND INDEX_NAME = 'idx_designs_needs_reupload');
SET @sql := IF(@idx_exist = 0, 'ALTER TABLE `designs` ADD INDEX `idx_designs_needs_reupload` (`needs_reupload`)', 'SELECT "Index already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
