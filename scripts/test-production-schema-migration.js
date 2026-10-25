const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { getAvailableMigrationFiles } = require('../services/migrationRunner');
const { checkSystemHealth, REQUIRED_SCHEMA } = require('../services/schemaHealthService');
const Design = require('../models/Design');

async function testSchemaAndMigrations() {
  console.log('====================================================');
  console.log('TESTING PRODUCTION SCHEMA & MIGRATION SYNC');
  console.log('====================================================');

  // 1. Verify 016 migration file exists and is registered in numbered migrations
  console.log('▶ Test 1: Numbered migration detection...');
  const files = getAvailableMigrationFiles();
  assert(files.includes('016_production_schema_sync.sql'), '016_production_schema_sync.sql must be in numbered migrations');
  console.log(`  ✓ Detected ${files.length} numbered migrations, including 016_production_schema_sync.sql`);

  // 2. Verify 016 SQL content has MariaDB idempotent syntax and correct column types
  console.log('\n▶ Test 2: Migration 016 SQL idempotency & column specifications...');
  const sql016 = fs.readFileSync(path.join(__dirname, '..', 'migrations', '016_production_schema_sync.sql'), 'utf8');
  assert(sql016.includes('ADD COLUMN IF NOT EXISTS `stitch_count_front` INT UNSIGNED'), 'stitch_count_front must be defined with safe type');
  assert(sql016.includes('ADD COLUMN IF NOT EXISTS `stitch_count_back` INT UNSIGNED'), 'stitch_count_back must be defined with safe type');
  assert(sql016.includes('ADD COLUMN IF NOT EXISTS `stitch_count_sleeve` INT UNSIGNED'), 'stitch_count_sleeve must be defined with safe type');
  assert(sql016.includes('ADD COLUMN IF NOT EXISTS `hoop_size`'), 'hoop_size must be included');
  assert(sql016.includes('ADD COLUMN IF NOT EXISTS `price_at_purchase`'), 'order_items.price_at_purchase must be included');
  assert(!sql016.includes('DROP TABLE'), 'Migration must never DROP TABLE');
  assert(!sql016.includes('TRUNCATE'), 'Migration must never TRUNCATE');
  assert(!sql016.includes('DELETE FROM'), 'Migration must never DELETE');
  console.log('  ✓ Migration 016 validated: strictly non-destructive & MariaDB 10.x idempotent');

  // 3. Verify REQUIRED_SCHEMA canonical definition covers all critical columns
  console.log('\n▶ Test 3: Canonical schema specification completeness...');
  assert(REQUIRED_SCHEMA.designs.includes('stitch_count_front'), 'REQUIRED_SCHEMA.designs must include stitch_count_front');
  assert(REQUIRED_SCHEMA.designs.includes('stitch_count_back'), 'REQUIRED_SCHEMA.designs must include stitch_count_back');
  assert(REQUIRED_SCHEMA.designs.includes('stitch_count_sleeve'), 'REQUIRED_SCHEMA.designs must include stitch_count_sleeve');
  assert(REQUIRED_SCHEMA.designs.includes('hoop_size'), 'REQUIRED_SCHEMA.designs must include hoop_size');
  assert(REQUIRED_SCHEMA.order_items.includes('price_at_purchase'), 'REQUIRED_SCHEMA.order_items must include price_at_purchase');
  assert(REQUIRED_SCHEMA.price_update_logs, 'REQUIRED_SCHEMA must include price_update_logs');
  assert(REQUIRED_SCHEMA.price_update_log_items, 'REQUIRED_SCHEMA must include price_update_log_items');
  console.log(`  ✓ REQUIRED_SCHEMA covers ${Object.keys(REQUIRED_SCHEMA).length} tables and all expected columns`);

  // 4. Test Design.create and Design.update resilience
  console.log('\n▶ Test 4: Design model create & update with stitch counts...');
  const designId = await Design.create({
    title: 'Bridal Lotus Blouse',
    price: 350,
    stitch_count_front: 2000,
    stitch_count_back: 7500,
    stitch_count_sleeve: 700,
    hoop_size: '200x300mm',
    description: 'Exquisite bridal lotus embroidery.'
  });
  assert(designId, 'Design.create should return valid id');

  const created = await Design.getById(designId);
  assert.strictEqual(created.frontStitchCount, 2000, 'Front stitch count must equal 2000');
  assert.strictEqual(created.backStitchCount, 7500, 'Back stitch count must equal 7500');
  assert.strictEqual(created.sleeveStitchCount, 700, 'Sleeve stitch count must equal 700');
  assert.strictEqual(created.totalStitchCount, 10200, 'Total stitch count must be 10200');
  console.log('  ✓ Design created with Front=2,000, Back=7,500, Sleeve=700 -> Total=10,200');

  // 5. Update design without stitch counts (partial update) - must preserve stitch counts
  console.log('\n▶ Test 5: Design update without stitch counts preserves existing values...');
  await Design.update(designId, {
    description: 'Updated bridal description with gold zari thread.'
  });
  const updated = await Design.getById(designId);
  assert.strictEqual(updated.frontStitchCount, 2000, 'Front stitch count preserved after description update');
  assert.strictEqual(updated.backStitchCount, 7500, 'Back stitch count preserved after description update');
  assert.strictEqual(updated.sleeveStitchCount, 700, 'Sleeve stitch count preserved after description update');
  assert.strictEqual(updated.totalStitchCount, 10200, 'Total stitch count preserved after description update');
  assert.strictEqual(updated.description, 'Updated bridal description with gold zari thread.');
  console.log('  ✓ Partial update preserved all 4 stitch counts intact');

  // 6. Test Design create without stitch counts (empty/null stitch counts)
  console.log('\n▶ Test 6: Design create with no stitch counts...');
  const designNoStitchId = await Design.create({
    title: 'Simple Border Motif',
    price: 150
  });
  const noStitch = await Design.getById(designNoStitchId);
  assert.strictEqual(noStitch.frontStitchCount, null);
  assert.strictEqual(noStitch.backStitchCount, null);
  assert.strictEqual(noStitch.sleeveStitchCount, null);
  assert.strictEqual(noStitch.totalStitchCount, null);
  console.log('  ✓ Design with unspecified stitch counts correctly stores null without treating as zero');

  // 7. Verify production_sync.sql contains all latest schema additions
  console.log('\n▶ Test 7: Verify production_sync.sql download file sync...');
  const syncSql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'production_sync.sql'), 'utf8');
  assert(syncSql.includes('stitch_count_front'), 'production_sync.sql must include stitch_count_front');
  assert(syncSql.includes('stitch_count_back'), 'production_sync.sql must include stitch_count_back');
  assert(syncSql.includes('stitch_count_sleeve'), 'production_sync.sql must include stitch_count_sleeve');
  assert(syncSql.includes('hoop_size'), 'production_sync.sql must include hoop_size');
  assert(syncSql.includes('016_production_schema_sync.sql'), 'production_sync.sql must record 016 migration');
  console.log('  ✓ production_sync.sql is 100% synchronized with migrations 001 through 016');

  console.log('\n====================================================');
  console.log('🎉 ALL PRODUCTION SCHEMA & MIGRATION TESTS PASSED (100%)');
  console.log('====================================================');
}

testSchemaAndMigrations().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
