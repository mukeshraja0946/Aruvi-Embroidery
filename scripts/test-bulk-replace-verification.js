const assert = require('assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../config/db');
const Design = require('../models/Design');
const bulkImageReplaceService = require('../services/bulkImageReplaceService');

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function run() {
  console.log('====================================================');
  console.log('BULK REPLACE IMAGES & ZIPS VERIFICATION TEST SUITE');
  console.log('====================================================');

  await db.initPool();

  // 1. Setup Design #637 if missing
  console.log('\n▶ Step 1: Setting up Target Design #637 (AED-BUL-01)...');
  let design637 = (await db.query('SELECT * FROM designs WHERE id = 637'))?.[0];
  if (!design637) {
    console.log('Creating Design #637 in database for testing...');
    await db.query(`
      INSERT INTO designs (id, sku, title, category_id, is_active, price, formats, created_at, updated_at)
      VALUES (637, 'AED-BUL-01', 'ARUVI BULK TEST 1', 1, 1, 99.00, 'DST, PES', NOW(), NOW())
      ON DUPLICATE KEY UPDATE sku = 'AED-BUL-01', title = 'ARUVI BULK TEST 1'
    `);
    design637 = (await db.query('SELECT * FROM designs WHERE id = 637'))?.[0];
  }
  assert(design637, 'Design #637 must exist');
  console.log(`✓ Design #${design637.id} ready: ${design637.sku} (${design637.title})`);

  // Clear existing files for clean test baseline
  await db.query('DELETE FROM design_images WHERE design_id = 637');
  await db.query('DELETE FROM design_files WHERE design_id = 637');

  // Insert 1 initial machine file with checksum 3686e5e1...
  const collisionChecksum = '3686e5e10efd1bec75109e52f89bbd38bfe125b26e75a9edb237270cc73519df';
  await db.query(`
    INSERT INTO design_files (design_id, file_kind, original_name, storage_key, mime_type, file_name, file_path, file_format, file_size, checksum_sha256, sort_order, is_preview)
    VALUES (637, 'machine', 'AED 1.zip', '/public/uploads/designs/old_aed_1.zip', 'application/zip', 'AED 1.zip', '/public/uploads/designs/old_aed_1.zip', 'ZIP', 195659, ?, 0, 0)
  `, [collisionChecksum]);
  console.log(`✓ Seeded baseline Design #637 machine file with checksum ${collisionChecksum.substring(0, 8)}...`);

  // Prepare 10 Images + 10 ZIPs (Total 20 files)
  const items = [];
  for (let i = 1; i <= 10; i++) {
    const imgContent = `Simulated PNG image content for AED ${i}.png - ${Date.now()}`;
    items.push({
      originalName: `AED ${i}.PNG`,
      fileName: `AED ${i}.PNG`,
      fileSize: 61440 + i * 1024,
      isZip: false,
      checksum: sha256(imgContent),
      publicUrl: `/uploads/designs/aed_img_${i}.png`,
      thumbUrl: `/uploads/designs/aed_img_${i}_thumb.png`,
      cardUrl: `/uploads/designs/aed_img_${i}_card.png`,
      targetDesignId: 637
    });
  }

  for (let i = 1; i <= 10; i++) {
    const isFirstZip = (i === 1);
    const zipChecksum = isFirstZip ? collisionChecksum : sha256(`Simulated ZIP package content for AED ${i}.zip - ${i}`);
    items.push({
      originalName: `AED ${i}.ZIP`,
      fileName: `AED ${i}.ZIP`,
      fileSize: 195659 + i * 2048,
      isZip: true,
      checksum: zipChecksum,
      storageKey: `/uploads/designs/aed_zip_${i}.zip`,
      publicUrl: `/uploads/designs/aed_zip_${i}.zip`,
      detectedFormats: ['DST', 'PES', 'JEF', 'EXP'],
      targetDesignId: 637
    });
  }
  assert.strictEqual(items.length, 20, 'Should have exactly 20 items');
  console.log(`✓ Prepared 20 items (10 PNGs + 10 ZIPs including collision checksum)`);

  // ============================================================
  // TEST RUN 1: 10 PNG + 10 ZIP with pre-existing collision checksum
  // ============================================================
  console.log('\n▶ Step 2: Executing Test Run 1 (10 PNG + 10 ZIP on Design #637)...');
  const res1 = await bulkImageReplaceService.replaceFileGroup({
    groupName: 'Design #637 (AED-BUL-01)',
    targetDesignId: 637,
    replacementMode: 'replace_group',
    items: items
  });

  console.log('Result 1 Summary:', {
    success: res1.success,
    totalSelectedFiles: res1.totalSelectedFiles,
    replacedImagesCount: res1.replacedImagesCount,
    replacedZipsCount: res1.replacedZipsCount,
    restoredCount: res1.restoredCount,
    unchangedCount: res1.unchangedCount,
    skippedCount: res1.skippedCount,
    failedCount: res1.failedCount,
    removedOldFilesCount: res1.removedOldFilesCount
  });

  assert.strictEqual(res1.failedCount, 0, 'Run 1 must have 0 failures (collision must be handled gracefully)');
  assert.strictEqual(res1.fileLogs.length, 20, 'All 20 files must appear in per-file log');
  // First ZIP had identical checksum to existing active row -> marked Unchanged!
  assert.strictEqual(res1.unchangedCount, 1, 'First ZIP with identical checksum must be Unchanged');
  assert.strictEqual(res1.replacedImagesCount, 10, '10 images must be replaced');
  assert.strictEqual(res1.replacedZipsCount, 9, '9 new ZIPs must be attached/replaced');

  // Verify Totals Invariant: selected = replaced + restored + unchanged + skipped + failed
  const inv1 = res1.replacedImagesCount + res1.replacedZipsCount + res1.restoredCount + res1.unchangedCount + res1.skippedCount + res1.failedCount;
  assert.strictEqual(inv1, res1.totalSelectedFiles, `Totals invariant must hold: ${inv1} === ${res1.totalSelectedFiles}`);
  console.log('✓ Run 1 Succeeded with 0 failures and perfect totals invariant!');

  // ============================================================
  // TEST RUN 2: Run the EXACT same selection twice
  // ============================================================
  console.log('\n▶ Step 3: Executing Test Run 2 (Same selection twice: all files identical)...');
  const res2 = await bulkImageReplaceService.replaceFileGroup({
    groupName: 'Design #637 (AED-BUL-01)',
    targetDesignId: 637,
    replacementMode: 'replace_group',
    items: items
  });

  console.log('Result 2 Summary:', {
    success: res2.success,
    totalSelectedFiles: res2.totalSelectedFiles,
    replacedImagesCount: res2.replacedImagesCount,
    replacedZipsCount: res2.replacedZipsCount,
    restoredCount: res2.restoredCount,
    unchangedCount: res2.unchangedCount,
    skippedCount: res2.skippedCount,
    failedCount: res2.failedCount,
    removedOldFilesCount: res2.removedOldFilesCount
  });

  assert.strictEqual(res2.failedCount, 0, 'Run 2 must have 0 failures');
  assert.strictEqual(res2.unchangedCount, 20, 'Second run must show all 20 files as Unchanged');
  assert.strictEqual(res2.replacedImagesCount, 0, 'No images should be replaced on identical second run');
  assert.strictEqual(res2.replacedZipsCount, 0, 'No ZIPs should be replaced on identical second run');
  assert.strictEqual(res2.removedOldFilesCount, 0, '0 old files removed when unchanged');
  assert(res2.message.includes('Old files remain untouched'), 'Message must truthfully say old files remain untouched');
  console.log('✓ Run 2 Succeeded: Exactly 20 Unchanged, 0 failed, 0 old files removed!');

  // ============================================================
  // TEST RUN 3: Replace after Undo (retired rows exist)
  // ============================================================
  console.log('\n▶ Step 4: Testing Undo and Replace after Undo...');
  // First retire rows by replacing with a different single image
  const altItems = [{
    originalName: 'AED ALT.PNG',
    fileName: 'AED ALT.PNG',
    fileSize: 50000,
    isZip: false,
    checksum: sha256('Different alt image content'),
    publicUrl: '/uploads/designs/aed_alt.png',
    targetDesignId: 637
  }];

  const resAlt = await bulkImageReplaceService.replaceFileGroup({
    groupName: 'Design #637 (AED-BUL-01)',
    targetDesignId: 637,
    replacementMode: 'replace_group',
    items: altItems
  });
  console.log(`✓ Replaced with alt image: ${resAlt.removedOldFilesCount} old files retired to backup`);

  // Verify retired rows now exist in DB
  const retiredRows = await db.query('SELECT id, checksum FROM design_images WHERE design_id = 637 AND retired_at IS NOT NULL');
  console.log(`✓ Soft-retired rows present in DB: ${retiredRows.length}`);
  assert(retiredRows.length > 0, 'Soft-retired rows must exist');

  // Now replace again with original items: the retired rows must be REACTIVATED (Restored) without ER_DUP_ENTRY!
  console.log('Executing replacement when retired rows exist in DB...');
  const res3 = await bulkImageReplaceService.replaceFileGroup({
    groupName: 'Design #637 (AED-BUL-01)',
    targetDesignId: 637,
    replacementMode: 'replace_group',
    items: items
  });

  console.log('Result 3 Summary (After Soft-Retire):', {
    success: res3.success,
    restoredCount: res3.restoredCount,
    unchangedCount: res3.unchangedCount,
    failedCount: res3.failedCount
  });

  assert.strictEqual(res3.failedCount, 0, 'Must not fail with ER_DUP_ENTRY when retired rows exist');
  assert(res3.restoredCount > 0, 'Must restore soft-retired rows');
  console.log('✓ Replace after soft-retire successfully reactivated rows without ER_DUP_ENTRY!');

  // ============================================================
  // TEST RUN 4: Two Identical Files in the Same Batch
  // ============================================================
  console.log('\n▶ Step 5: Testing Two Identical Files in the Same Batch...');
  const dupChecksum = sha256('Unique payload for duplicate test');
  const batchWithDupes = [
    {
      originalName: 'AED Batch 1.png',
      fileName: 'AED Batch 1.png',
      fileSize: 40000,
      isZip: false,
      checksum: dupChecksum,
      publicUrl: '/uploads/designs/aed_b1.png',
      targetDesignId: 637
    },
    {
      originalName: 'AED Batch 1 Copy.png',
      fileName: 'AED Batch 1 Copy.png',
      fileSize: 40000,
      isZip: false,
      checksum: dupChecksum, // IDENTICAL CHECKSUM IN SAME BATCH
      publicUrl: '/uploads/designs/aed_b1_copy.png',
      targetDesignId: 637
    }
  ];

  const res4 = await bulkImageReplaceService.replaceFileGroup({
    groupName: 'Design #637 (AED-BUL-01)',
    targetDesignId: 637,
    replacementMode: 'replace_group',
    items: batchWithDupes
  });

  console.log('Result 4 Summary (Batch Duplicates):', {
    success: res4.success,
    totalSelectedFiles: res4.totalSelectedFiles,
    replacedImagesCount: res4.replacedImagesCount,
    skippedCount: res4.skippedCount,
    failedCount: res4.failedCount
  });

  assert.strictEqual(res4.failedCount, 0, 'Batch duplicates must not cause failure');
  assert.strictEqual(res4.skippedCount, 1, 'Second duplicate in batch must be skipped');
  const skippedLog = res4.fileLogs.find(l => l.result === 'Skipped');
  assert(skippedLog, 'Duplicate file must appear in log as Skipped');
  assert.strictEqual(skippedLog.result, 'Skipped', 'Duplicate file result must be Skipped');
  assert(skippedLog.error.includes('Duplicate in selection'), 'Reason must indicate duplicate in selection');
  console.log(`✓ Duplicate in batch (${skippedLog.fileName}) was cleanly skipped!`);

  console.log('\n====================================================');
  console.log('ALL VERIFICATION TESTS PASSED SUCCESSFULLY! ✓✓✓');
  console.log('====================================================');
  process.exit(0);
}

run().catch(err => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
