-- Migration 007: Create file_scan_results and scan_jobs tables for background file integrity monitoring
-- Never drops or alters existing product data.

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
