-- ============================================================================
-- Migration 021: Unique Constraint & Deduplication for Design Files & Images
-- Purpose:
--   1. Clean existing duplicates in design_files keeping lowest ID (preserving label & sort order).
--   2. Remap download_logs to the kept lowest ID.
--   3. Clean existing duplicates in design_images keeping lowest ID.
--   4. Add UNIQUE constraint (design_id, checksum_sha256) on design_files to prevent double inserts.
--   5. Ensure MariaDB & MySQL compatibility and full idempotency.
-- ============================================================================

-- 1. Remap download_logs references for duplicate storage_keys to lowest ID
UPDATE `download_logs` dl
JOIN (
  SELECT df.id AS duplicate_id, kept.min_id AS target_id
  FROM `design_files` df
  JOIN (
    SELECT `design_id`, `storage_key`, MIN(`id`) AS min_id
    FROM `design_files`
    WHERE `storage_key` IS NOT NULL AND `storage_key` != ''
    GROUP BY `design_id`, `storage_key`
    HAVING COUNT(*) > 1
  ) kept ON df.`design_id` = kept.`design_id` AND df.`storage_key` = kept.`storage_key`
  WHERE df.`id` != kept.min_id
) map ON dl.`file_id` = map.duplicate_id
SET dl.`file_id` = map.target_id;

-- 2. Remap download_logs references for duplicate checksums to lowest ID
UPDATE `download_logs` dl
JOIN (
  SELECT df.id AS duplicate_id, kept.min_id AS target_id
  FROM `design_files` df
  JOIN (
    SELECT `design_id`, `checksum_sha256`, MIN(`id`) AS min_id
    FROM `design_files`
    WHERE `checksum_sha256` IS NOT NULL AND `checksum_sha256` != ''
    GROUP BY `design_id`, `checksum_sha256`
    HAVING COUNT(*) > 1
  ) kept ON df.`design_id` = kept.`design_id` AND df.`checksum_sha256` = kept.`checksum_sha256`
  WHERE df.`id` != kept.min_id
) map ON dl.`file_id` = map.duplicate_id
SET dl.`file_id` = map.target_id;

-- 3. Delete duplicate rows from design_files by storage_key (keeping lowest ID)
DELETE df FROM `design_files` df
JOIN (
  SELECT `design_id`, `storage_key`, MIN(`id`) AS min_id
  FROM `design_files`
  WHERE `storage_key` IS NOT NULL AND `storage_key` != ''
  GROUP BY `design_id`, `storage_key`
  HAVING COUNT(*) > 1
) kept ON df.`design_id` = kept.`design_id` AND df.`storage_key` = kept.`storage_key`
WHERE df.`id` != kept.min_id;

-- 4. Delete duplicate rows from design_files by checksum_sha256 (keeping lowest ID)
DELETE df FROM `design_files` df
JOIN (
  SELECT `design_id`, `checksum_sha256`, MIN(`id`) AS min_id
  FROM `design_files`
  WHERE `checksum_sha256` IS NOT NULL AND `checksum_sha256` != ''
  GROUP BY `design_id`, `checksum_sha256`
  HAVING COUNT(*) > 1
) kept ON df.`design_id` = kept.`design_id` AND df.`checksum_sha256` = kept.`checksum_sha256`
WHERE df.`id` != kept.min_id;

-- 5. Delete duplicate rows from design_images by image_url (keeping lowest ID)
DELETE di FROM `design_images` di
JOIN (
  SELECT `design_id`, `image_url`, MIN(`id`) AS min_id
  FROM `design_images`
  GROUP BY `design_id`, `image_url`
  HAVING COUNT(*) > 1
) kept ON di.`design_id` = kept.`design_id` AND di.`image_url` = kept.`image_url`
WHERE di.`id` != kept.min_id;

-- 6. Add UNIQUE constraint to prevent duplicate files on the same design (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS `idx_design_file_unique` ON `design_files` (`design_id`, `checksum_sha256`);
