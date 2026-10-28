-- Migration 024: Add thumb_key, card_key, and version to design_images and sync columns on designs
-- Idempotent, safe for MariaDB 10.2+ and MySQL 5.7+, no reserved words, no data loss.

-- 1. Add thumb_key (300px thumbnail key) to design_images
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'design_images' AND COLUMN_NAME = 'thumb_key');
SET @sql := IF(@exist = 0, 'ALTER TABLE `design_images` ADD COLUMN `thumb_key` VARCHAR(500) NULL DEFAULT NULL AFTER `image_url`', 'SELECT "Column thumb_key already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Add card_key (600px card preview key) to design_images
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'design_images' AND COLUMN_NAME = 'card_key');
SET @sql := IF(@exist = 0, 'ALTER TABLE `design_images` ADD COLUMN `card_key` VARCHAR(500) NULL DEFAULT NULL AFTER `thumb_key`', 'SELECT "Column card_key already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. Ensure designs table has primary_image column
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'designs' AND COLUMN_NAME = 'primary_image');
SET @sql := IF(@exist = 0, 'ALTER TABLE `designs` ADD COLUMN `primary_image` VARCHAR(500) NULL DEFAULT NULL AFTER `formats`', 'SELECT "Column primary_image already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4. Ensure designs table has thumbnail_image column
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'designs' AND COLUMN_NAME = 'thumbnail_image');
SET @sql := IF(@exist = 0, 'ALTER TABLE `designs` ADD COLUMN `thumbnail_image` VARCHAR(500) NULL DEFAULT NULL AFTER `primary_image`', 'SELECT "Column thumbnail_image already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5. Ensure designs table has card_image column
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'designs' AND COLUMN_NAME = 'card_image');
SET @sql := IF(@exist = 0, 'ALTER TABLE `designs` ADD COLUMN `card_image` VARCHAR(500) NULL DEFAULT NULL AFTER `thumbnail_image`', 'SELECT "Column card_image already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 6. Add indexes on design_images for fast primary lookup
SET @idx_exist := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'design_images' AND INDEX_NAME = 'idx_design_images_primary_order');
SET @sql := IF(@idx_exist = 0, 'ALTER TABLE `design_images` ADD INDEX `idx_design_images_primary_order` (`design_id`, `is_primary`, `display_order`)', 'SELECT "Index already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 7. Ensure exactly one primary image per design in design_images (safe for all MariaDB/MySQL versions)
UPDATE `design_images` di1
JOIN `design_images` di2 
  ON di1.design_id = di2.design_id 
 AND di1.is_primary = 1 
 AND di2.is_primary = 1 
 AND di1.id > di2.id
SET di1.is_primary = 0;

-- 8. Backfill designs.primary_image from primary design_images where missing
UPDATE `designs` d
JOIN `design_images` di ON di.design_id = d.id AND di.is_primary = 1
SET d.primary_image = di.image_url
WHERE d.primary_image IS NULL OR TRIM(d.primary_image) = '';

-- 9. Backfill designs.thumbnail_image from thumb_key where missing
UPDATE `designs` d
JOIN `design_images` di ON di.design_id = d.id AND di.is_primary = 1
SET d.thumbnail_image = di.thumb_key
WHERE (d.thumbnail_image IS NULL OR TRIM(d.thumbnail_image) = '') AND di.thumb_key IS NOT NULL;

