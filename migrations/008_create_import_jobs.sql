-- Migration 008: Create import_jobs and import_job_items for reliable 3-step bulk import & rollback
-- Safe numbered migration; never drops existing catalog data.

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
