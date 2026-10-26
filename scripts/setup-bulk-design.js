const db = require('../config/db');

async function run() {
  try {
    let catRows = await db.query("SELECT id FROM categories WHERE slug='bulk-designs'");
    let catId;
    if (!catRows || catRows.length === 0) {
      const res = await db.query("INSERT INTO categories (name, slug, is_active) VALUES ('Bulk Designs', 'bulk-designs', 1)");
      catId = res.insertId;
    } else {
      catId = catRows[0].id;
    }

    let designRows = await db.query("SELECT id FROM designs WHERE slug='aruvi-designs-1'");
    let designId;
    if (!designRows || designRows.length === 0) {
      const res = await db.query(
        "INSERT INTO designs (title, slug, sku, category_id, price, sale_price, is_active, formats, stitch_count) VALUES ('ARUVI DESIGNS 1', 'aruvi-designs-1', 'AED-BUL-01', ?, 450, 200, 1, 'DST', 25000)",
        [catId]
      );
      designId = res.insertId;
    } else {
      designId = designRows[0].id;
    }

    await db.query("DELETE FROM design_images WHERE design_id=?", [designId]);
    for (let i = 1; i <= 10; i++) {
      await db.query(
        "INSERT INTO design_images (design_id, image_url, is_primary, display_order) VALUES (?, ?, ?, ?)",
        [designId, '/public/images/cat_floral.jpg', i === 1 ? 1 : 0, i]
      );
    }

    // Attach 5 distinct files
    await db.query("DELETE FROM design_files WHERE design_id=?", [designId]);
    for (let i = 1; i <= 5; i++) {
      await db.query(
        "INSERT INTO design_files (design_id, original_name, file_name, file_size, file_format, storage_key, checksum_sha256, sort_order) VALUES (?, ?, ?, ?, 'ZIP', ?, ?, ?)",
        [
          designId,
          `AED ${i}.zip`,
          `AED_${i}.zip`,
          200000 + i * 50000,
          `downloads/aed_${designId}_${i}.zip`,
          `sha256_mock_bulk_${i}`,
          i
        ]
      );
    }

    console.log(`Bulk design ready at /design/aruvi-designs-1 (ID: ${designId})`);
    process.exit(0);
  } catch (err) {
    console.error('Error setting up bulk design:', err);
    process.exit(1);
  }
}

run();
