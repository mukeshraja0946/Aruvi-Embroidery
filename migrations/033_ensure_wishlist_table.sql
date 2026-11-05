-- =============================================================================
-- Migration 033: Ensure Wishlist Table Exists (MariaDB / MySQL Idempotent)
-- =============================================================================

CREATE TABLE IF NOT EXISTS `wishlist` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `design_id` INT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `unique_user_design` (`user_id`, `design_id`),
  INDEX `idx_wishlist_user` (`user_id`),
  INDEX `idx_wishlist_design` (`design_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

