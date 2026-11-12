-- ============================================================================
-- Migration: 039_create_design_file_variants.sql
-- Description: Creates design_file_variants table, adds variant_id to order_items
--              and cart_items, adds file_usage_guide to designs, and seeds default
--              machine compatibility usage guide.
-- Database Compatibility: MariaDB 10.x, MySQL 5.7 / 8.0+
-- Idempotent: Yes (Safe to re-run with zero data loss)
-- ============================================================================

-- 1. Create design_file_variants table
CREATE TABLE IF NOT EXISTS `design_file_variants` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `design_id` INT NOT NULL,
  `variant_name` VARCHAR(150) NOT NULL,
  `variant_group` VARCHAR(100) DEFAULT NULL,
  `file_id` INT DEFAULT NULL,
  `storage_key` VARCHAR(500) DEFAULT NULL,
  `file_name` VARCHAR(255) DEFAULT NULL,
  `original_name` VARCHAR(255) DEFAULT NULL,
  `file_size` BIGINT DEFAULT 0,
  `file_format` VARCHAR(50) DEFAULT NULL,
  `sort_order` INT DEFAULT 0,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_dfv_design_id` (`design_id`),
  INDEX `idx_dfv_is_active` (`is_active`),
  INDEX `idx_dfv_sort_order` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Idempotent column additions using information_schema
SET @dbname = DATABASE();

-- order_items.variant_id
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns 
WHERE table_schema = @dbname AND table_name = 'order_items' AND column_name = 'variant_id';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `order_items` ADD COLUMN `variant_id` INT DEFAULT NULL AFTER `design_id`, ADD INDEX `idx_oi_variant` (`variant_id`)', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- cart_items.variant_id
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns 
WHERE table_schema = @dbname AND table_name = 'cart_items' AND column_name = 'variant_id';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `cart_items` ADD COLUMN `variant_id` INT DEFAULT NULL AFTER `design_id`, ADD INDEX `idx_ci_variant` (`variant_id`)', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- designs.file_usage_guide
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns 
WHERE table_schema = @dbname AND table_name = 'designs' AND column_name = 'file_usage_guide';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `file_usage_guide` TEXT DEFAULT NULL AFTER `formats`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Seed site-wide default File Usage Guide setting if missing
INSERT INTO `settings` (`setting_key`, `setting_value`, `updated_at`)
SELECT 'file_usage_guide_default', 'BIG DST - RRR, HSW, UME, Ricoma, Fortever, WOW, SGK, Vidya, Single Head Machines | JEF - USHA 450E, 550E | SMALL DST - Brother V3SE, BP3600, Bernina B700, Pfaff', NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `settings` WHERE `setting_key` = 'file_usage_guide_default');

-- 4. Clean stray image records in design_files table so they are never bundled as machine files (Task B)
UPDATE `design_files`
SET `file_kind` = 'image', `is_preview` = 1
WHERE UPPER(COALESCE(file_format, '')) IN ('PNG','JPG','JPEG','WEBP','SVG','AVIF','GIF')
   OR LOWER(COALESCE(file_name, '')) LIKE '%.png'
   OR LOWER(COALESCE(file_name, '')) LIKE '%.jpg'
   OR LOWER(COALESCE(file_name, '')) LIKE '%.jpeg'
   OR LOWER(COALESCE(file_name, '')) LIKE '%.webp';
