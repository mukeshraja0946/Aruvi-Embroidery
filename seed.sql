-- ============================================================
-- Aruvi Embroidery Seed Data (Matching Reference UI)
-- Tagline: Where Threads Tell Stories
-- ============================================================

-- ------------------------------------------------------------
-- Database selection (Commented out for phpMyAdmin / Hostinger compatibility)
-- USE `aruvi_embroidery`;
-- ------------------------------------------------------------

-- 1. Roles
INSERT IGNORE INTO `roles` (`id`, `name`, `description`) VALUES
(1, 'admin', 'Full store administration access'),
(2, 'customer', 'Standard shopper access');

-- 2. Initial Admin & Test Customer
-- Admin: admin@aruviembroidery.com / admin123
-- Customer: customer@aruviembroidery.com / customer123
INSERT IGNORE INTO `users` (`id`, `full_name`, `email`, `password_hash`, `phone`, `role`, `is_active`) VALUES
(1, 'Aruvi Admin', 'admin@aruviembroidery.com', '$2b$10$4.oYvN1T.qK9P7V0z8kQ/eN/28vP8X2y8W1Z5A4B3C2D1E0F1G2H3', '+91 98765 43210', 'admin', 1),
(2, 'Priya Lakshmi', 'customer@aruviembroidery.com', '$2b$10$4.oYvN1T.qK9P7V0z8kQ/eN/28vP8X2y8W1Z5A4B3C2D1E0F1G2H3', '+91 91234 56789', 'customer', 1);

-- 3. Categories (Exact Reference Match)
INSERT IGNORE INTO `categories` (`id`, `name`, `slug`, `description`, `image_url`, `display_order`, `is_active`) VALUES
(1, 'Floral Designs', 'floral-designs', '500+ Designs', '/public/images/cat_floral.jpg', 1, 1),
(2, 'Monogram Designs', 'monogram-designs', '300+ Designs', '/public/images/cat_monogram.jpg', 2, 1),
(3, 'Kids Designs', 'kids-designs', '250+ Designs', '/public/images/cat_kids.jpg', 3, 1),
(4, 'Traditional Designs', 'traditional-designs', '400+ Designs', '/public/images/cat_traditional.jpg', 4, 1),
(5, 'Border Designs', 'border-designs', '350+ Designs', '/public/images/cat_border.jpg', 5, 1),
(6, 'Blouse Designs', 'blouse-designs', '300+ Designs', '/public/images/cat_blouse.jpg', 6, 1);

-- 4. Sample Designs (Exact Reference Match)
INSERT IGNORE INTO `designs` (`id`, `title`, `slug`, `description`, `price`, `sale_price`, `category_id`, `hoop_size`, `stitch_count`, `dimensions`, `formats`, `is_featured`, `is_active`, `total_sales`, `average_rating`, `reviews_count`) VALUES
(1, 'Rose Floral Design', 'rose-floral-design', 'A beautiful rose floral embroidery design, perfect for sarees, blouses, kurtis, home decor and more. This design is tested and ready to use in DST, PES, JEF and EXP formats.', 399.00, 299.00, 1, '5x7 inch (130x180 mm)', 24800, '140mm x 180mm', 'DST, PES, JEF, EXP', 1, 1, 120, 4.80, 120),
(2, 'Lotus Mandala', 'lotus-mandala', 'Sacred lotus mandala motif with intricate symmetrical petal fill stitches. Perfect for festive saree backs and blouse motifs.', 449.00, 349.00, 1, '7x7 inch (180x180 mm)', 31200, '170mm x 170mm', 'DST, PES, JEF, EXP', 1, 1, 85, 4.90, 85),
(3, 'Butterfly Floral', 'butterfly-floral', 'Vibrant butterfly perched on blooming wild roses. Multi-colored thread fills engineered for zero thread break output.', 299.00, 249.00, 1, '6x6 inch (150x150 mm)', 19500, '145mm x 145mm', 'DST, PES, JEF, EXP', 1, 1, 64, 4.70, 64),
(4, 'Letter A Monogram', 'letter-a-monogram', 'Royal ornate alphabet monogram with delicate floral vines surrounding letter A. Ideal for handkerchiefs, towels and boutique branding.', 249.00, 199.00, 2, '4x4 inch (100x100 mm)', 12400, '95mm x 95mm', 'DST, PES, JEF, EXP', 1, 1, 95, 4.90, 95),
(5, 'Peacock Design', 'peacock-design', 'Grand royal peacock motif with detailed tail feathers and gold thread highlights. Iconic South Indian bridal favorite.', 499.00, 399.00, 4, '8x10 inch (200x250 mm)', 42500, '190mm x 240mm', 'DST, PES, JEF, EXP', 1, 1, 142, 5.00, 142),
(6, 'Border Pattern', 'border-pattern', 'Continuous cutwork floral border pattern for dupattas, saree hems, and sleeve borders.', 349.00, 299.00, 5, '5x8 inch (130x200 mm)', 22100, '120mm x 195mm', 'DST, PES, JEF, EXP', 1, 1, 78, 4.85, 78);

