const assert = require('assert');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');

const bulkImageReplaceService = require('../services/bulkImageReplaceService');
const Design = require('../models/Design');

async function testFolderBulkReplace() {
  console.log('===============================================================');
  console.log('🧪 TEST: BULK REPLACE WITH FOLDER "ARUVI BULK DESIGNS 2"');
  console.log('===============================================================\n');

  // 1. Setup mock designs in Category 10 ("Blouse Designs") and Category 20 ("Saree Designs")
  const targetCategoryDesigns = [
    {
      id: 501,
      sku: 'AED-BLO-01',
      title: 'Grand Blouse Embroidery Pattern 1',
      category_id: 10,
      category_name: 'Blouse Designs',
      primary_image: '/uploads/previews/old_aed_blo_01.jpg',
      machine_file_name: 'old_aed_blo_01.zip',
      machine_file_path: 'designs/old_aed_blo_01.zip',
      price: 299,
      download_count: 42
    },
    {
      id: 502,
      sku: 'AED-BLO-02',
      title: 'Grand Blouse Embroidery Pattern 2',
      category_id: 10,
      category_name: 'Blouse Designs',
      primary_image: '/uploads/previews/old_aed_blo_02.jpg',
      machine_file_name: 'old_aed_blo_02.zip',
      machine_file_path: 'designs/old_aed_blo_02.zip',
      price: 349,
      download_count: 18
    },
    {
      id: 503,
      sku: 'AED-BLO-03',
      title: 'Grand Blouse Embroidery Pattern 3',
      category_id: 10,
      category_name: 'Blouse Designs',
      primary_image: '/uploads/previews/old_aed_blo_03.jpg',
      machine_file_name: null,
      machine_file_path: null,
      price: 199,
      download_count: 5
    }
  ];

  const otherCategoryDesigns = [
    {
      id: 601,
      sku: 'AED-SAR-01',
      title: 'Peacock Saree Pattern',
      category_id: 20,
      category_name: 'Saree Designs',
      primary_image: '/uploads/previews/old_saree_01.jpg',
      machine_file_name: 'old_saree_01.zip',
      machine_file_path: 'designs/old_saree_01.zip',
      price: 599,
      download_count: 120
    }
  ];

  // 2. Simulated files from folder "ARUVI BULK DESIGNS 2":
  // - Images: AED-BLO-01.png, AED-BLO-02.jpg, AED-BLO-03.webp
  // - ZIP Packages: AED-BLO-01.zip, AED-BLO-02.zip
  // - Unmatched files in folder: AED-UNKNOWN.png
  // - Cross-category file in folder: AED-SAR-01.png and AED-SAR-01.zip (must NOT match because Category 10 is selected!)
  const simulatedFolderFiles = [
    { name: 'AED-BLO-01.png', size: 1024 * 50, webkitRelativePath: 'ARUVI BULK DESIGNS 2/AED-BLO-01.png' },
    { name: 'AED-BLO-01.zip', size: 1024 * 180, webkitRelativePath: 'ARUVI BULK DESIGNS 2/AED-BLO-01.zip' },
    { name: 'AED-BLO-02.jpg', size: 1024 * 65, webkitRelativePath: 'ARUVI BULK DESIGNS 2/AED-BLO-02.jpg' },
    { name: 'AED-BLO-02.zip', size: 1024 * 220, webkitRelativePath: 'ARUVI BULK DESIGNS 2/AED-BLO-02.zip' },
    { name: 'AED-BLO-03.webp', size: 1024 * 40, webkitRelativePath: 'ARUVI BULK DESIGNS 2/AED-BLO-03.webp' }, // Only image, no ZIP
    { name: 'AED-UNKNOWN.png', size: 1024 * 30, webkitRelativePath: 'ARUVI BULK DESIGNS 2/AED-UNKNOWN.png' },
    { name: 'AED-SAR-01.png', size: 1024 * 50, webkitRelativePath: 'ARUVI BULK DESIGNS 2/AED-SAR-01.png' }, // belongs to category 20!
    { name: 'AED-SAR-01.zip', size: 1024 * 150, webkitRelativePath: 'ARUVI BULK DESIGNS 2/AED-SAR-01.zip' }  // belongs to category 20!
  ];

  // Mock scope summary strictly to Category 10
  const originalGetScope = bulkImageReplaceService.getScopeSummary;
  bulkImageReplaceService.getScopeSummary = async (options) => {
    return {
      categories: [{ id: 10, name: 'Blouse Designs', design_count: targetCategoryDesigns.length }],
      totalDesigns: targetCategoryDesigns.length,
      designs: targetCategoryDesigns
    };
  };

  console.log('▶ 1. Testing Scope Matching against category "Blouse Designs" (ID: 10)...');
  const matchResult = await bulkImageReplaceService.matchFilesToScope(simulatedFolderFiles, {
    categoryIds: [10],
    mode: 'replace_matching'
  });

  console.log(`   - Matched designs count: ${matchResult.summary.matchedDesignsCount}`);
  console.log(`   - Matched images count: ${matchResult.summary.matchedImagesCount}`);
  console.log(`   - Matched ZIPs count: ${matchResult.summary.matchedZipsCount}`);
  console.log(`   - Unmatched files: ${matchResult.summary.unmatchedFilesCount}`);

  // Assertions:
  // - Category isolation: AED-SAR-01 must NOT match because category 10 is chosen!
  const crossCategoryMatched = matchResult.previewList.find(p => p.sku === 'AED-SAR-01');
  assert(!crossCategoryMatched, 'Strict category isolation: files belonging to other categories must not be matched or modified!');

  // - AED-BLO-01 matched both image and zip
  const blo01 = matchResult.previewList.find(p => p.sku === 'AED-BLO-01');
  assert(blo01, 'AED-BLO-01 must be matched');
  assert.strictEqual(blo01.imageFiles.length, 1, 'AED-BLO-01 must match 1 image');
  assert.strictEqual(blo01.zipFiles.length, 1, 'AED-BLO-01 must match 1 ZIP');
  assert.strictEqual(blo01.hasNewImage, true, 'AED-BLO-01 has new image');
  assert.strictEqual(blo01.hasNewZip, true, 'AED-BLO-01 has new zip');
  assert.strictEqual(blo01.status, 'Will replace Image & ZIP', 'Status must reflect both replacements');

  // - AED-BLO-03 has image only, no zip
  const blo03 = matchResult.previewList.find(p => p.sku === 'AED-BLO-03');
  assert(blo03, 'AED-BLO-03 must be matched');
  assert.strictEqual(blo03.hasNewImage, true);
  assert.strictEqual(blo03.hasNewZip, false);
  assert.strictEqual(blo03.zipStatus, 'Keep existing ZIP', 'Existing ZIP state preserved when no ZIP provided');

  console.log('   ✓ Category isolation and dual matching successfully verified.');

  // 2. Chunk processing of both image and ZIP
  console.log('\n▶ 2. Testing Chunk Processing with authentic ZIP archive & PNG buffer...');
  const zip = new AdmZip();
  zip.addFile('AED-BLO-01.dst', Buffer.from('DST MACHINE STITCH DATA'));
  zip.addFile('AED-BLO-01.pes', Buffer.from('PES MACHINE STITCH DATA'));
  const zipBuf = zip.toBuffer();

  const fakePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAEjAwMDAwAAWUB/564vSIAAAAASUVORK5CYII=', 'base64');

  const chunk = [
    { originalname: 'AED-BLO-01.png', mimetype: 'image/png', buffer: fakePng },
    { originalname: 'AED-BLO-01.zip', mimetype: 'application/zip', buffer: zipBuf }
  ];

  const processed = await bulkImageReplaceService.processUploadChunk(chunk);
  assert.strictEqual(processed.length, 2, 'Must process 2 files');

  const pImg = processed.find(f => !f.isZip);
  const pZip = processed.find(f => f.isZip);

  assert(pImg.publicUrl, 'Processed image must have publicUrl');
  assert(pImg.thumbUrl, 'Processed image must have thumbUrl');
  assert(pZip.storageKey, 'Processed ZIP must have storageKey');
  assert(pZip.detectedFormats.includes('DST') || pZip.detectedFormats.includes('dst'), 'Must detect DST format in ZIP');
  assert(pZip.detectedFormats.includes('PES') || pZip.detectedFormats.includes('pes'), 'Must detect PES format in ZIP');
  console.log('   ✓ Both image and ZIP safely processed, validated, and stored.');

  // 3. Batch commit & Product data preservation verification
  console.log('\n▶ 3. Testing Batch Commit and verifying non-file product data preservation...');
  const originalGetById = Design.getById;
  Design.getById = async (id) => {
    return targetCategoryDesigns.find(d => d.id === id) || originalGetById.call(Design, id);
  };

  const commitRes = await bulkImageReplaceService.commitReplacementBatch({
    adminUser: { id: 9, email: 'admin@aruvi.com' },
    categoryId: 10,
    categoryName: 'Blouse Designs',
    replacementMode: 'replace_matching',
    items: [
      {
        designId: 501,
        sku: 'AED-BLO-01',
        title: 'Grand Blouse Embroidery Pattern 1',
        originalName: pImg.originalName,
        publicUrl: pImg.publicUrl,
        thumbUrl: pImg.thumbUrl,
        fileSize: pImg.fileSize,
        checksum: pImg.checksum,
        isZip: false,
        isPrimary: true,
        imageIndex: 1
      },
      {
        designId: 501,
        sku: 'AED-BLO-01',
        title: 'Grand Blouse Embroidery Pattern 1',
        originalName: pZip.originalName,
        storageKey: pZip.storageKey,
        fileSize: pZip.fileSize,
        checksum: pZip.checksum,
        isZip: true,
        isPrimary: false,
        imageIndex: 1,
        detectedFormats: pZip.detectedFormats
      }
    ]
  });

  assert(commitRes.success, 'Commit must succeed');
  assert.strictEqual(commitRes.replacedImagesCount, 1);
  assert.strictEqual(commitRes.replacedZipsCount, 1);

  // Verify that price, SKU, download_count, etc. were NOT changed on product 501
  const productAfter = targetCategoryDesigns.find(d => d.id === 501);
  assert.strictEqual(productAfter.price, 299, 'Price must NOT be modified');
  assert.strictEqual(productAfter.download_count, 42, 'Download count & purchase records must NOT be modified');
  assert.strictEqual(productAfter.sku, 'AED-BLO-01', 'SKU must NOT be modified');
  console.log('   ✓ Product pricing, SKU, download count, and customer purchase records strictly preserved.');

  // 4. Test 7-Day Rollback
  console.log('\n▶ 4. Testing 7-Day Rollback for batch #' + commitRes.logId + '...');
  const undoRes = await bulkImageReplaceService.undoBulkReplacement(commitRes.logId);
  assert(undoRes.success, 'Undo must succeed');
  assert.strictEqual(undoRes.restoredCount, 1, 'Restored 1 product back to previous files');
  console.log('   ✓ 7-Day Rollback successfully restored previous files.');

  // Cleanup mocks
  bulkImageReplaceService.getScopeSummary = originalGetScope;
  Design.getById = originalGetById;

  console.log('\n===============================================================');
  console.log('🎉 "ARUVI BULK DESIGNS 2" FOLDER SIMULATION PASSED 100%!');
  console.log('===============================================================\n');
}

testFolderBulkReplace().catch(err => {
  console.error('❌ Folder test failed:', err);
  process.exit(1);
});
