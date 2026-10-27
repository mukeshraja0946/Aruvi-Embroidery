-- Migration 022: Image Replacement Engine, Audit History & Preview Download Tracking
-- Supports category-scoped image replacement with undo and preview download analytics

-- 1. Add preview_download_count to designs
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'designs' AND COLUMN_NAME = 'preview_download_count');
SET @sql := IF(@exist = 0, 'ALTER TABLE `designs` ADD COLUMN `preview_download_count` INT NOT NULL DEFAULT 0 AFTER `download_count`', 'SELECT "Column preview_download_count already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Add metadata columns to design_images
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'design_images' AND COLUMN_NAME = 'file_size');
SET @sql := IF(@exist = 0, 'ALTER TABLE `design_images` ADD COLUMN `file_size` BIGINT NOT NULL DEFAULT 0 AFTER `display_order`', 'SELECT "Column file_size already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'design_images' AND COLUMN_NAME = 'checksum');
SET @sql := IF(@exist = 0, 'ALTER TABLE `design_images` ADD COLUMN `checksum` VARCHAR(64) NULL DEFAULT NULL AFTER `file_size`', 'SELECT "Column checksum already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'design_images' AND COLUMN_NAME = 'version');
SET @sql := IF(@exist = 0, 'ALTER TABLE `design_images` ADD COLUMN `version` INT NOT NULL DEFAULT 1 AFTER `checksum`', 'SELECT "Column version already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'design_images' AND COLUMN_NAME = 'updated_at');
SET @sql := IF(@exist = 0, 'ALTER TABLE `design_images` ADD COLUMN `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `version`', 'SELECT "Column updated_at already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. Create image_replace_logs table
CREATE TABLE IF NOT EXISTS `image_replace_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `admin_id` INT NULL,
  `admin_email` VARCHAR(255) NULL,
  `category_id` INT NULL,
  `category_name` VARCHAR(255) NULL,
  `scope_summary` VARCHAR(500) NULL,
  `replacement_mode` ENUM('replace_primary', 'replace_all', 'add_extra') NOT NULL DEFAULT 'replace_primary',
  `total_files` INT NOT NULL DEFAULT 0,
  `matched_designs` INT NOT NULL DEFAULT 0,
  `replaced_count` INT NOT NULL DEFAULT 0,
  `skipped_count` INT NOT NULL DEFAULT 0,
  `failed_count` INT NOT NULL DEFAULT 0,
  `is_undone` TINYINT(1) NOT NULL DEFAULT 0,
  `undone_at` TIMESTAMP NULL DEFAULT NULL,
  `backup_dir` VARCHAR(500) NULL DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_replace_log_date` (`created_at`),
  INDEX `idx_replace_log_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Create image_replace_log_items table
CREATE TABLE IF NOT EXISTS `image_replace_log_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `log_id` INT NOT NULL,
  `design_id` INT NOT NULL,
  `sku` VARCHAR(100) NULL,
  `title` VARCHAR(255) NULL,
  `old_primary_image` VARCHAR(500) NULL,
  `new_primary_image` VARCHAR(500) NULL,
  `old_images_json` LONGTEXT NULL,
  `new_images_json` LONGTEXT NULL,
  `status` ENUM('replaced', 'skipped', 'failed') NOT NULL DEFAULT 'replaced',
  `error_message` TEXT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`log_id`) REFERENCES `image_replace_logs`(`id`) ON DELETE CASCADE,
  INDEX `idx_replace_item_log` (`log_id`),
  INDEX `idx_replace_item_design` (`design_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
