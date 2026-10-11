-- Migration 002: Add SKU and metadata columns if not present
-- Safe and idempotent: Never drops tables or deletes existing data.

SET @dbname = DATABASE();

-- 1. designs.sku
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'designs' AND column_name = 'sku';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `sku` VARCHAR(100) DEFAULT NULL AFTER `title`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. designs.is_trending
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'designs' AND column_name = 'is_trending';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `is_trending` TINYINT(1) DEFAULT 0 AFTER `is_featured`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. designs.download_count
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'designs' AND column_name = 'download_count';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `download_count` INT DEFAULT 0 AFTER `is_active`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4. designs.tags
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'designs' AND column_name = 'tags';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `tags` TEXT DEFAULT NULL AFTER `download_count`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5. designs.average_rating
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'designs' AND column_name = 'average_rating';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `average_rating` DECIMAL(3,2) DEFAULT 4.80 AFTER `total_sales`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 6. designs.reviews_count
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'designs' AND column_name = 'reviews_count';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `reviews_count` INT DEFAULT 120 AFTER `average_rating`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