-- 5. Design Images
INSERT IGNORE INTO `design_images` (`id`, `design_id`, `image_url`, `is_primary`, `display_order`) VALUES
(1, 1, '/public/images/logo.jpg', 1, 1),
(2, 2, '/public/images/logo.jpg', 1, 1),
(3, 3, '/public/images/logo.jpg', 1, 1),
(4, 4, '/public/images/logo.jpg', 1, 1),
(5, 5, '/public/images/logo.jpg', 1, 1),
(6, 6, '/public/images/logo.jpg', 1, 1);

-- 6. Design Files
INSERT IGNORE INTO `design_files` (`id`, `design_id`, `file_name`, `file_path`, `file_format`, `file_size`) VALUES
(1, 1, 'Rose_Floral_Design.zip', '/public/uploads/designs/sample_peacock.zip', 'ZIP', 2450123),
(2, 2, 'Lotus_Mandala.zip', '/public/uploads/designs/sample_ganesha.zip', 'ZIP', 1890432),
(3, 3, 'Butterfly_Floral.zip', '/public/uploads/designs/sample_lotus.zip', 'ZIP', 1420980),
(4, 4, 'Letter_A_Monogram.zip', '/public/uploads/designs/sample_elephant.zip', 'ZIP', 1650320),
(5, 5, 'Peacock_Design.zip', '/public/uploads/designs/sample_floral.zip', 'ZIP', 2980450),
(6, 6, 'Border_Pattern.zip', '/public/uploads/designs/sample_radha.zip', 'ZIP', 2110540);

-- 7. Custom Orders (Sample Data)
INSERT IGNORE INTO `custom_orders` (`id`, `user_id`, `full_name`, `email`, `phone`, `design_details`, `reference_image_url`, `status`) VALUES
(1, 2, 'Priya Lakshmi', 'customer@aruviembroidery.com', '+91 91234 56789', 'Need a custom 10x14 inch jumbo peacock neck design for silk saree blouse with zardozi thread density.', '/public/images/logo.jpg', 'reviewing');

-- 8. Coupons
INSERT IGNORE INTO `coupons` (`id`, `code`, `discount_type`, `discount_value`, `min_purchase`, `expiry_date`, `usage_limit`, `is_active`) VALUES
(1, 'WELCOME10', 'percentage', 10.00, 199.00, '2026-12-31', 500, 1),
(2, 'ARUVIFLAT50', 'fixed', 50.00, 399.00, '2026-12-31', 200, 1);

-- 9. Initial Settings & Homepage Content (Admin Editable)
INSERT IGNORE INTO `settings` (`setting_key`, `setting_value`) VALUES
('announcement_bar', 'Premium Machine Embroidery Designs — DST, PES, JEF, EXP & More | Instant Download'),
('hero_eyebrow', 'PREMIUM EMBROIDERY STUDIO'),
('hero_title', 'Stitch Your\nImagination Into Life'),
('hero_subtitle', 'Explore high-precision digitized embroidery designs crafted for passionate makers. Instant digital downloads in DST, PES, JEF, and EXP formats.'),
('hero_image', '/public/images/hero_embroidery.jpg'),
('stat_designs_count', '5000+'),
('stat_customers_count', '1000+'),
('stat_rating', '4.8+'),
('shop_name', 'ARUVI EMBROIDERY STUDIO'),
('tagline', 'Where Threads Tell Stories'),
('contact_email', 'aruviembroidery@gmail.com'),
('contact_phone', '+91 98765 43210'),
('address', '124 Silk Thread Avenue, Chennai, Tamil Nadu, India');
