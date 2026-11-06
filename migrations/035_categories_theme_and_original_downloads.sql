-- ============================================================================
-- Migration 035: Category cards, Appearance settings, and Original Files downloads
-- Idempotent, MariaDB & MySQL compatible, information_schema guarded, no data loss.
-- ============================================================================

SET SESSION lock_wait_timeout = 10;
SET SESSION wait_timeout = 30;

-- ----------------------------------------------------------------------------
-- PART 1: CATEGORIES COLUMNS & BACKFILL
-- ----------------------------------------------------------------------------

-- 1. card_image_key column
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'card_image_key');
SET @query = IF(@col_exists = 0, 'ALTER TABLE `categories` ADD COLUMN `card_image_key` VARCHAR(255) DEFAULT NULL AFTER `image_url`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. icon column
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'icon');
SET @query = IF(@col_exists = 0, 'ALTER TABLE `categories` ADD COLUMN `icon` VARCHAR(100) DEFAULT \'fa-solid fa-shapes\' AFTER `card_image_key`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. sort_order column
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'sort_order');
SET @query = IF(@col_exists = 0, 'ALTER TABLE `categories` ADD COLUMN `sort_order` INT DEFAULT 0 AFTER `display_order`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4. show_on_home column
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'show_on_home');
SET @query = IF(@col_exists = 0, 'ALTER TABLE `categories` ADD COLUMN `show_on_home` TINYINT(1) DEFAULT 1', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5. is_active column
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'is_active');
SET @query = IF(@col_exists = 0, 'ALTER TABLE `categories` ADD COLUMN `is_active` TINYINT(1) DEFAULT 1', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 6. parent_id column
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'parent_id');
SET @query = IF(@col_exists = 0, 'ALTER TABLE `categories` ADD COLUMN `parent_id` INT DEFAULT NULL AFTER `id`, ADD INDEX `idx_categories_parent_id` (`parent_id`)', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 7. Backfill categories
UPDATE `categories` SET `show_on_home` = 1 WHERE `show_on_home` IS NULL OR `show_on_home` = 0 LIMIT 500;
UPDATE `categories` SET `sort_order` = `id` WHERE `sort_order` IS NULL OR `sort_order` = 0 LIMIT 500;
UPDATE `categories` SET `display_order` = `sort_order` WHERE `display_order` IS NULL OR `display_order` = 0 LIMIT 500;
UPDATE `categories` SET `is_active` = 1 WHERE `is_active` IS NULL LIMIT 500;

-- ----------------------------------------------------------------------------
-- PART 2: THEME & APPEARANCE SETTINGS
-- ----------------------------------------------------------------------------

INSERT IGNORE INTO `settings` (`key`, `value`) VALUES 
('theme_switcher_enabled', '1'),
('default_theme', 'system'),
('category_hide_empty', '0'),
('max_categories_on_home', ''),
('category_count_includes_subcategories', '1'),
('design_download_source', 'original'),
('show_preview_download_button', '1');

-- Ensure category_hide_empty defaults to 0 (show all categories)
UPDATE `settings` SET `value` = '0' WHERE `key` = 'category_hide_empty' AND `value` = '1';

-- ----------------------------------------------------------------------------
-- PART 3: ORIGINAL FILES STORAGE COLUMNS
-- ----------------------------------------------------------------------------

-- In designs: original_name, original_mime_type, original_size, checksum, original_file_key, preview_original_key
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'designs' AND COLUMN_NAME = 'original_name');
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `original_name` VARCHAR(255) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'designs' AND COLUMN_NAME = 'original_mime_type');
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `original_mime_type` VARCHAR(100) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'designs' AND COLUMN_NAME = 'original_size');
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `original_size` BIGINT UNSIGNED DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'designs' AND COLUMN_NAME = 'checksum');
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `checksum` VARCHAR(64) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'designs' AND COLUMN_NAME = 'original_file_key');
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `original_file_key` VARCHAR(500) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'designs' AND COLUMN_NAME = 'preview_original_key');
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `preview_original_key` VARCHAR(500) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'designs' AND COLUMN_NAME = 'needs_reupload');
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `needs_reupload` TINYINT(1) DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- In design_images: original_name, original_mime_type, original_size, checksum, original_key
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'design_images' AND COLUMN_NAME = 'original_name');
SET @query = IF(@col_exists = 0, 'ALTER TABLE `design_images` ADD COLUMN `original_name` VARCHAR(255) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'design_images' AND COLUMN_NAME = 'original_mime_type');
SET @query = IF(@col_exists = 0, 'ALTER TABLE `design_images` ADD COLUMN `original_mime_type` VARCHAR(100) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'design_images' AND COLUMN_NAME = 'original_size');
SET @query = IF(@col_exists = 0, 'ALTER TABLE `design_images` ADD COLUMN `original_size` BIGINT UNSIGNED DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'design_images' AND COLUMN_NAME = 'checksum');
SET @query = IF(@col_exists = 0, 'ALTER TABLE `design_images` ADD COLUMN `checksum` VARCHAR(64) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'design_images' AND COLUMN_NAME = 'original_key');
SET @query = IF(@col_exists = 0, 'ALTER TABLE `design_images` ADD COLUMN `original_key` VARCHAR(500) DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
