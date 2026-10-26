-- ============================================================================
-- Migration 020: Test Data Flagging and Reset Data Support
-- Purpose:
--   - Adds is_test column to orders and payments (TINYINT(1) DEFAULT 0)
--   - Adds is_demo column to designs and users (TINYINT(1) DEFAULT 0)
--   - Adds indexes for fast filtering
--   - Backfills existing test orders / test payments / demo users
--   - MariaDB compatible, 100% idempotent (IF NOT EXISTS), zero data loss
-- ============================================================================

-- 1. Orders table: add is_test column & index
ALTER TABLE `orders` ADD COLUMN IF NOT EXISTS `is_test` TINYINT(1) NOT NULL DEFAULT 0 AFTER `status`;
ALTER TABLE `orders` ADD INDEX IF NOT EXISTS `idx_orders_is_test` (`is_test`);

-- 2. Payments table: add is_test column & index
ALTER TABLE `payments` ADD COLUMN IF NOT EXISTS `is_test` TINYINT(1) NOT NULL DEFAULT 0 AFTER `status`;
ALTER TABLE `payments` ADD INDEX IF NOT EXISTS `idx_payments_is_test` (`is_test`);

-- 3. Designs table: add is_demo column & index
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `is_demo` TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_active`;
ALTER TABLE `designs` ADD INDEX IF NOT EXISTS `idx_designs_is_demo` (`is_demo`);

-- 4. Users table: add is_demo column & index
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `is_demo` TINYINT(1) NOT NULL DEFAULT 0 AFTER `role`;
ALTER TABLE `users` ADD INDEX IF NOT EXISTS `idx_users_is_demo` (`is_demo`);

-- 5. Backfill existing test orders
UPDATE `orders` 
SET `is_test` = 1 
WHERE `razorpay_order_id` LIKE '%test%' 
   OR `razorpay_payment_id` LIKE '%test%' 
   OR `order_number` LIKE '%TEST%'
   OR `razorpay_order_id` LIKE 'UTR%'
   OR `razorpay_order_id` LIKE 'UPI%'
   OR `guest_email` LIKE '%example.com%'
   OR `guest_email` LIKE '%test%'
   OR `guest_name` LIKE '%Demo%'
   OR `guest_name` LIKE '%Test%';

-- Synchronize payments is_test with corresponding orders
UPDATE `payments` p 
JOIN `orders` o ON p.order_id = o.id 
SET p.is_test = o.is_test;

-- Flag demo users (never flag admin accounts)
UPDATE `users`
SET `is_demo` = 1
WHERE (`email` LIKE '%demo%' OR `email` LIKE '%test%' OR `full_name` LIKE '%Demo%' OR `full_name` LIKE '%Test%')
  AND `role` != 'admin';
