-- Migration 023: Make orders.shipping_address and users.address nullable & add require_checkout_address setting
-- Safe and idempotent: MariaDB and MySQL compatible, never modifies or deletes existing order data

-- 1. Ensure shipping_address column exists on orders table and is nullable
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'shipping_address');
SET @sql := IF(@exist > 0, 
  'ALTER TABLE `orders` MODIFY COLUMN `shipping_address` TEXT NULL DEFAULT NULL', 
  'ALTER TABLE `orders` ADD COLUMN `shipping_address` TEXT NULL DEFAULT NULL AFTER `guest_phone`');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Ensure address column exists on users table and is nullable
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'address');
SET @sql := IF(@exist > 0, 
  'ALTER TABLE `users` MODIFY COLUMN `address` TEXT NULL DEFAULT NULL', 
  'ALTER TABLE `users` ADD COLUMN `address` TEXT NULL DEFAULT NULL AFTER `phone`');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. Ensure settings table exists and default require_checkout_address is registered (default '0' = OFF / optional)
CREATE TABLE IF NOT EXISTS `settings` (
  `setting_key` VARCHAR(100) PRIMARY KEY,
  `setting_value` TEXT DEFAULT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `settings` (`setting_key`, `setting_value`) 
VALUES ('require_checkout_address', '0')
ON DUPLICATE KEY UPDATE `setting_key` = `setting_key`;
