-- Migration 025: Create upload_sessions table for chunked, resumable uploads
-- Safe, idempotent for MariaDB 10.2+ and MySQL 5.7+

CREATE TABLE IF NOT EXISTS `upload_sessions` (
  `id` VARCHAR(100) NOT NULL,
  `user_id` INT NULL,
  `filename` VARCHAR(255) NOT NULL,
  `file_size` BIGINT NOT NULL DEFAULT 0,
  `total_chunks` INT NOT NULL DEFAULT 1,
  `uploaded_chunks` INT NOT NULL DEFAULT 0,
  `upload_type` VARCHAR(50) NOT NULL DEFAULT 'image',
  `status` VARCHAR(50) NOT NULL DEFAULT 'uploading',
  `error_message` TEXT NULL,
  `reference_id` VARCHAR(100) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_upload_sessions_user_status` (`user_id`, `status`),
  INDEX `idx_upload_sessions_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
