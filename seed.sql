-- ============================================================
-- Aruvi Embroidery Minimal Clean Seed Data
-- Tagline: Where Threads Tell Stories
-- Note: Contains ONLY admin setup, default categories, and settings.
-- No fake orders, fake customers, fake revenue, or fake reviews.
-- Demo products can be inserted separately using: npm run seed:demo
-- ============================================================

-- 1. Roles
INSERT IGNORE INTO `roles` (`id`, `name`, `description`) VALUES
(1, 'admin', 'Full store administration access'),
(2, 'customer', 'Standard shopper access');

-- 2. Initial Admin Account (Strictly minimal - No demo customer)
-- Admin: admin@aruviembroidery.com / admin123
INSERT IGNORE INTO `users` (`id`, `full_name`, `email`, `password_hash`, `phone`, `role`, `is_active`) VALUES
(1, 'Aruvi Admin', 'admin@aruviembroidery.com', '$2b$10$4.oYvN1T.qK9P7V0z8kQ/eN/28vP8X2y8W1Z5A4B3C2D1E0F1G2H3', '+91 98765 43210', 'admin', 1);

-- 3. Default Store Categories
INSERT IGNORE INTO `categories` (`id`, `name`, `slug`, `description`, `image_url`, `display_order`, `is_active`) VALUES
(1, 'Floral Designs', 'floral-designs', 'Floral & botanical embroidery motifs', '/public/images/cat_floral.jpg', 1, 1),
(2, 'Monogram Designs', 'monogram-designs', 'Lettering, initials & ornate monogram patterns', '/public/images/cat_monogram.jpg', 2, 1),
(3, 'Kids Designs', 'kids-designs', 'Playful & colorful kids embroidery patterns', '/public/images/cat_kids.jpg', 3, 1),
(4, 'Traditional Designs', 'traditional-designs', 'Heritage South Indian & ethnic motifs', '/public/images/cat_traditional.jpg', 4, 1),
(5, 'Border Designs', 'border-designs', 'Saree hem, sleeve & dupatta border laces', '/public/images/cat_border.jpg', 5, 1),
(6, 'Blouse Designs', 'blouse-designs', 'Bridal & festive neckline blouse patterns', '/public/images/cat_blouse.jpg', 6, 1);

-- 4. Initial Settings & Homepage Content (Admin Editable)
INSERT IGNORE INTO `settings` (`setting_key`, `setting_value`) VALUES
('announcement_bar', 'Premium Machine Embroidery Designs — DST, PES, JEF, EXP & More | Instant Download'),
('hero_eyebrow', 'PREMIUM EMBROIDERY STUDIO'),
('hero_title', 'Stitch Your\nImagination Into Life'),
('hero_subtitle', 'Explore high-precision digitized embroidery designs crafted for passionate makers. Instant digital downloads in DST, PES, JEF, and EXP formats.'),
('hero_image', '/public/images/hero_embroidery.jpg'),
('stat_designs_count', '0'),
('stat_customers_count', '0'),
('stat_rating', '5.0'),
('shop_name', 'ARUVI EMBROIDERY STUDIO'),
('tagline', 'Where Threads Tell Stories'),
('contact_email', 'aruviembroidery@gmail.com'),
('contact_phone', '+91 98765 43210'),
('address', '124 Silk Thread Avenue, Chennai, Tamil Nadu, India');
