-- ============================================================================
-- Migration: 028_create_custom_requests.sql
-- Description: Creates the custom_requests table with MariaDB 10.x compatibility,
--              safe indexes, idempotent execution, and migrates legacy custom_orders data.
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

-- 2. Idempotent column check if table already existed prior to migration
ALTER TABLE `custom_requests` ADD COLUMN IF NOT EXISTS `request_number` VARCHAR(50) NOT NULL UNIQUE AFTER `id`;
ALTER TABLE `custom_requests` ADD COLUMN IF NOT EXISTS `design_title` VARCHAR(255) NOT NULL AFTER `phone`;
ALTER TABLE `custom_requests` ADD COLUMN IF NOT EXISTS `category_id` INT DEFAULT NULL AFTER `description`;
ALTER TABLE `custom_requests` ADD COLUMN IF NOT EXISTS `preferred_formats` VARCHAR(255) DEFAULT 'DST, PES, JEF, EXP' AFTER `category_id`;
ALTER TABLE `custom_requests` ADD COLUMN IF NOT EXISTS `size_hoop` VARCHAR(100) DEFAULT NULL AFTER `preferred_formats`;
ALTER TABLE `custom_requests` ADD COLUMN IF NOT EXISTS `budget` DECIMAL(10,2) DEFAULT NULL AFTER `size_hoop`;
ALTER TABLE `custom_requests` ADD COLUMN IF NOT EXISTS `deadline` DATE DEFAULT NULL AFTER `budget`;
ALTER TABLE `custom_requests` ADD COLUMN IF NOT EXISTS `reference_image_key` VARCHAR(500) DEFAULT NULL AFTER `deadline`;
ALTER TABLE `custom_requests` ADD COLUMN IF NOT EXISTS `quoted_price` DECIMAL(10,2) DEFAULT NULL AFTER `admin_notes`;

-- 3. Safely copy legacy custom_orders data if custom_orders exists
INSERT IGNORE INTO `custom_requests` (
  `id`, `request_number`, `user_id`, `name`, `email`, `phone`, 
  `design_title`, `description`, `reference_image_key`, `status`, 
  `admin_notes`, `quoted_price`, `created_at`, `updated_at`
)
SELECT 
  `id`,
  CONCAT('CR-', DATE_FORMAT(COALESCE(`created_at`, NOW()), '%Y%m%d'), '-', LPAD(`id`, 4, '0')),
  `user_id`,
  COALESCE(NULLIF(TRIM(`full_name`), ''), 'Customer'),
  COALESCE(NULLIF(TRIM(`email`), ''), 'custom-request@aruviembroidery.com'),
  COALESCE(`phone`, ''),
  'Custom Embroidery Request',
  COALESCE(`design_details`, 'Custom design request'),
  `reference_image_url`,
  CASE 
    WHEN `status` = 'pending' THEN 'new'
    WHEN `status` = 'reviewing' THEN 'in_review'
    WHEN `status` = 'quoted' THEN 'quoted'
    WHEN `status` = 'in_progress' THEN 'accepted'
    WHEN `status` = 'completed' THEN 'completed'
    WHEN `status` = 'cancelled' THEN 'rejected'
    ELSE 'new'
  END,
  `admin_notes`,
  `quoted_price`,
  `created_at`,
  `updated_at`
FROM `custom_orders`
WHERE `id` NOT IN (SELECT `id` FROM `custom_requests`);
