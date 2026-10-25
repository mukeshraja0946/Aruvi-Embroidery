-- ============================================================================
-- Migration 016: Comprehensive Production Schema Synchronization
-- Target: MariaDB 10.x (Hostinger) & MySQL 8.x
-- Purpose: Ensures all tables and columns used across models, controllers, and
--          services exist with safe defaults and zero data loss.
-- Safety: STRICTLY IDEMPOTENT. Never drops, truncates, renames, or deletes data.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. DESIGNS TABLE: Missing Stitch Counts, Metadata & Import Columns
-- ----------------------------------------------------------------------------
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `stitch_count_front` INT UNSIGNED NULL DEFAULT NULL;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `stitch_count_back` INT UNSIGNED NULL DEFAULT NULL;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `stitch_count_sleeve` INT UNSIGNED NULL DEFAULT NULL;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `hoop_size` VARCHAR(50) NULL DEFAULT NULL;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `description` TEXT NULL DEFAULT NULL;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `short_description` TEXT NULL DEFAULT NULL;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `sub_category` VARCHAR(100) NULL DEFAULT NULL;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `sku` VARCHAR(100) NULL DEFAULT NULL;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `is_trending` TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `download_count` INT NOT NULL DEFAULT 0;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `tags` TEXT NULL DEFAULT NULL;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `average_rating` DECIMAL(3,2) NOT NULL DEFAULT 4.80;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `reviews_count` INT NOT NULL DEFAULT 120;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `import_image_filename` VARCHAR(255) NULL DEFAULT NULL;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `import_zip_filename` VARCHAR(255) NULL DEFAULT NULL;
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `deleted_at` DATETIME NULL DEFAULT NULL;

-- ----------------------------------------------------------------------------
-- 2. ORDER_ITEMS TABLE: Purchase Price, MRP & Discount Columns
-- ----------------------------------------------------------------------------
ALTER TABLE `order_items` ADD COLUMN IF NOT EXISTS `price_at_purchase` DECIMAL(10,2) NULL DEFAULT NULL;
ALTER TABLE `order_items` ADD COLUMN IF NOT EXISTS `mrp` DECIMAL(10,2) NULL DEFAULT NULL;
ALTER TABLE `order_items` ADD COLUMN IF NOT EXISTS `discount_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE `order_items` ADD COLUMN IF NOT EXISTS `quantity` INT NOT NULL DEFAULT 1;
ALTER TABLE `order_items` ADD COLUMN IF NOT EXISTS `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- ----------------------------------------------------------------------------
-- 3. REVIEWS TABLE: Comment Field
-- ----------------------------------------------------------------------------
ALTER TABLE `reviews` ADD COLUMN IF NOT EXISTS `comment` TEXT NULL DEFAULT NULL;

-- ----------------------------------------------------------------------------
-- 4. CONTACT_MESSAGES TABLE: Status Field
-- ----------------------------------------------------------------------------
ALTER TABLE `contact_messages` ADD COLUMN IF NOT EXISTS `status` VARCHAR(50) NOT NULL DEFAULT 'new';

-- ----------------------------------------------------------------------------
-- 5. DESIGN_FILES TABLE: Checksum for ZIP verification
-- ----------------------------------------------------------------------------
ALTER TABLE `design_files` ADD COLUMN IF NOT EXISTS `checksum` VARCHAR(64) NULL DEFAULT NULL;

-- ----------------------------------------------------------------------------
-- 6. CORE TABLES THAT MAY BE MISSING ON LEGACY OR PARTIAL INSTALLATIONS
-- ----------------------------------------------------------------------------

-- Settings (Used by models/Setting.js)
CREATE TABLE IF NOT EXISTS `settings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `setting_key` VARCHAR(100) NOT NULL UNIQUE,
  `setting_value` TEXT DEFAULT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Banners (Used by adminBannerController.js and homepage)
CREATE TABLE IF NOT EXISTS `banners` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `title` VARCHAR(150) NOT NULL,
  `image_url` VARCHAR(255) NOT NULL,
  `link_url` VARCHAR(255) DEFAULT NULL,
  `display_order` INT DEFAULT 0,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Payments (Used by checkoutController.js)
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
  INDEX idx_payment_order (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Import Jobs (Used by bulkImportService.js)
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

-- Import Job Items (Used by bulkImportService.js)
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
  INDEX idx_item_design (`imported_design_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Activity Logs (Used by ActivityLog.js)
CREATE TABLE IF NOT EXISTS `activity_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT DEFAULT NULL,
  `admin_name` VARCHAR(100) DEFAULT NULL,
  `action` VARCHAR(100) NOT NULL,
  `entity_type` VARCHAR(50) NOT NULL,
  `entity_id` INT DEFAULT NULL,
  `details` TEXT DEFAULT NULL,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_action (`action`),
  INDEX idx_entity (`entity_type`, `entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Download Logs (Used by userController.js)
CREATE TABLE IF NOT EXISTS `download_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT DEFAULT NULL,
  `design_id` INT NOT NULL,
  `file_id` INT DEFAULT NULL,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `user_agent` VARCHAR(255) DEFAULT NULL,
  `downloaded_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_download (`user_id`),
  INDEX idx_design_download (`design_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- File Scan Results & Scan Jobs
CREATE TABLE IF NOT EXISTS `file_scan_results` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `design_id` INT NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `sku` VARCHAR(100) DEFAULT NULL,
  `category_name` VARCHAR(100) DEFAULT NULL,
  `price` DECIMAL(10,2) DEFAULT 0.00,
  `is_active` TINYINT(1) DEFAULT 1,
  `image_url` VARCHAR(255) DEFAULT NULL,
  `image_status` VARCHAR(50) DEFAULT 'ok',
  `file_path` VARCHAR(255) DEFAULT NULL,
  `file_name` VARCHAR(255) DEFAULT NULL,
  `file_status` VARCHAR(50) DEFAULT 'ok',
  `scanned_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_scan_design (`design_id`),
  INDEX idx_scan_image (`image_status`),
  INDEX idx_scan_file (`file_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `scan_jobs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `status` ENUM('running', 'completed', 'failed') DEFAULT 'running',
  `total_designs` INT DEFAULT 0,
  `scanned_designs` INT DEFAULT 0,
  `missing_images` INT DEFAULT 0,
  `missing_files` INT DEFAULT 0,
  `missing_both` INT DEFAULT 0,
  `started_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `completed_at` DATETIME DEFAULT NULL,
  `error_message` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Email Campaigns & Logs
CREATE TABLE IF NOT EXISTS `email_campaigns` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `subject` VARCHAR(255) NOT NULL,
  `body_html` LONGTEXT NOT NULL,
  `total_recipients` INT DEFAULT 0,
  `success_count` INT DEFAULT 0,
  `failed_count` INT DEFAULT 0,
  `status` ENUM('draft', 'sending', 'sent', 'failed') DEFAULT 'draft',
  `sent_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `email_campaign_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `campaign_id` INT NOT NULL,
  `recipient_email` VARCHAR(150) NOT NULL,
  `recipient_name` VARCHAR(100) DEFAULT NULL,
  `status` ENUM('sent', 'failed') DEFAULT 'sent',
  `error_message` TEXT DEFAULT NULL,
  `sent_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_camp (`campaign_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `unsubscribed_customers` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `email` VARCHAR(150) NOT NULL UNIQUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Price Update Logs & Items
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
