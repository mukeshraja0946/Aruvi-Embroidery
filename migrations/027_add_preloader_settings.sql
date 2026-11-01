-- Migration 027: Add Animated Branding & Preloader Settings
-- Idempotent, safe for MariaDB 10.2+ and MySQL 5.7+, no reserved words, no data loss.
-- Can be safely run multiple times in phpMyAdmin or automatic migration runner.

CREATE TABLE IF NOT EXISTS `settings` (
  `setting_key` VARCHAR(191) NOT NULL PRIMARY KEY,
  `setting_value` TEXT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `settings` (`setting_key`, `setting_value`) VALUES
  ('preloader_enabled', '1'),
  ('preloader_style', 'stitching_hexagon'),
  ('preloader_speed', 'normal'),
  ('preloader_min_time', '900'),
  ('preloader_max_time', '3500'),
  ('preloader_exit_effect', 'fade'),
  ('preloader_frequency', 'session'),
  ('preloader_show_tagline', '1'),
  ('preloader_color_primary', '#4B0F1C'),
  ('preloader_color_secondary', '#C7876C'),
  ('preloader_color_rose', '#BB4558'),
  ('preloader_color_bg', '#F8E8E2'),
  ('preloader_color_thread', '#EFC09B'),
  ('preloader_color_stitch', '#911628'),
  ('preloader_custom_url', '')
ON DUPLICATE KEY UPDATE `setting_key` = `setting_key`;
