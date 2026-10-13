-- Migration 014: Create Price Update Logs tables and add deleted_at to designs

-- 1. price_update_logs table
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

-- 2. price_update_log_items table
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
  INDEX `idx_log_id` (`log_id`),
  INDEX `idx_design_id` (`design_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Add deleted_at to designs table for safe soft-deletion
ALTER TABLE `designs` ADD COLUMN IF NOT EXISTS `deleted_at` DATETIME NULL;
