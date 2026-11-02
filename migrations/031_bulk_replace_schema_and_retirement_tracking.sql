-- ============================================================================
-- Migration 031: Bulk Replace Schema & Retirement Tracking Sync
-- MariaDB 10.x and MySQL 5.7+ Compatible, 100% Idempotent, Zero Data Loss
-- ============================================================================

-- 1. Ensure required job tracking tables exist
CREATE TABLE IF NOT EXISTS `bulk_replace_jobs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `admin_id` INT NULL,
  `admin_email` VARCHAR(255) NULL,
  `category_id` INT NULL,
  `category_name` VARCHAR(255) NULL,
  `scope_summary` VARCHAR(500) NULL,
  `replacement_mode` ENUM('replace_primary', 'replace_all', 'add_extra', 'replace_matching') NOT NULL DEFAULT 'replace_primary',
  `total_files` INT NOT NULL DEFAULT 0,
  `matched_designs` INT NOT NULL DEFAULT 0,
  `replaced_count` INT NOT NULL DEFAULT 0,
  `skipped_count` INT NOT NULL DEFAULT 0,
  `failed_count` INT NOT NULL DEFAULT 0,
  `is_undone` TINYINT(1) NOT NULL DEFAULT 0,
  `undone_at` TIMESTAMP NULL DEFAULT NULL,
  `backup_dir` VARCHAR(500) NULL DEFAULT NULL,
  `status` VARCHAR(50) NOT NULL DEFAULT 'completed',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_bulk_jobs_date` (`created_at`),
  INDEX `idx_bulk_jobs_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bulk_replace_job_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `job_id` INT NOT NULL,
  `design_id` INT NOT NULL,
  `sku` VARCHAR(100) NULL,
  `title` VARCHAR(255) NULL,
  `old_primary_image` VARCHAR(500) NULL,
  `new_primary_image` VARCHAR(500) NULL,
  `old_images_json` LONGTEXT NULL,
  `new_images_json` LONGTEXT NULL,
  `old_files_json` LONGTEXT NULL,
  `new_files_json` LONGTEXT NULL,
  `status` ENUM('replaced', 'skipped', 'failed') NOT NULL DEFAULT 'replaced',
  `error_message` TEXT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_bulk_item_job` (`job_id`),
  INDEX `idx_bulk_item_design` (`design_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `image_replace_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `admin_id` INT NULL,
  `admin_email` VARCHAR(255) NULL,
  `category_id` INT NULL,
  `category_name` VARCHAR(255) NULL,
  `scope_summary` VARCHAR(500) NULL,
  `replacement_mode` ENUM('replace_primary', 'replace_all', 'add_extra', 'replace_matching') NOT NULL DEFAULT 'replace_primary',
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
  `old_files_json` LONGTEXT NULL,
  `new_files_json` LONGTEXT NULL,
  `status` ENUM('replaced', 'skipped', 'failed') NOT NULL DEFAULT 'replaced',
  `error_message` TEXT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_replace_item_log` (`log_id`),
  INDEX `idx_replace_item_design` (`design_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Guarded columns for image_replace_log_items
ALTER TABLE `image_replace_log_items` ADD COLUMN IF NOT EXISTS `old_files_json` LONGTEXT NULL DEFAULT NULL;
ALTER TABLE `image_replace_log_items` ADD COLUMN IF NOT EXISTS `new_files_json` LONGTEXT NULL DEFAULT NULL;

-- 3. Guarded columns for image_replace_logs
ALTER TABLE `image_replace_logs` ADD COLUMN IF NOT EXISTS `backup_dir` VARCHAR(500) NULL DEFAULT NULL;
ALTER TABLE `image_replace_logs` ADD COLUMN IF NOT EXISTS `undone_at` TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE `image_replace_logs` ADD COLUMN IF NOT EXISTS `replaced_count` INT NOT NULL DEFAULT 0;
ALTER TABLE `image_replace_logs` ADD COLUMN IF NOT EXISTS `skipped_count` INT NOT NULL DEFAULT 0;
ALTER TABLE `image_replace_logs` ADD COLUMN IF NOT EXISTS `failed_count` INT NOT NULL DEFAULT 0;

-- 4. Guarded columns for design_files
ALTER TABLE `design_files` ADD COLUMN IF NOT EXISTS `retired_at` TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE `design_files` ADD COLUMN IF NOT EXISTS `retired_by_job_id` INT NULL DEFAULT NULL;
ALTER TABLE `design_files` ADD COLUMN IF NOT EXISTS `retired_reason` VARCHAR(255) NULL DEFAULT NULL;
ALTER TABLE `design_files` ADD COLUMN IF NOT EXISTS `version` INT NOT NULL DEFAULT 1;
ALTER TABLE `design_files` ADD COLUMN IF NOT EXISTS `previous_storage_key` VARCHAR(500) NULL DEFAULT NULL;
ALTER TABLE `design_files` ADD COLUMN IF NOT EXISTS `replaced_by` INT NULL DEFAULT NULL;
ALTER TABLE `design_files` ADD COLUMN IF NOT EXISTS `active_checksum` VARCHAR(64) GENERATED ALWAYS AS (IF(`retired_at` IS NULL, `checksum_sha256`, NULL)) VIRTUAL;

-- 5. Guarded columns for design_images
ALTER TABLE `design_images` ADD COLUMN IF NOT EXISTS `retired_at` TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE `design_images` ADD COLUMN IF NOT EXISTS `retired_by_job_id` INT NULL DEFAULT NULL;
ALTER TABLE `design_images` ADD COLUMN IF NOT EXISTS `retired_reason` VARCHAR(255) NULL DEFAULT NULL;
ALTER TABLE `design_images` ADD COLUMN IF NOT EXISTS `replaced_by` INT NULL DEFAULT NULL;
ALTER TABLE `design_images` ADD COLUMN IF NOT EXISTS `version` INT NOT NULL DEFAULT 1;
ALTER TABLE `design_images` ADD COLUMN IF NOT EXISTS `thumb_key` VARCHAR(500) NULL DEFAULT NULL;
ALTER TABLE `design_images` ADD COLUMN IF NOT EXISTS `card_key` VARCHAR(500) NULL DEFAULT NULL;

-- 6. Indexes on design_files and design_images for fast queries & deduplication
CREATE INDEX IF NOT EXISTS `idx_design_files_retired_at` ON `design_files` (`retired_at`);
CREATE INDEX IF NOT EXISTS `idx_design_files_design_id` ON `design_files` (`design_id`);
CREATE INDEX IF NOT EXISTS `idx_design_images_retired_at` ON `design_images` (`retired_at`);
CREATE INDEX IF NOT EXISTS `idx_design_images_design_id` ON `design_images` (`design_id`);

-- 7. Record migration in schema_migrations
INSERT IGNORE INTO `schema_migrations` (`version`, `name`) VALUES ('031', '031_bulk_replace_schema_and_retirement_tracking.sql');
