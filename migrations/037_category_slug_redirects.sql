-- ============================================================================
-- Migration 037: Create category_slug_redirects table for 301 SEO redirects
-- Idempotent, MariaDB & MySQL compatible, information_schema guarded, no data loss.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `category_slug_redirects` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `category_id` INT NOT NULL,
  `old_slug` VARCHAR(120) NOT NULL,
  `new_slug` VARCHAR(120) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_cat_old_slug` (`old_slug`),
  INDEX `idx_cat_redirect_category_id` (`category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
