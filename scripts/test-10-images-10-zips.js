const assert = require('assert');
const path = require('path');
const fs = require('fs');
const bulkImageReplaceService = require('../services/bulkImageReplaceService');
const Design = require('../models/Design');

async function run10Images10ZipsTest() {
  console.log('===============================================================');
  console.log('🧪 TEST: EXACT 10 IMAGES & 10 ZIPS BULK GROUP REPLACEMENT');
  console.log('===============================================================\n');

  // Setup: 1 Design in Category 10 with group "ARUVI BULK DESIGNS 2" (exact user scenario)
  const mockDesign = {
    id: 1001,
    sku: 'AED-BULK-2026',
    title: 'ARUVI BULK DESIGNS 2',
    category_id: 10,
    category_name: 'Bulk Designs',
    primary_image: '/uploads/previews/ARUVI BULK DESIGNS 2/old_cover.png',
    import_zip_filename: 'ARUVI BULK DESIGNS 2',
    price: 999,
    stitch_count: 55000,
    images: [
      { id: 101, design_id: 1001, image_url: '/uploads/previews/ARUVI BULK DESIGNS 2/old_cover.png', is_primary: 1 }
    ],
    files: [
      { id: 201, design_id: 1001, file_name: 'old_bundle.zip', file_path: 'designs/ARUVI BULK DESIGNS 2/old_bundle.zip', file_format: 'ZIP', is_preview: 0 }
    ]
  };

  const otherDesign = {
    id: 9999,
    sku: 'OTHER-01',
    title: 'Unrelated Design',
    category_id: 20,
    category_name: 'Saree Designs',
    primary_image: '/uploads/previews/other.png',
    import_zip_filename: 'OTHER_GROUP',
    price: 350,
    stitch_count: 12000,
    images: [{ id: 501, design_id: 9999, image_url: '/uploads/previews/other.png', is_primary: 1 }],
    files: [{ id: 601, design_id: 9999, file_name: 'other.zip', file_path: 'designs/other.zip', file_format: 'ZIP', is_preview: 0 }]
  };

  const origGetAll = Design.getAll;
  const origGetById = Design.getById;

  Design.getAll = async () => ({ designs: [mockDesign, otherDesign] });
  Design.getById = async (id) => {
    if (id == 1001) return mockDesign;
    if (id == 9999) return otherDesign;
    return null;
  };

  try {
    // 1. Verify Group Detection for Category 10
    console.log('▶ 1. Detecting group "ARUVI BULK DESIGNS 2"...');
    const groupResult = await bulkImageReplaceService.getCategoryExistingFolderGroups(10);
    assert.strictEqual(groupResult.success, true);
    const targetGroup = groupResult.groups.find(g => g.groupName === 'ARUVI BULK DESIGNS 2');
    assert(targetGroup, 'Target group ARUVI BULK DESIGNS 2 must be found');
    assert.strictEqual(targetGroup.designCount, 1, 'Group has 1 design');
    assert.strictEqual(targetGroup.existingImagesCount, 1, 'Group currently has 1 image');
    assert.strictEqual(targetGroup.existingZipsCount, 1, 'Group currently has 1 ZIP');
    console.log('   ✅ Group detected: 1 design, 1 image, 1 ZIP package.\n');

    // 2. Prepare EXACTLY 10 Images and 10 ZIPs (20 files total)
    console.log('▶ 2. Preparing 10 replacement images and 10 replacement ZIPs...');
    const items = [];
    for (let i = 1; i <= 10; i++) {
      const num = String(i).padStart(2, '0');
      items.push({
        originalName: `design_image_${num}.jpg`,
        publicUrl: `/uploads/previews/design_image_${num}.jpg`,
        thumbUrl: `/uploads/previews/thumbs/design_image_${num}.webp`,
        fileSize: 100000 + i * 5000,
        checksum: `sha256_mock_image_${num}`,
        isZip: false
      });
    }

    for (let i = 1; i <= 10; i++) {
      const num = String(i).padStart(2, '0');
      items.push({
        originalName: `design_package_${num}.zip`,
        storageKey: `designs/private/design_package_${num}.zip`,
        fileSize: 500000 + i * 15000,
        checksum: `sha256_mock_zip_${num}`,
        isZip: true,
        detectedFormats: ['DST', 'PES', 'EXP']
      });
    }

    assert.strictEqual(items.length, 20, 'Must have exactly 20 files');
    assert.strictEqual(items.filter(f => !f.isZip).length, 10, 'Must have 10 images');
    assert.strictEqual(items.filter(f => f.isZip).length, 10, 'Must have 10 ZIPs');
    console.log('   ✅ Prepared: 10 images + 10 ZIP packages = 20 files.\n');

    // 3. Execute replaceFileGroup
    console.log('▶ 3. Executing replaceFileGroup...');
    const replaceResult = await bulkImageReplaceService.replaceFileGroup({
      adminUser: { id: 1, email: 'admin@aruvidemo.com' },
      categoryId: 10,
      categoryName: 'Bulk Designs',
      groupName: 'ARUVI BULK DESIGNS 2',
      items
    });

    console.log('   Result returned:');
    console.log(`   - success: ${replaceResult.success}`);
    console.log(`   - replacedImagesCount: ${replaceResult.replacedImagesCount}`);
    console.log(`   - replacedZipsCount: ${replaceResult.replacedZipsCount}`);
    console.log(`   - removedOldFilesCount: ${replaceResult.removedOldFilesCount}`);
    console.log(`   - failedCount: ${replaceResult.failedCount}`);
    console.log(`   - fileLogs count: ${replaceResult.fileLogs ? replaceResult.fileLogs.length : 0}`);

    assert.strictEqual(replaceResult.success, true, 'replaceFileGroup must succeed');
    assert.strictEqual(replaceResult.replacedImagesCount, 10, 'ALL 10 images must be processed and replaced');
    assert.strictEqual(replaceResult.replacedZipsCount, 10, 'ALL 10 ZIP packages must be processed and replaced');
    assert.strictEqual(replaceResult.failedCount, 0, 'failedCount must be 0');
    assert.strictEqual(replaceResult.removedOldFilesCount, 2, '2 old files (1 image + 1 zip) must be removed');
    assert.strictEqual(replaceResult.fileLogs.length, 20, 'fileLogs must have exactly 20 entries');

    // 4. Verify Per-File Operation Log
    console.log('\n▶ 4. Verifying Per-File Operation Log (20 files)...');
    replaceResult.fileLogs.forEach((logEntry, idx) => {
      assert.strictEqual(logEntry.result, 'Verified', `File #${idx + 1} (${logEntry.fileName}) must be Verified`);
      assert.strictEqual(logEntry.storageStatus, 'Stored', `File #${idx + 1} must be Stored`);
      assert.strictEqual(logEntry.dbStatus, 'Updated', `File #${idx + 1} must be Updated`);
      assert.strictEqual(logEntry.cleanupStatus, 'Cleaned', `File #${idx + 1} cleanup must be Cleaned`);
      assert.strictEqual(logEntry.error, null, `File #${idx + 1} error must be null`);
    });
    console.log('   ✅ All 20 file log entries verified with Stored & Updated status!\n');

    // 5. Verify Design Product State
    console.log('▶ 5. Verifying product state in database / fallback...');
    const updatedDesign = await Design.getById(1001);
    assert(updatedDesign.primary_image.includes('design_image_01.jpg'), 'Primary image must be design_image_01.jpg');
    assert.strictEqual(updatedDesign.images.length, 10, 'Design must contain all 10 images in images array');
    assert.strictEqual(updatedDesign.files.length, 10, 'Design must contain all 10 ZIP packages in files array');
    assert.strictEqual(updatedDesign.price, 999, 'Price must be preserved');
    assert.strictEqual(updatedDesign.stitch_count, 55000, 'Stitch count must be preserved');
    assert.strictEqual(updatedDesign.sku, 'AED-BULK-2026', 'SKU must be preserved');

    // Verify other design untouched
    const untouched = await Design.getById(9999);
    assert.strictEqual(untouched.primary_image, '/uploads/previews/other.png');
    assert.strictEqual(untouched.files.length, 1);
    console.log('   ✅ Product state verified: 10 images, 10 ZIP files, SKUs/prices preserved!\n');

    // 6. Verify CSV Report Generation
    console.log('▶ 6. Verifying CSV export generation...');
    const { log, csv } = await bulkImageReplaceService.generateCsvReport(replaceResult.logId);
    assert(csv.includes('=== BULK FILE REPLACEMENT REPORT ==='), 'CSV must have summary header');
    assert(csv.includes('Replaced Images,10'), 'CSV must report Replaced Images,10');
    assert(csv.includes('Replaced ZIPs,10'), 'CSV must report Replaced ZIPs,10');
    assert(csv.includes('Failed,0'), 'CSV must report Failed,0');
    assert(csv.includes('=== PER-FILE OPERATION VERIFICATION LOG ==='), 'CSV must have file log table');
    assert(csv.includes('design_image_10.jpg'), 'CSV must contain design_image_10.jpg');
    assert(csv.includes('design_package_10.zip'), 'CSV must contain design_package_10.zip');
    console.log('   ✅ CSV report verified with full 20-file log table!\n');

    // 7. Verify Undo Functionality
    console.log('▶ 7. Verifying 7-day rollback / undo...');
    const undoResult = await bulkImageReplaceService.undoBulkReplacement(replaceResult.logId);
    assert.strictEqual(undoResult.success, true);
    const restoredDesign = await Design.getById(1001);
    assert.strictEqual(restoredDesign.primary_image, '/uploads/previews/ARUVI BULK DESIGNS 2/old_cover.png');
    assert.strictEqual(restoredDesign.files[0].file_name, 'old_bundle.zip');
    console.log('   ✅ Rollback / Undo successfully restored old files!\n');

    console.log('===============================================================');
    console.log('🎉 ALL 10 IMAGES + 10 ZIPS VERIFICATION TESTS PASSED!');
    console.log('===============================================================');

    // Clean up backup directory
    const backupDir = path.resolve(__dirname, '..', 'backups', `bulk_replace_${replaceResult.logId}`);
    if (fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }

  } finally {
    Design.getAll = origGetAll;
    Design.getById = origGetById;
  }
}

run10Images10ZipsTest().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
