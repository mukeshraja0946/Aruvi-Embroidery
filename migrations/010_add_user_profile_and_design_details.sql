-- Migration 010: Add user address & profile picture, design details, and contact message fields
-- Safe and idempotent: Never drops tables or deletes existing data.

SET @dbname = DATABASE();

-- 1. users.address
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'users' AND column_name = 'address';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `users` ADD COLUMN `address` TEXT DEFAULT NULL AFTER `phone`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. users.profile_picture
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'users' AND column_name = 'profile_picture';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `users` ADD COLUMN `profile_picture` TEXT DEFAULT NULL AFTER `address`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. design_files.is_preview
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'design_files' AND column_name = 'is_preview';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `design_files` ADD COLUMN `is_preview` TINYINT(1) DEFAULT 0 AFTER `file_size`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4. designs.short_description
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'designs' AND column_name = 'short_description';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `short_description` TEXT DEFAULT NULL AFTER `sku`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5. designs.sub_category
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'designs' AND column_name = 'sub_category';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `sub_category` VARCHAR(100) DEFAULT NULL AFTER `category_id`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 6. contact_messages.source
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'contact_messages' AND column_name = 'source';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `contact_messages` ADD COLUMN `source` VARCHAR(50) DEFAULT \'customer_form\' AFTER `status`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 7. contact_messages.is_read
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'contact_messages' AND column_name = 'is_read';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `contact_messages` ADD COLUMN `is_read` TINYINT(1) DEFAULT 0 AFTER `source`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 8. contact_messages.phone
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'contact_messages' AND column_name = 'phone';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `contact_messages` ADD COLUMN `phone` VARCHAR(20) DEFAULT NULL AFTER `email`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
