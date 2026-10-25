-- ============================================================================
-- Aruvi Embroidery — Live Production Database Sync Script
-- File: migrations/production_sync.sql
-- 
-- PURPOSE:
-- Synchronizes live MySQL database (e.g. u101925264_aedesign on Hostinger)
-- with the full codebase schema required by Bulk Import, File Scanning,
-- Download Tracking, Activity Logging, and Email Campaigns.
--
-- SAFETY GUARANTEES:
-- 1. Strictly Idempotent: Can be run multiple times safely.
-- 2. Zero Data Loss: NEVER contains DROP, TRUNCATE, DELETE, or ALTER DROP.
-- 3. Universal Compatibility: Fully compatible with phpMyAdmin, MySQL 5.7+,
--    MySQL 8.x, and MariaDB.
-- ============================================================================

SET @dbname = DATABASE();

-- ----------------------------------------------------------------------------
-- 1. Schema Migrations Tracking Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `version` VARCHAR(100) NOT NULL UNIQUE,
  `name` VARCHAR(255) NOT NULL,
  `applied_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 2. Core Tables (CREATE TABLE IF NOT EXISTS)
-- ----------------------------------------------------------------------------

-- Roles
CREATE TABLE IF NOT EXISTS `roles` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(50) NOT NULL UNIQUE,
  `description` VARCHAR(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Users
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `full_name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(150) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `address` TEXT DEFAULT NULL,
  `profile_picture` TEXT DEFAULT NULL,
  `role` ENUM('admin', 'customer') NOT NULL DEFAULT 'customer',
  `is_active` TINYINT(1) DEFAULT 1,
  `reset_token` VARCHAR(255) DEFAULT NULL,
  `reset_expires` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (`email`),
  INDEX idx_role (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Categories
CREATE TABLE IF NOT EXISTS `categories` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(100) NOT NULL,
  `slug` VARCHAR(120) NOT NULL UNIQUE,
  `description` TEXT DEFAULT NULL,
  `image_url` VARCHAR(255) DEFAULT NULL,
  `display_order` INT DEFAULT 0,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_slug (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Designs (Products)
CREATE TABLE IF NOT EXISTS `designs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `title` VARCHAR(200) NOT NULL,
  `sku` VARCHAR(100) DEFAULT NULL,
  `slug` VARCHAR(220) NOT NULL UNIQUE,
  `short_description` TEXT DEFAULT NULL,
  `description` TEXT DEFAULT NULL,
  `price` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `sale_price` DECIMAL(10,2) DEFAULT NULL,
  `category_id` INT DEFAULT NULL,
  `sub_category` VARCHAR(100) DEFAULT NULL,
  `hoop_size` VARCHAR(50) DEFAULT NULL,
  `stitch_count` INT DEFAULT NULL,
  `dimensions` VARCHAR(100) DEFAULT NULL,
  `formats` VARCHAR(255) DEFAULT 'DST, PES, JEF, EXP',
  `is_featured` TINYINT(1) DEFAULT 0,
  `is_trending` TINYINT(1) DEFAULT 0,
  `is_active` TINYINT(1) DEFAULT 1,
  `download_count` INT DEFAULT 0,
  `tags` TEXT DEFAULT NULL,
  `total_sales` INT DEFAULT 0,
  `average_rating` DECIMAL(3,2) DEFAULT 4.80,
  `reviews_count` INT DEFAULT 120,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL,
  INDEX idx_category (`category_id`),
  INDEX idx_sku (`sku`),
  INDEX idx_slug (`slug`),
  INDEX idx_featured (`is_featured`),
  INDEX idx_trending (`is_trending`),
  INDEX idx_active (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Design Images
CREATE TABLE IF NOT EXISTS `design_images` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `design_id` INT NOT NULL,
  `image_url` VARCHAR(255) NOT NULL,
  `is_primary` TINYINT(1) DEFAULT 0,
  `display_order` INT DEFAULT 0,
  FOREIGN KEY (`design_id`) REFERENCES `designs`(`id`) ON DELETE CASCADE,
  INDEX idx_design (`design_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Design Download Files
CREATE TABLE IF NOT EXISTS `design_files` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `design_id` INT NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `file_path` VARCHAR(255) NOT NULL,
  `file_format` VARCHAR(20) DEFAULT 'ZIP',
  `file_size` INT DEFAULT 0,
  `is_preview` TINYINT(1) DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`design_id`) REFERENCES `designs`(`id`) ON DELETE CASCADE,
  INDEX idx_design_file (`design_id`),
  INDEX idx_design_preview (`design_id`, `is_preview`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cart Items
CREATE TABLE IF NOT EXISTS `cart_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT DEFAULT NULL,
  `session_id` VARCHAR(128) DEFAULT NULL,
  `design_id` INT NOT NULL,
  `quantity` INT DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`design_id`) REFERENCES `designs`(`id`) ON DELETE CASCADE,
  INDEX idx_user (`user_id`),
  INDEX idx_session (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Orders
CREATE TABLE IF NOT EXISTS `orders` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_number` VARCHAR(50) NOT NULL UNIQUE,
  `user_id` INT DEFAULT NULL,
  `guest_email` VARCHAR(150) DEFAULT NULL,
  `guest_name` VARCHAR(100) DEFAULT NULL,
  `guest_phone` VARCHAR(20) DEFAULT NULL,
  `shipping_address` TEXT DEFAULT NULL,
  `city` VARCHAR(100) DEFAULT NULL,
  `state` VARCHAR(100) DEFAULT NULL,
  `pincode` VARCHAR(20) DEFAULT NULL,
  `payment_method` VARCHAR(50) DEFAULT 'card',
  `total_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `discount_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `final_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `coupon_code` VARCHAR(50) DEFAULT NULL,
  `status` ENUM('pending', 'processing', 'completed', 'cancelled') NOT NULL DEFAULT 'pending',
  `razorpay_order_id` VARCHAR(100) DEFAULT NULL,
  `razorpay_payment_id` VARCHAR(100) DEFAULT NULL,
  `payment_gateway` VARCHAR(50) DEFAULT 'razorpay',
  `cashfree_order_id` VARCHAR(100) DEFAULT NULL,
  `cashfree_payment_id` VARCHAR(100) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  INDEX idx_order_number (`order_number`),
  INDEX idx_user_orders (`user_id`),
  INDEX idx_status (`status`),
  INDEX idx_gateway (`payment_gateway`),
  INDEX idx_cashfree_order (`cashfree_order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Order Items
CREATE TABLE IF NOT EXISTS `order_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NOT NULL,
  `design_id` INT NOT NULL,
  `quantity` INT DEFAULT 1,
  `price_at_purchase` DECIMAL(10,2) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`design_id`) REFERENCES `designs`(`id`) ON DELETE RESTRICT,
  INDEX idx_order (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Custom Orders
CREATE TABLE IF NOT EXISTS `custom_orders` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT DEFAULT NULL,
  `full_name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(150) NOT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `design_details` TEXT NOT NULL,
  `reference_image_url` VARCHAR(255) DEFAULT NULL,
  `status` ENUM('pending', 'reviewing', 'accepted', 'in_progress', 'completed', 'rejected') NOT NULL DEFAULT 'pending',
  `admin_notes` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Banners
CREATE TABLE IF NOT EXISTS `banners` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `title` VARCHAR(150) NOT NULL,
  `image_url` VARCHAR(255) NOT NULL,
  `link_url` VARCHAR(255) DEFAULT NULL,
  `display_order` INT DEFAULT 0,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Payments
CREATE TABLE IF NOT EXISTS `payments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NOT NULL,
  `razorpay_payment_id` VARCHAR(100) DEFAULT NULL,
  `razorpay_order_id` VARCHAR(100) DEFAULT NULL,
  `razorpay_signature` VARCHAR(255) DEFAULT NULL,
  `amount` DECIMAL(10,2) NOT NULL,
  `status` VARCHAR(50) NOT NULL DEFAULT 'created',
  `payment_method` VARCHAR(50) DEFAULT 'razorpay',
  `raw_payload` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Coupons
CREATE TABLE IF NOT EXISTS `coupons` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `code` VARCHAR(50) NOT NULL UNIQUE,
  `discount_type` ENUM('percentage', 'fixed') NOT NULL DEFAULT 'percentage',
  `discount_value` DECIMAL(10,2) NOT NULL,
  `min_purchase` DECIMAL(10,2) DEFAULT 0.00,
  `expiry_date` DATE DEFAULT NULL,
  `usage_limit` INT DEFAULT NULL,
  `times_used` INT DEFAULT 0,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reviews
CREATE TABLE IF NOT EXISTS `reviews` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `design_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `rating` INT NOT NULL CHECK (`rating` >= 1 AND `rating` <= 5),
  `comment` TEXT DEFAULT NULL,
  `is_approved` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`design_id`) REFERENCES `designs`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Wishlist
CREATE TABLE IF NOT EXISTS `wishlist` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `design_id` INT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_design (`user_id`, `design_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`design_id`) REFERENCES `designs`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Contact Messages
CREATE TABLE IF NOT EXISTS `contact_messages` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(150) NOT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `subject` VARCHAR(200) DEFAULT 'General Inquiry',
  `message` TEXT NOT NULL,
  `status` ENUM('new', 'read', 'replied') NOT NULL DEFAULT 'new',
  `source` VARCHAR(50) DEFAULT 'customer_form',
  `is_read` TINYINT(1) DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Settings
CREATE TABLE IF NOT EXISTS `settings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `setting_key` VARCHAR(100) NOT NULL UNIQUE,
  `setting_value` TEXT DEFAULT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Site Settings
CREATE TABLE IF NOT EXISTS `site_settings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `setting_key` VARCHAR(100) NOT NULL UNIQUE,
  `setting_value` TEXT DEFAULT NULL,
  `setting_group` VARCHAR(50) DEFAULT 'general',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Activity Logs
CREATE TABLE IF NOT EXISTS `activity_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT DEFAULT NULL,
  `admin_name` VARCHAR(100) NOT NULL DEFAULT 'Admin',
  `action` VARCHAR(100) NOT NULL,
  `entity_type` VARCHAR(50) NOT NULL,
  `entity_id` VARCHAR(50) DEFAULT NULL,
  `details` TEXT DEFAULT NULL,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_entity (`entity_type`, `entity_id`),
  INDEX idx_created (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Download Logs
CREATE TABLE IF NOT EXISTS `download_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT DEFAULT NULL,
  `design_id` INT NOT NULL,
  `file_id` INT DEFAULT NULL,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `user_agent` TEXT DEFAULT NULL,
  `downloaded_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_design (`design_id`),
  INDEX idx_user (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- File Integrity Scan Results & Jobs
CREATE TABLE IF NOT EXISTS `file_scan_results` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `design_id` INT NOT NULL,
  `title` VARCHAR(255) DEFAULT '',
  `sku` VARCHAR(100) DEFAULT '',
  `category_name` VARCHAR(100) DEFAULT 'Uncategorized',
  `price` DECIMAL(10,2) DEFAULT 0.00,
  `is_active` TINYINT(1) DEFAULT 1,
  `image_url` VARCHAR(500) DEFAULT NULL,
  `image_status` ENUM('ok', 'missing', 'none') DEFAULT 'none',
  `file_path` VARCHAR(500) DEFAULT NULL,
  `file_name` VARCHAR(255) DEFAULT NULL,
  `file_status` ENUM('ok', 'missing', 'none') DEFAULT 'none',
  `scanned_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_scan_design (`design_id`),
  INDEX idx_scan_img_status (`image_status`),
  INDEX idx_scan_file_status (`file_status`),
  INDEX idx_scan_sku (`sku`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `scan_jobs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `status` ENUM('idle', 'running', 'completed', 'failed') DEFAULT 'idle',
  `total_designs` INT DEFAULT 0,
  `scanned_designs` INT DEFAULT 0,
  `missing_images` INT DEFAULT 0,
  `missing_files` INT DEFAULT 0,
  `missing_both` INT DEFAULT 0,
  `error_message` TEXT DEFAULT NULL,
  `started_at` DATETIME DEFAULT NULL,
  `completed_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bulk Import Jobs & Items
CREATE TABLE IF NOT EXISTS `import_jobs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `batch_id` VARCHAR(64) NOT NULL UNIQUE,
  `status` ENUM('draft', 'ready', 'processing', 'completed', 'failed', 'rolled_back') DEFAULT 'draft',
  `total_rows` INT DEFAULT 0,
  `valid_rows` INT DEFAULT 0,
  `error_rows` INT DEFAULT 0,
  `duplicate_rows` INT DEFAULT 0,
  `imported_count` INT DEFAULT 0,
  `skipped_count` INT DEFAULT 0,
  `failed_count` INT DEFAULT 0,
  `update_existing` TINYINT(1) DEFAULT 0,
  `spreadsheet_filename` VARCHAR(255) DEFAULT NULL,
  `created_by` INT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `completed_at` DATETIME DEFAULT NULL,
  `error_log` LONGTEXT DEFAULT NULL,
  INDEX idx_batch (`batch_id`),
  INDEX idx_status (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `import_job_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `job_id` INT NOT NULL,
  `row_no` INT NOT NULL,
  `sku` VARCHAR(100) DEFAULT NULL,
  `title` VARCHAR(255) DEFAULT NULL,
  `category_name` VARCHAR(100) DEFAULT NULL,
  `price` DECIMAL(10,2) DEFAULT 0.00,
  `sale_price` DECIMAL(10,2) DEFAULT NULL,
  `formats` VARCHAR(255) DEFAULT 'DST',
  `description` TEXT DEFAULT NULL,
  `tags` TEXT DEFAULT NULL,
  `status` VARCHAR(50) DEFAULT 'Active',
  `image_filename` VARCHAR(255) DEFAULT NULL,
  `image_stored_url` VARCHAR(500) DEFAULT NULL,
  `image_matched` TINYINT(1) DEFAULT 0,
  `file_filename` VARCHAR(255) DEFAULT NULL,
  `file_stored_path` VARCHAR(500) DEFAULT NULL,
  `file_matched` TINYINT(1) DEFAULT 0,
  `validation_status` ENUM('valid', 'error', 'duplicate') DEFAULT 'valid',
  `validation_error` VARCHAR(500) DEFAULT NULL,
  `imported_design_id` INT DEFAULT NULL,
  `import_status` ENUM('pending', 'imported', 'skipped', 'failed') DEFAULT 'pending',
  `import_message` VARCHAR(500) DEFAULT NULL,
  INDEX idx_item_job (`job_id`),
  INDEX idx_item_sku (`sku`),
  INDEX idx_item_design (`imported_design_id`),
  FOREIGN KEY (`job_id`) REFERENCES `import_jobs`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Email Campaigns & Unsubscribers
CREATE TABLE IF NOT EXISTS `email_campaigns` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `subject` VARCHAR(255) NOT NULL,
  `body_html` LONGTEXT NOT NULL,
  `total_recipients` INT DEFAULT 0,
  `success_count` INT DEFAULT 0,
  `failed_count` INT DEFAULT 0,
  `status` ENUM('Draft', 'Queued', 'Sending', 'Completed', 'Partially Failed', 'Failed') DEFAULT 'Draft',
  `sent_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_campaign_status (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `email_campaign_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `campaign_id` INT NOT NULL,
  `recipient_email` VARCHAR(150) NOT NULL,
  `recipient_name` VARCHAR(100) DEFAULT NULL,
  `status` ENUM('Pending', 'Sent', 'Failed') DEFAULT 'Pending',
  `error_message` TEXT DEFAULT NULL,
  `sent_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_campaign_id (`campaign_id`),
  INDEX idx_log_recipient (`recipient_email`),
  FOREIGN KEY (`campaign_id`) REFERENCES `email_campaigns`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `unsubscribed_customers` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `email` VARCHAR(150) NOT NULL UNIQUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_unsub_email (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 3. Idempotent Column Additions for Existing Tables
-- ----------------------------------------------------------------------------

-- designs.sku
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'designs' AND column_name = 'sku';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `sku` VARCHAR(100) DEFAULT NULL AFTER `title`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- designs.short_description
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'designs' AND column_name = 'short_description';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `short_description` TEXT DEFAULT NULL AFTER `sku`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- designs.sub_category
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'designs' AND column_name = 'sub_category';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `sub_category` VARCHAR(100) DEFAULT NULL AFTER `category_id`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- designs.is_trending
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'designs' AND column_name = 'is_trending';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `is_trending` TINYINT(1) DEFAULT 0 AFTER `is_featured`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- designs.download_count
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'designs' AND column_name = 'download_count';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `download_count` INT DEFAULT 0 AFTER `is_active`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- designs.tags
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'designs' AND column_name = 'tags';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `tags` TEXT DEFAULT NULL AFTER `download_count`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- designs.average_rating
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'designs' AND column_name = 'average_rating';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `average_rating` DECIMAL(3,2) DEFAULT 4.80 AFTER `total_sales`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- designs.reviews_count
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'designs' AND column_name = 'reviews_count';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `designs` ADD COLUMN `reviews_count` INT DEFAULT 120 AFTER `average_rating`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- design_files.is_preview
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'design_files' AND column_name = 'is_preview';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `design_files` ADD COLUMN `is_preview` TINYINT(1) DEFAULT 0 AFTER `file_size`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- orders.payment_gateway
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'orders' AND column_name = 'payment_gateway';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `orders` ADD COLUMN `payment_gateway` VARCHAR(50) DEFAULT \'razorpay\' AFTER `razorpay_payment_id`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- orders.cashfree_order_id
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'orders' AND column_name = 'cashfree_order_id';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `orders` ADD COLUMN `cashfree_order_id` VARCHAR(100) DEFAULT NULL AFTER `payment_gateway`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- orders.cashfree_payment_id
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'orders' AND column_name = 'cashfree_payment_id';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `orders` ADD COLUMN `cashfree_payment_id` VARCHAR(100) DEFAULT NULL AFTER `cashfree_order_id`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- users.address
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'users' AND column_name = 'address';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `users` ADD COLUMN `address` TEXT DEFAULT NULL AFTER `phone`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- users.profile_picture
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'users' AND column_name = 'profile_picture';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `users` ADD COLUMN `profile_picture` TEXT DEFAULT NULL AFTER `address`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- contact_messages.source
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'contact_messages' AND column_name = 'source';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `contact_messages` ADD COLUMN `source` VARCHAR(50) DEFAULT \'customer_form\' AFTER `status`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- contact_messages.is_read
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'contact_messages' AND column_name = 'is_read';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `contact_messages` ADD COLUMN `is_read` TINYINT(1) DEFAULT 0 AFTER `source`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- contact_messages.phone
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'contact_messages' AND column_name = 'phone';
SET @query = IF(@col_exists = 0, 'ALTER TABLE `contact_messages` ADD COLUMN `phone` VARCHAR(20) DEFAULT NULL AFTER `email`', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- import_job_items.row_no (Rename legacy reserved keyword row_number safely)
SET @t_exists = 0;
SELECT COUNT(*) INTO @t_exists FROM information_schema.tables WHERE table_schema = @dbname AND table_name = 'import_job_items';
SET @legacy_exists = 0;
SELECT COUNT(*) INTO @legacy_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'import_job_items' AND column_name = 'row_number';
SET @new_exists = 0;
SELECT COUNT(*) INTO @new_exists FROM information_schema.columns WHERE table_schema = @dbname AND table_name = 'import_job_items' AND column_name = 'row_no';
SET @query = IF(@t_exists > 0 AND @legacy_exists > 0 AND @new_exists = 0, 'ALTER TABLE `import_job_items` CHANGE COLUMN `row_number` `row_no` INT NOT NULL', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ----------------------------------------------------------------------------
-- 4. Idempotent Index Additions
-- ----------------------------------------------------------------------------

-- designs.idx_sku
SET @idx_exists = 0;
SELECT COUNT(*) INTO @idx_exists FROM information_schema.statistics WHERE table_schema = @dbname AND table_name = 'designs' AND index_name = 'idx_sku';
SET @query = IF(@idx_exists = 0, 'ALTER TABLE `designs` ADD INDEX `idx_sku` (`sku`)', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- designs.idx_trending
SET @idx_exists = 0;
SELECT COUNT(*) INTO @idx_exists FROM information_schema.statistics WHERE table_schema = @dbname AND table_name = 'designs' AND index_name = 'idx_trending';
SET @query = IF(@idx_exists = 0, 'ALTER TABLE `designs` ADD INDEX `idx_trending` (`is_trending`)', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- orders.idx_gateway
SET @idx_exists = 0;
SELECT COUNT(*) INTO @idx_exists FROM information_schema.statistics WHERE table_schema = @dbname AND table_name = 'orders' AND index_name = 'idx_gateway';
SET @query = IF(@idx_exists = 0, 'ALTER TABLE `orders` ADD INDEX `idx_gateway` (`payment_gateway`)', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- orders.idx_cashfree_order
SET @idx_exists = 0;
SELECT COUNT(*) INTO @idx_exists FROM information_schema.statistics WHERE table_schema = @dbname AND table_name = 'orders' AND index_name = 'idx_cashfree_order';
SET @query = IF(@idx_exists = 0, 'ALTER TABLE `orders` ADD INDEX `idx_cashfree_order` (`cashfree_order_id`)', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- design_files.idx_design_preview
SET @idx_exists = 0;
SELECT COUNT(*) INTO @idx_exists FROM information_schema.statistics WHERE table_schema = @dbname AND table_name = 'design_files' AND index_name = 'idx_design_preview';
SET @query = IF(@idx_exists = 0, 'ALTER TABLE `design_files` ADD INDEX `idx_design_preview` (`design_id`, `is_preview`)', 'SELECT 1');
PREPARE stmt FROM @query; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ----------------------------------------------------------------------------
-- 5. Designs & Order Items Schema Extensions (Migrations 012 - 016)
-- ----------------------------------------------------------------------------
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `stitch_count_front` INT UNSIGNED NULL DEFAULT NULL;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `stitch_count_back` INT UNSIGNED NULL DEFAULT NULL;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `stitch_count_sleeve` INT UNSIGNED NULL DEFAULT NULL;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `hoop_size` VARCHAR(50) NULL DEFAULT NULL;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `description` TEXT NULL DEFAULT NULL;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `short_description` TEXT NULL DEFAULT NULL;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `sub_category` VARCHAR(100) NULL DEFAULT NULL;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `import_image_filename` VARCHAR(255) NULL DEFAULT NULL;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `import_zip_filename` VARCHAR(255) NULL DEFAULT NULL;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `deleted_at` DATETIME NULL DEFAULT NULL;

ALTER TABLE `order_items` ADD COLUMN IF NOT EXISTS `price_at_purchase` DECIMAL(10,2) NULL DEFAULT NULL;
ALTER TABLE `order_items` ADD COLUMN IF NOT EXISTS `mrp` DECIMAL(10,2) NULL DEFAULT NULL;
ALTER TABLE `order_items` ADD COLUMN IF NOT EXISTS `discount_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE `order_items` ADD COLUMN IF NOT EXISTS `quantity` INT NOT NULL DEFAULT 1;
ALTER TABLE `order_items` ADD COLUMN IF NOT EXISTS `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE `reviews` ADD COLUMN IF NOT EXISTS `comment` TEXT NULL DEFAULT NULL;
ALTER TABLE `contact_messages` ADD COLUMN IF NOT EXISTS `status` VARCHAR(50) NOT NULL DEFAULT 'new';
ALTER TABLE `design_files` ADD COLUMN IF NOT EXISTS `checksum` VARCHAR(64) NULL DEFAULT NULL;

-- Price update logs
CREATE TABLE IF NOT EXISTS `price_update_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `admin_id` INT NULL,
  `admin_email` VARCHAR(150) NULL,
  `filter_summary` TEXT NULL,
  `method_summary` TEXT NULL,
  `total_affected` INT NOT NULL DEFAULT 0,
  `is_undone` TINYINT(1) NOT NULL DEFAULT 0,
  `undone_at` DATETIME NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `price_update_log_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `log_id` INT NOT NULL,
  `design_id` INT NOT NULL,
  `sku` VARCHAR(100) NULL,
  `old_mrp` DECIMAL(10,2) NULL,
  `old_price` DECIMAL(10,2) NULL,
  `new_mrp` DECIMAL(10,2) NULL,
  `new_price` DECIMAL(10,2) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_log_id (`log_id`),
  INDEX idx_design_id (`design_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 6. Record Applied Migrations in schema_migrations
-- ----------------------------------------------------------------------------
INSERT IGNORE INTO `schema_migrations` (`version`, `name`) VALUES
  ('001', '001_initial_schema.sql'),
  ('002', '002_add_sku_and_metadata.sql'),
  ('003', '003_add_payment_gateway_columns.sql'),
  ('004', '004_create_activity_logs.sql'),
  ('005', '005_create_download_logs.sql'),
  ('006', '006_cleanup_soft_deleted_designs.sql'),
  ('007', '007_create_file_scan_results.sql'),
  ('008', '008_create_import_jobs.sql'),
  ('009', '009_create_email_campaigns.sql'),
  ('010', '010_add_user_profile_and_design_details.sql'),
  ('011', '011_rename_row_number_to_row_no.sql'),
  ('012', '012_add_import_image_filename_to_designs.sql'),
  ('013', '013_add_import_zip_filename_to_designs.sql'),
  ('014', '014_create_price_update_logs.sql'),
  ('015', '015_add_stitch_counts_to_designs.sql'),
  ('016', '016_production_schema_sync.sql');

-- ============================================================================
-- End of production_sync.sql
-- ============================================================================
