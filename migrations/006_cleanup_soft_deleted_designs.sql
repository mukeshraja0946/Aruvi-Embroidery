-- Migration 006: Safely remove orphaned soft-deleted test designs that have no customer orders
DELETE FROM `designs` WHERE `is_active` < 0 AND `id` NOT IN (SELECT DISTINCT `design_id` FROM `order_items`);
