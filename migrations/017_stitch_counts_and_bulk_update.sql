-- ============================================================================
-- Migration 017: Stitch Counts (Front, Back, Sleeve, Total), Manual Total Flag,
--               and Stitch Update Audit Logging Tables
-- Target: MariaDB 10.x (Hostinger) & MySQL 8.x
-- Safety: STRICTLY IDEMPOTENT. Never drops, truncates, or deletes data.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. DESIGNS TABLE: Stitch Counts & Manual Total Flag
-- ----------------------------------------------------------------------------
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `stitch_count_front` INT UNSIGNED NULL DEFAULT NULL;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `stitch_count_back` INT UNSIGNED NULL DEFAULT NULL;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `stitch_count_sleeve` INT UNSIGNED NULL DEFAULT NULL;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `stitch_count_total` INT UNSIGNED NULL DEFAULT NULL;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `stitch_total_manual` TINYINT NOT NULL DEFAULT 0;

-- Ensure legacy stitch_count exists and sync with stitch_count_total if total was previously stored
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `stitch_count` INT UNSIGNED NULL DEFAULT NULL;

-- ----------------------------------------------------------------------------
-- 1b. IMPORT JOB ITEMS TABLE: Stitch Count Columns (Safe for Bulk Importer)
-- ----------------------------------------------------------------------------
ALTER TABLE `import_job_items` ADD COLUMN IF NOT EXISTS `stitch_count_front` INT UNSIGNED NULL DEFAULT NULL;
ALTER TABLE `import_job_items` ADD COLUMN IF NOT EXISTS `stitch_count_back` INT UNSIGNED NULL DEFAULT NULL;
ALTER TABLE `import_job_items` ADD COLUMN IF NOT EXISTS `stitch_count_sleeve` INT UNSIGNED NULL DEFAULT NULL;
ALTER TABLE `import_job_items` ADD COLUMN IF NOT EXISTS `stitch_count_total` INT UNSIGNED NULL DEFAULT NULL;
ALTER TABLE `import_job_items` ADD COLUMN IF NOT EXISTS `stitch_total_manual` TINYINT NOT NULL DEFAULT 0;

-- ----------------------------------------------------------------------------
-- 2. STITCH UPDATE AUDIT LOGS TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `stitch_update_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `admin_id` INT NULL,
  `admin_email` VARCHAR(150) NULL,
  `filter_summary` TEXT NULL,
  `method_summary` TEXT NULL,
  `total_affected` INT NOT NULL DEFAULT 0,
  `is_undone` TINYINT(1) NOT NULL DEFAULT 0,
  `undone_at` DATETIME NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 3. STITCH UPDATE LOG ITEMS TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `stitch_update_log_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `log_id` INT NOT NULL,
  `design_id` INT NOT NULL,
  `sku` VARCHAR(100) NULL,
  `old_front` INT UNSIGNED NULL,
  `old_back` INT UNSIGNED NULL,
  `old_sleeve` INT UNSIGNED NULL,
  `old_total` INT UNSIGNED NULL,
  `old_manual` TINYINT NOT NULL DEFAULT 0,
  `new_front` INT UNSIGNED NULL,
  `new_back` INT UNSIGNED NULL,
  `new_sleeve` INT UNSIGNED NULL,
  `new_total` INT UNSIGNED NULL,
  `new_manual` TINYINT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_stitch_log_id` (`log_id`),
  INDEX `idx_stitch_design_id` (`design_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 4. DEFAULT SETTINGS FOR STITCH COUNT FORMATTING & LABELS
-- ----------------------------------------------------------------------------
INSERT INTO `settings` (`setting_key`, `setting_value`, `setting_group`, `description`)
VALUES
  ('stitch_number_format', 'indian', 'design_page', 'Stitch count number formatting (indian e.g. 1,24,580 or international e.g. 124,580)'),
  ('show_stitch_front', '1', 'design_page', 'Display front stitch count row on design detail page'),
  ('label_stitch_front', 'Stitch Count (Front)', 'design_page', 'Label for front stitch count row'),
  ('show_stitch_back', '1', 'design_page', 'Display back stitch count row on design detail page'),
  ('label_stitch_back', 'Stitch Count (Back)', 'design_page', 'Label for back stitch count row'),
  ('show_stitch_sleeve', '1', 'design_page', 'Display sleeve stitch count row on design detail page'),
  ('label_stitch_sleeve', 'Stitch Count (Sleeve)', 'design_page', 'Label for sleeve stitch count row'),
  ('show_stitch_total', '1', 'design_page', 'Display total stitch count row on design detail page'),
  ('label_stitch_total', 'Total Stitch Count', 'design_page', 'Label for total stitch count row'),
  ('show_stitch_on_cards', '0', 'design_page', 'Show total stitches badge on product listing cards (default: 0 OFF)')
ON DUPLICATE KEY UPDATE `setting_key` = `setting_key`;
