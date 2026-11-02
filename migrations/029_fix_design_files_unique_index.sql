-- Migration 029: Fix design_files unique index to allow retired/soft-deleted rows
-- Allows 7-day rollback and idempotent re-uploads without ER_DUP_ENTRY collisions.
-- Compatible with MariaDB 10.2+ and MySQL 5.7+. 100% idempotent.

-- 1. Add retired_at to design_files (if not present)
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'design_files' AND COLUMN_NAME = 'retired_at');
SET @sql := IF(@exist = 0, 'ALTER TABLE `design_files` ADD COLUMN `retired_at` TIMESTAMP NULL DEFAULT NULL AFTER `created_at`', 'SELECT "Column design_files.retired_at already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Add retired_at to design_images (if not present)
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'design_images' AND COLUMN_NAME = 'retired_at');
SET @sql := IF(@exist = 0, 'ALTER TABLE `design_images` ADD COLUMN `retired_at` TIMESTAMP NULL DEFAULT NULL AFTER `updated_at`', 'SELECT "Column design_images.retired_at already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. Add generated virtual column active_checksum on design_files (NULL when retired_at IS NOT NULL)
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'design_files' AND COLUMN_NAME = 'active_checksum');
SET @sql := IF(@exist = 0, 'ALTER TABLE `design_files` ADD COLUMN `active_checksum` VARCHAR(64) GENERATED ALWAYS AS (IF(`retired_at` IS NULL, `checksum_sha256`, NULL)) VIRTUAL AFTER `retired_at`', 'SELECT "Column active_checksum already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4. Clean up any pre-existing duplicate active rows (keeping lowest ID) so unique index creation is guaranteed
DELETE df FROM `design_files` df
JOIN (
  SELECT `design_id`, `checksum_sha256`, MIN(`id`) AS min_id
  FROM `design_files`
  WHERE `retired_at` IS NULL AND `checksum_sha256` IS NOT NULL AND `checksum_sha256` != ''
  GROUP BY `design_id`, `checksum_sha256`
  HAVING COUNT(*) > 1
) kept ON df.`design_id` = kept.`design_id` AND df.`checksum_sha256` = kept.`checksum_sha256`
WHERE df.`id` != kept.min_id AND df.`retired_at` IS NULL;

-- 5. Drop old blocking idx_design_file_unique (which blocked retired files)
SET @idx_exist := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'design_files' AND INDEX_NAME = 'idx_design_file_unique');
SET @sql := IF(@idx_exist > 0, 'ALTER TABLE `design_files` DROP INDEX `idx_design_file_unique`', 'SELECT "Old index idx_design_file_unique already dropped"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 6. Create new active-only unique index idx_design_file_active_unique on (design_id, active_checksum)
SET @idx_exist := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'design_files' AND INDEX_NAME = 'idx_design_file_active_unique');
SET @sql := IF(@idx_exist = 0, 'ALTER TABLE `design_files` ADD UNIQUE INDEX `idx_design_file_active_unique` (`design_id`, `active_checksum`)', 'SELECT "Index idx_design_file_active_unique already exists"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
