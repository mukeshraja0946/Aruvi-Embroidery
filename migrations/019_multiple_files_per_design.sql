-- ============================================================================
-- Migration 019: Multiple Files Per Design Support
-- Purpose:
--   Supports packs/bundles with multiple paid downloadable machine files
--   (ZIP, RAR, DST, PES, JEF, EXP, PNG) and multiple public preview images per design.
--   Preserves legacy columns (file_name, file_path, file_format, checksum, is_preview).
--   Ensures MariaDB & MySQL compatibility, idempotency, and zero data loss.
-- ============================================================================

-- 1. Ensure table design_files exists with full schema
CREATE TABLE IF NOT EXISTS `design_files` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `design_id` INT NOT NULL,
  `file_kind` ENUM('machine', 'image', 'other') NOT NULL DEFAULT 'machine',
  `label` VARCHAR(255) NULL DEFAULT NULL,
  `original_name` VARCHAR(255) NULL DEFAULT NULL,
  `storage_key` VARCHAR(255) NULL DEFAULT NULL,
  `mime_type` VARCHAR(100) NULL DEFAULT NULL,
  `file_size` BIGINT DEFAULT 0,
  `checksum_sha256` VARCHAR(64) NULL DEFAULT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `is_primary_preview` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `file_name` VARCHAR(255) NULL DEFAULT NULL,
  `file_path` VARCHAR(255) NULL DEFAULT NULL,
  `file_format` VARCHAR(20) NULL DEFAULT 'ZIP',
  `checksum` VARCHAR(64) NULL DEFAULT NULL,
  `is_preview` TINYINT(1) DEFAULT 0,
  CONSTRAINT `fk_design_files_design` FOREIGN KEY (`design_id`) REFERENCES `designs`(`id`) ON DELETE CASCADE,
  INDEX `idx_design_files_design` (`design_id`),
  INDEX `idx_design_files_kind` (`design_id`, `file_kind`),
  INDEX `idx_design_files_sort` (`design_id`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Add new columns to existing design_files table if not present (idempotent)
ALTER TABLE `design_files` ADD COLUMN IF NOT EXISTS `file_kind` ENUM('machine', 'image', 'other') NOT NULL DEFAULT 'machine' AFTER `design_id`;
ALTER TABLE `design_files` ADD COLUMN IF NOT EXISTS `label` VARCHAR(255) NULL DEFAULT NULL AFTER `file_kind`;
ALTER TABLE `design_files` ADD COLUMN IF NOT EXISTS `original_name` VARCHAR(255) NULL DEFAULT NULL AFTER `label`;
ALTER TABLE `design_files` ADD COLUMN IF NOT EXISTS `storage_key` VARCHAR(255) NULL DEFAULT NULL AFTER `original_name`;
ALTER TABLE `design_files` ADD COLUMN IF NOT EXISTS `mime_type` VARCHAR(100) NULL DEFAULT NULL AFTER `storage_key`;
ALTER TABLE `design_files` ADD COLUMN IF NOT EXISTS `checksum_sha256` VARCHAR(64) NULL DEFAULT NULL AFTER `file_size`;
ALTER TABLE `design_files` ADD COLUMN IF NOT EXISTS `sort_order` INT NOT NULL DEFAULT 0 AFTER `checksum_sha256`;
ALTER TABLE `design_files` ADD COLUMN IF NOT EXISTS `is_primary_preview` TINYINT(1) NOT NULL DEFAULT 0 AFTER `sort_order`;

-- Ensure file_size is BIGINT for large pack files
ALTER TABLE `design_files` MODIFY COLUMN `file_size` BIGINT DEFAULT 0;

-- 3. Ensure design_images table exists for public preview image gallery
CREATE TABLE IF NOT EXISTS `design_images` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `design_id` INT NOT NULL,
  `image_url` VARCHAR(255) NOT NULL,
  `is_primary` TINYINT(1) DEFAULT 0,
  `display_order` INT DEFAULT 0,
  CONSTRAINT `fk_design_images_design` FOREIGN KEY (`design_id`) REFERENCES `designs`(`id`) ON DELETE CASCADE,
  INDEX `idx_design_images_design` (`design_id`),
  INDEX `idx_design_images_order` (`design_id`, `display_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Copy existing single ZIP/image references into new columns (no file moving or deleting)
UPDATE `design_files`
SET
  `original_name` = COALESCE(NULLIF(`original_name`, ''), `file_name`, SUBSTRING_INDEX(`file_path`, '/', -1)),
  `storage_key` = COALESCE(NULLIF(`storage_key`, ''), `file_path`),
  `label` = COALESCE(NULLIF(`label`, ''), `file_name`, 'Primary File'),
  `checksum_sha256` = COALESCE(NULLIF(`checksum_sha256`, ''), `checksum`),
  `is_primary_preview` = COALESCE(`is_primary_preview`, `is_preview`, 0),
  `file_kind` = CASE
    WHEN COALESCE(`is_preview`, 0) = 1 OR UPPER(COALESCE(`file_format`, '')) IN ('PNG', 'JPG', 'JPEG', 'WEBP', 'AVIF', 'IMAGE') THEN 'image'
    ELSE 'machine'
  END
WHERE `original_name` IS NULL OR `storage_key` IS NULL OR `label` IS NULL;

-- 5. Sync any preview images from design_images into design_files as public image references
INSERT INTO `design_files` (
  `design_id`, `file_kind`, `label`, `original_name`, `storage_key`, `mime_type`, 
  `file_size`, `sort_order`, `is_primary_preview`, `file_name`, `file_path`, `file_format`, `is_preview`
)
SELECT
  di.`design_id`,
  'image' AS `file_kind`,
  SUBSTRING_INDEX(di.`image_url`, '/', -1) AS `label`,
  SUBSTRING_INDEX(di.`image_url`, '/', -1) AS `original_name`,
  di.`image_url` AS `storage_key`,
  'image/png' AS `mime_type`,
  0 AS `file_size`,
  COALESCE(di.`display_order`, 0) AS `sort_order`,
  COALESCE(di.`is_primary`, 0) AS `is_primary_preview`,
  SUBSTRING_INDEX(di.`image_url`, '/', -1) AS `file_name`,
  di.`image_url` AS `file_path`,
  UPPER(SUBSTRING_INDEX(di.`image_url`, '.', -1)) AS `file_format`,
  1 AS `is_preview`
FROM `design_images` di
WHERE NOT EXISTS (
  SELECT 1 FROM `design_files` df 
  WHERE df.`design_id` = di.`design_id` 
    AND (df.`storage_key` = di.`image_url` OR df.`file_path` = di.`image_url`)
);

-- 6. Insert default settings for multiple files and size limits (200MB max default, 0 = unlimited downloads)
INSERT INTO `settings` (`setting_key`, `setting_value`) VALUES
  ('max_file_size_mb', '200'),
  ('download_limit_per_file', '0'),
  ('allow_multiple_files_per_design', '1')
ON DUPLICATE KEY UPDATE `setting_key` = `setting_key`;
