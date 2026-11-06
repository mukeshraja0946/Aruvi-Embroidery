-- ============================================================================
-- Migration 036: Add Performance Indexes for 504 Gateway Timeout Prevention
-- Idempotent, MariaDB & MySQL compatible, guarded by information_schema.statistics
-- Lock wait timeout set to 10s to ensure migrations fail fast without hanging
-- ============================================================================

SET SESSION lock_wait_timeout = 10;
SET SESSION wait_timeout = 30;

-- 1. Index on designs(category_id, is_active, created_at)
-- Accelerates Home page design counts, category queries, and recent designs
SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.statistics 
  WHERE table_schema = DATABASE() 
    AND table_name = 'designs' 
    AND index_name = 'idx_designs_cat_active_created'
);
SET @sql_stmt = IF(@idx_exists = 0, 
  'CREATE INDEX `idx_designs_cat_active_created` ON `designs` (`category_id`, `is_active`, `created_at`)', 
  'SELECT 1'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Index on design_images(design_id, is_primary)
-- Accelerates card preview image lookups across home, shop, and category listings
SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.statistics 
  WHERE table_schema = DATABASE() 
    AND table_name = 'design_images' 
    AND index_name = 'idx_design_images_design_primary'
);
SET @sql_stmt = IF(@idx_exists = 0, 
  'CREATE INDEX `idx_design_images_design_primary` ON `design_images` (`design_id`, `is_primary`)', 
  'SELECT 1'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. Index on design_files(design_id)
-- Accelerates format chips, download links, and archive file checks
SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.statistics 
  WHERE table_schema = DATABASE() 
    AND table_name = 'design_files' 
    AND index_name = 'idx_design_files_design_id'
);
SET @sql_stmt = IF(@idx_exists = 0, 
  'CREATE INDEX `idx_design_files_design_id` ON `design_files` (`design_id`)', 
  'SELECT 1'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4. Index on categories(show_on_home, sort_order)
-- Accelerates Home page Popular Categories query without sorting in temp table
SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.statistics 
  WHERE table_schema = DATABASE() 
    AND table_name = 'categories' 
    AND index_name = 'idx_categories_home_sort'
);
SET @sql_stmt = IF(@idx_exists = 0, 
  'CREATE INDEX `idx_categories_home_sort` ON `categories` (`show_on_home`, `sort_order`)', 
  'SELECT 1'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5. Index on orders(user_id)
-- Accelerates customer profile orders lookup and checkout history
SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.statistics 
  WHERE table_schema = DATABASE() 
    AND table_name = 'orders' 
    AND index_name = 'idx_orders_user_id'
);
SET @sql_stmt = IF(@idx_exists = 0, 
  'CREATE INDEX `idx_orders_user_id` ON `orders` (`user_id`)', 
  'SELECT 1'
);
PREPARE stmt FROM @sql_stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
