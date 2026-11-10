-- ============================================================================
-- Migration: 038_ensure_custom_requests_schema.sql
-- Description: Idempotent MariaDB 10.x compatible schema verification for
--              custom_requests table and its complete canonical column set.
-- ============================================================================

-- 1. Create custom_requests table if it does not already exist
CREATE TABLE IF NOT EXISTS `custom_requests` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `request_number` VARCHAR(50) NOT NULL UNIQUE,
  `user_id` INT DEFAULT NULL,
  `name` VARCHAR(150) NOT NULL,
  `email` VARCHAR(150) NOT NULL,
  `phone` VARCHAR(50) NOT NULL,
  `design_title` VARCHAR(255) NOT NULL,
  `description` TEXT NOT NULL,
  `category_id` INT DEFAULT NULL,
  `preferred_formats` VARCHAR(255) DEFAULT 'DST, PES, JEF, EXP',
  `size_hoop` VARCHAR(100) DEFAULT NULL,
  `budget` DECIMAL(10,2) DEFAULT NULL,
  `deadline` DATE DEFAULT NULL,
  `reference_image_key` VARCHAR(500) DEFAULT NULL,
  `status` ENUM('new', 'in_review', 'quoted', 'accepted', 'completed', 'rejected') NOT NULL DEFAULT 'new',
  `admin_notes` TEXT DEFAULT NULL,
  `quoted_price` DECIMAL(10,2) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_cr_status` (`status`),
  INDEX `idx_cr_user` (`user_id`),
  INDEX `idx_cr_email` (`email`),
  INDEX `idx_cr_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Idempotent column guards (safe for MariaDB 10.x and MySQL 5.7 / 8.x)
SET @dbname = DATABASE();

-- request_number
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns 
WHERE table_schema = @dbname AND table_name = 'custom_requests' AND column_name = 'request_number';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `custom_requests` ADD COLUMN `request_number` VARCHAR(50) NOT NULL AFTER `id`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- user_id
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns 
WHERE table_schema = @dbname AND table_name = 'custom_requests' AND column_name = 'user_id';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `custom_requests` ADD COLUMN `user_id` INT DEFAULT NULL AFTER `request_number`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- design_title
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns 
WHERE table_schema = @dbname AND table_name = 'custom_requests' AND column_name = 'design_title';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `custom_requests` ADD COLUMN `design_title` VARCHAR(255) NOT NULL AFTER `phone`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- category_id
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns 
WHERE table_schema = @dbname AND table_name = 'custom_requests' AND column_name = 'category_id';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `custom_requests` ADD COLUMN `category_id` INT DEFAULT NULL AFTER `description`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- preferred_formats
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns 
WHERE table_schema = @dbname AND table_name = 'custom_requests' AND column_name = 'preferred_formats';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `custom_requests` ADD COLUMN `preferred_formats` VARCHAR(255) DEFAULT \'DST, PES, JEF, EXP\' AFTER `category_id`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- size_hoop
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns 
WHERE table_schema = @dbname AND table_name = 'custom_requests' AND column_name = 'size_hoop';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `custom_requests` ADD COLUMN `size_hoop` VARCHAR(100) DEFAULT NULL AFTER `preferred_formats`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- budget
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns 
WHERE table_schema = @dbname AND table_name = 'custom_requests' AND column_name = 'budget';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `custom_requests` ADD COLUMN `budget` DECIMAL(10,2) DEFAULT NULL AFTER `size_hoop`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- deadline
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns 
WHERE table_schema = @dbname AND table_name = 'custom_requests' AND column_name = 'deadline';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `custom_requests` ADD COLUMN `deadline` DATE DEFAULT NULL AFTER `budget`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- reference_image_key
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns 
WHERE table_schema = @dbname AND table_name = 'custom_requests' AND column_name = 'reference_image_key';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `custom_requests` ADD COLUMN `reference_image_key` VARCHAR(500) DEFAULT NULL AFTER `deadline`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- status
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns 
WHERE table_schema = @dbname AND table_name = 'custom_requests' AND column_name = 'status';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `custom_requests` ADD COLUMN `status` ENUM(\'new\', \'in_review\', \'quoted\', \'accepted\', \'completed\', \'rejected\') NOT NULL DEFAULT \'new\' AFTER `reference_image_key`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- admin_notes
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns 
WHERE table_schema = @dbname AND table_name = 'custom_requests' AND column_name = 'admin_notes';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `custom_requests` ADD COLUMN `admin_notes` TEXT DEFAULT NULL AFTER `status`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- quoted_price
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns 
WHERE table_schema = @dbname AND table_name = 'custom_requests' AND column_name = 'quoted_price';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `custom_requests` ADD COLUMN `quoted_price` DECIMAL(10,2) DEFAULT NULL AFTER `admin_notes`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

