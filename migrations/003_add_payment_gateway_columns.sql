-- Migration 003: Add Payment Gateway and Cashfree columns to orders if not present
-- Safe and idempotent: Never drops tables or deletes existing data.

SET @dbname = DATABASE();

-- 1. orders.payment_gateway
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'orders' AND column_name = 'payment_gateway';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `orders` ADD COLUMN `payment_gateway` VARCHAR(50) DEFAULT \'razorpay\' AFTER `razorpay_payment_id`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. orders.cashfree_order_id
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'orders' AND column_name = 'cashfree_order_id';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `orders` ADD COLUMN `cashfree_order_id` VARCHAR(100) DEFAULT NULL AFTER `payment_gateway`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. orders.cashfree_payment_id
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'orders' AND column_name = 'cashfree_payment_id';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `orders` ADD COLUMN `cashfree_payment_id` VARCHAR(100) DEFAULT NULL AFTER `cashfree_order_id`', 'SELECT 1');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
