-- Migration 030: Seed feature_cards setting if not present
-- Compatible with MariaDB 10.2+ and MySQL 5.7+. 100% idempotent with zero data loss.

INSERT INTO `settings` (`setting_key`, `setting_value`, `updated_at`)
SELECT 'feature_cards', '{"master":true,"pages":{"home":false,"custom_order":true,"about":true,"design_detail":true,"contact":true,"categories":true},"cards":[{"id":"card_1","title":"Premium Quality","subtitle":"Crafted with precision","icon":"fa-solid fa-award","enabled":true,"link":"","order":1},{"id":"card_2","title":"Instant Download","subtitle":"Get files immediately","icon":"fa-solid fa-download","enabled":true,"link":"","order":2},{"id":"card_3","title":"100% Tested","subtitle":"Quality assured designs","icon":"fa-solid fa-shield-halved","enabled":true,"link":"","order":3},{"id":"card_4","title":"Dedicated Support","subtitle":"We''re here to help you","icon":"fa-solid fa-headset","enabled":true,"link":"","order":4}]}', NOW()
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM `settings` WHERE `setting_key` = 'feature_cards'
);

INSERT IGNORE INTO `schema_migrations` (`version`, `name`) VALUES ('030', '030_seed_feature_cards_settings.sql');
