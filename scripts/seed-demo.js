const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

async function runDemoSeed() {
  console.log('====================================================');
  console.log(' Aruvi Embroidery — Manual Demo Data Seeder');
  console.log(' (Run ONLY when you explicitly want sample products)');
  console.log('====================================================');

  const host = process.env.DB_HOST || 'localhost';
  const port = parseInt(process.env.DB_PORT || '3306');
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'aruvi_embroidery';

  let connection;
  try {
    connection = await mysql.createConnection({
      host,
      port,
      user,
      password,
      database,
      multipleStatements: true
    });

    console.log(`Connected to database: ${database}`);

    // Insert demo designs
    const demoDesignsSql = `
      INSERT IGNORE INTO \`designs\` (\`id\`, \`title\`, \`slug\`, \`sku\`, \`description\`, \`price\`, \`sale_price\`, \`category_id\`, \`hoop_size\`, \`stitch_count\`, \`dimensions\`, \`formats\`, \`is_featured\`, \`is_active\`, \`total_sales\`, \`average_rating\`, \`reviews_count\`) VALUES
      (1, 'Rose Floral Design', 'rose-floral-design', 'AED-FLO-01', 'A beautiful rose floral embroidery design, perfect for sarees, blouses, kurtis and decor.', 399.00, 299.00, 1, '5x7 inch (130x180 mm)', 24800, '140mm x 180mm', 'DST, PES, JEF, EXP', 1, 1, 0, 0.00, 0),
      (2, 'Lotus Mandala', 'lotus-mandala', 'AED-FLO-02', 'Sacred lotus mandala motif with symmetrical petal fill stitches.', 449.00, 349.00, 1, '7x7 inch (180x180 mm)', 31200, '170mm x 170mm', 'DST, PES, JEF, EXP', 1, 1, 0, 0.00, 0),
      (3, 'Butterfly Floral', 'butterfly-floral', 'AED-FLO-03', 'Vibrant butterfly perched on blooming wild roses with multi-colored thread fills.', 299.00, 249.00, 1, '6x6 inch (150x150 mm)', 19500, '145mm x 145mm', 'DST, PES, JEF, EXP', 1, 1, 0, 0.00, 0),
      (4, 'Letter A Monogram', 'letter-a-monogram', 'AED-MON-01', 'Royal ornate alphabet monogram with delicate floral vines surrounding letter A.', 249.00, 199.00, 2, '4x4 inch (100x100 mm)', 12400, '95mm x 95mm', 'DST, PES, JEF, EXP', 1, 1, 0, 0.00, 0),
      (5, 'Peacock Design', 'peacock-design', 'AED-TRA-01', 'Grand royal peacock motif with detailed tail feathers and gold thread highlights.', 499.00, 399.00, 4, '8x10 inch (200x250 mm)', 42500, '190mm x 240mm', 'DST, PES, JEF, EXP', 1, 1, 0, 0.00, 0),
      (6, 'Border Pattern', 'border-pattern', 'AED-BOR-01', 'Continuous cutwork floral border pattern for dupattas and saree hems.', 349.00, 299.00, 5, '5x8 inch (130x200 mm)', 22100, '120mm x 195mm', 'DST, PES, JEF, EXP', 1, 1, 0, 0.00, 0);

      INSERT IGNORE INTO \`design_images\` (\`id\`, \`design_id\`, \`image_url\`, \`is_primary\`, \`display_order\`) VALUES
      (1, 1, '/public/images/logo.jpg', 1, 1),
      (2, 2, '/public/images/logo.jpg', 1, 1),
      (3, 3, '/public/images/logo.jpg', 1, 1),
      (4, 4, '/public/images/logo.jpg', 1, 1),
      (5, 5, '/public/images/logo.jpg', 1, 1),
      (6, 6, '/public/images/logo.jpg', 1, 1);
    `;

    await connection.query(demoDesignsSql);
    console.log('✓ [SUCCESS] Demo designs inserted successfully.');
    console.log('====================================================');
  } catch (err) {
    console.error('❌ Demo Seeding Error:', err.message);
  } finally {
    if (connection) await connection.end();
  }
}

if (require.main === module) {
  runDemoSeed();
}

module.exports = runDemoSeed;
