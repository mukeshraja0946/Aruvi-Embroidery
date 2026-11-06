-- Migration 034: Add icon and show_on_home to categories table (Idempotent MariaDB-compatible)

-- 1. Add icon column if not exists
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'icon');
SET @query = IF(@col_exists = 0, 'ALTER TABLE `categories` ADD COLUMN `icon` VARCHAR(100) DEFAULT \'fa-solid fa-shapes\' AFTER `image_url`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Add show_on_home column if not exists
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'show_on_home');
SET @query = IF(@col_exists = 0, 'ALTER TABLE `categories` ADD COLUMN `show_on_home` TINYINT(1) DEFAULT 1 AFTER `display_order`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

