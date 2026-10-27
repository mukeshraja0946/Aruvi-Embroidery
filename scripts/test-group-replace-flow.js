const assert = require('assert');
const path = require('path');
const fs = require('fs');
const bulkImageReplaceService = require('../services/bulkImageReplaceService');
const Design = require('../models/Design');

async function runGroupReplaceFlowTest() {
  console.log('===============================================================');
  console.log('🧪 TEST: BULK REPLACE BY CATEGORY & EXISTING FOLDER GROUP');
  console.log('===============================================================\n');

  // 1. Setup Mock Designs in Category 10 ("Blouse Designs")
  const mockDesigns = [
    {
      id: 2001,
      sku: 'ARUVI-BULK-01',
      title: 'ARUVI BULK DESIGNS 2 - Floral Neck Pattern 1',
      category_id: 10,
      category_name: 'Blouse Designs',
      primary_image: '/uploads/previews/ARUVI BULK DESIGNS 2/old_floral_01.png',
      import_zip_filename: 'ARUVI BULK DESIGNS 2',
      price: 499,
      stitch_count: 24500,
      images: [
        { id: 301, design_id: 2001, image_url: '/uploads/previews/ARUVI BULK DESIGNS 2/old_floral_01.png', is_primary: 1 }
      ],
      files: [
        { id: 401, design_id: 2001, file_name: 'old_floral_01.zip', file_path: 'designs/ARUVI BULK DESIGNS 2/old_floral_01.zip', file_format: 'ZIP', is_preview: 0 }
      ]
    },
    {
      id: 2002,
      sku: 'ARUVI-BULK-02',
      title: 'ARUVI BULK DESIGNS 2 - Floral Neck Pattern 2',
      category_id: 10,
      category_name: 'Blouse Designs',
      primary_image: '/uploads/previews/ARUVI BULK DESIGNS 2/old_floral_02.png',
      import_zip_filename: 'ARUVI BULK DESIGNS 2',
      price: 549,
      stitch_count: 31200,
      images: [
        { id: 302, design_id: 2002, image_url: '/uploads/previews/ARUVI BULK DESIGNS 2/old_floral_02.png', is_primary: 1 }
      ],
      files: [
        { id: 402, design_id: 2002, file_name: 'old_floral_02.zip', file_path: 'designs/ARUVI BULK DESIGNS 2/old_floral_02.zip', file_format: 'ZIP', is_preview: 0 }
      ]
    },
    {
      id: 2003,
      sku: 'ARUVI-DEF-01',
      title: 'Peacock Border Blouse',
      category_id: 10,
      category_name: 'Blouse Designs',
      primary_image: '/uploads/previews/peacock_border.png',
      import_zip_filename: 'Single_Upload_Peacock.zip',
      price: 299,
      stitch_count: 15400,
      images: [
        { id: 303, design_id: 2003, image_url: '/uploads/previews/peacock_border.png', is_primary: 1 }
      ],
      files: [
        { id: 403, design_id: 2003, file_name: 'peacock_border.zip', file_path: 'designs/peacock_border.zip', file_format: 'ZIP', is_preview: 0 }
      ]
    }
  ];

  // Category 20 (other category, must never be affected)
  const otherCatDesign = {
    id: 9001,
    sku: 'SAREE-01',
    title: 'Bridal Saree Embroidery',
    category_id: 20,
    category_name: 'Saree Designs',
    primary_image: '/uploads/previews/saree_01.png',
    import_zip_filename: 'BRIDAL_SAREE_DESIGNS',
    price: 999,
    stitch_count: 85000,
    images: [{ id: 309, design_id: 9001, image_url: '/uploads/previews/saree_01.png', is_primary: 1 }],
    files: [{ id: 409, design_id: 9001, file_name: 'saree_01.zip', file_path: 'designs/saree_01.zip', file_format: 'ZIP', is_preview: 0 }]
  };

  // Mock Design.getAll & Design.getById
  const origGetAll = Design.getAll;
  const origGetById = Design.getById;
  const origReplacePrimaryImage = Design.replacePrimaryImage;
  const origReplaceMachineFile = Design.replaceMachineFile;

  Design.getAll = async () => ({ designs: [...mockDesigns, otherCatDesign] });
  Design.getById = async (id) => {
    return [...mockDesigns, otherCatDesign].find(d => d.id == id) || null;
  };

  const replacedPrimaryCalls = [];
  Design.replacePrimaryImage = async (dId, url, name, size, checksum) => {
    replacedPrimaryCalls.push({ dId, url, name, size });
    const target = mockDesigns.find(d => d.id == dId);
    if (target) {
      target.primary_image = url;
      target.images = [{ id: Date.now(), design_id: dId, image_url: url, is_primary: 1 }];
    }
    return true;
  };

  const replacedMachineCalls = [];
  Design.replaceMachineFile = async (dId, pathKey, name, size, checksum, formats) => {
    replacedMachineCalls.push({ dId, pathKey, name, size, formats });
    const target = mockDesigns.find(d => d.id == dId);
    if (target) {
      target.files = [{ id: Date.now(), design_id: dId, file_name: name, file_path: pathKey, file_format: 'ZIP', is_preview: 0 }];
    }
    return true;
  };

  try {
    // -------------------------------------------------------------
    // Test 1: Category & Existing Folder/Group Scanning
    // -------------------------------------------------------------
    console.log('▶ 1. Testing getCategoryExistingFolderGroups for Category 10...');
    const groupResult = await bulkImageReplaceService.getCategoryExistingFolderGroups(10);

    assert.strictEqual(groupResult.success, true, 'Result must be successful');
    assert.strictEqual(groupResult.totalDesigns, 3, 'Must detect 3 designs in Category 10');
    console.log(`   Found ${groupResult.groups.length} detected folder/groups:`);
    groupResult.groups.forEach(g => {
      console.log(`   - 📁 "${g.groupName}": ${g.designCount} designs, ${g.existingImagesCount} images, ${g.existingZipsCount} ZIPs`);
    });

    const bulkGroup = groupResult.groups.find(g => g.groupName === 'ARUVI BULK DESIGNS 2');
    assert(bulkGroup, 'Must identify group "ARUVI BULK DESIGNS 2" from stored paths');
    assert.strictEqual(bulkGroup.designCount, 2, 'ARUVI BULK DESIGNS 2 must contain 2 designs');
    assert.strictEqual(bulkGroup.existingImagesCount, 2, 'Must count 2 existing images in group');
    assert.strictEqual(bulkGroup.existingZipsCount, 2, 'Must count 2 existing ZIP packages in group');
    console.log('   ✅ Group detection & file counts verified successfully!\n');

    // -------------------------------------------------------------
    // Test 2: Direct File Replacement without Matching/Mapping steps
    // -------------------------------------------------------------
    console.log('▶ 2. Testing replaceFileGroup (Replacing "ARUVI BULK DESIGNS 2")...');
    const newReplacementItems = [
      {
        originalName: 'new_floral_01.png',
        publicUrl: '/uploads/previews/new_floral_01.png',
        thumbUrl: '/uploads/thumbnails/new_floral_01.png',
        fileSize: 48200,
        checksum: 'sha256_mock_img1',
        isZip: false
      },
      {
        originalName: 'new_floral_02.png',
        publicUrl: '/uploads/previews/new_floral_02.png',
        thumbUrl: '/uploads/thumbnails/new_floral_02.png',
        fileSize: 52100,
        checksum: 'sha256_mock_img2',
        isZip: false
      },
      {
        originalName: 'new_floral_01.zip',
        storageKey: 'designs/private/new_floral_01.zip',
        fileSize: 184000,
        checksum: 'sha256_mock_zip1',
        isZip: true,
        detectedFormats: ['DST', 'PES']
      },
      {
        originalName: 'new_floral_02.zip',
        storageKey: 'designs/private/new_floral_02.zip',
        fileSize: 196000,
        checksum: 'sha256_mock_zip2',
        isZip: true,
        detectedFormats: ['DST', 'PES', 'JEF']
      }
    ];

    const replaceResult = await bulkImageReplaceService.replaceFileGroup({
      adminUser: { id: 1, email: 'admin@aruvidemo.com' },
      categoryId: 10,
      categoryName: 'Blouse Designs',
      groupName: 'ARUVI BULK DESIGNS 2',
      items: newReplacementItems
    });

    assert.strictEqual(replaceResult.success, true, 'replaceFileGroup must succeed');
    assert.strictEqual(replaceResult.replacedDesignsCount, 2, 'Must replace files for 2 designs in group');
    assert.strictEqual(replaceResult.replacedImagesCount, 2, 'Must report 2 replaced images');
    assert.strictEqual(replaceResult.replacedZipsCount, 2, 'Must report 2 replaced ZIPs');
    assert(replaceResult.removedOldFilesCount >= 4, 'Must report old files removed');
    assert(replaceResult.logId, 'Must generate logId');

    console.log(`   Replaced designs: ${replaceResult.replacedDesignsCount}`);
    console.log(`   Replaced images: ${replaceResult.replacedImagesCount}`);
    console.log(`   Replaced ZIPs: ${replaceResult.replacedZipsCount}`);
    console.log(`   Old files removed: ${replaceResult.removedOldFilesCount}`);
    console.log('   ✅ Replacement committed successfully!\n');

    // -------------------------------------------------------------
    // Test 3: Verify Active Files & Product Integrity
    // -------------------------------------------------------------
    console.log('▶ 3. Verifying active files and product integrity...');
    const d2001 = await Design.getById(2001);
    const d2002 = await Design.getById(2002);
    const d2003 = await Design.getById(2003); // in same category, different group
    const d9001 = await Design.getById(9001); // in different category

    // Check replaced designs
    assert(d2001.primary_image.includes('new_floral_01.png'), 'Design 2001 primary image must be updated to new file');
    assert.strictEqual(d2001.files[0].file_name, 'new_floral_01.zip', 'Design 2001 ZIP package must be updated to new file');
    assert.strictEqual(d2001.price, 499, 'Product price must NOT be altered');
    assert.strictEqual(d2001.stitch_count, 24500, 'Product stitch count must NOT be altered');
    assert.strictEqual(d2001.sku, 'ARUVI-BULK-01', 'Product SKU must NOT be altered');

    assert(d2002.primary_image.includes('new_floral_02.png'), 'Design 2002 primary image must be updated to new file');
    assert.strictEqual(d2002.files[0].file_name, 'new_floral_02.zip', 'Design 2002 ZIP package must be updated to new file');
    assert.strictEqual(d2002.price, 549, 'Product price must NOT be altered');
    assert.strictEqual(d2002.stitch_count, 31200, 'Product stitch count must NOT be altered');

    // Check unaffected designs
    assert.strictEqual(d2003.primary_image, '/uploads/previews/peacock_border.png', 'Other group in category must remain untouched');
    assert.strictEqual(d2003.files[0].file_name, 'peacock_border.zip', 'Other group ZIP must remain untouched');

    assert.strictEqual(d9001.primary_image, '/uploads/previews/saree_01.png', 'Other category design must remain untouched');
    assert.strictEqual(d9001.files[0].file_name, 'saree_01.zip', 'Other category ZIP must remain untouched');
    console.log('   ✅ Replaced group active files updated. Other groups and categories completely untouched!\n');

    // -------------------------------------------------------------
    // Test 4: Verify 7-Day Rollback Manifest
    // -------------------------------------------------------------
    console.log('▶ 4. Verifying 7-Day Rollback Backup Manifest...');
    const backupDir = path.resolve(__dirname, '..', 'backups', `bulk_replace_${replaceResult.logId}`);
    const manifestPath = path.join(backupDir, 'manifest.json');
    assert(fs.existsSync(manifestPath), 'manifest.json must be saved in backups directory');

    const manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(manifestData.logId, replaceResult.logId);
    assert.strictEqual(manifestData.groupName, 'ARUVI BULK DESIGNS 2');
    assert.strictEqual(manifestData.reportItems.length, 2);
    console.log(`   Manifest validated: ${manifestData.reportItems.length} items snapshotted for undo.`);
    console.log('   ✅ 7-Day Rollback snapshot verified!\n');

    // -------------------------------------------------------------
    // Test 5: Verify Rollback / Undo Operation
    // -------------------------------------------------------------
    console.log('▶ 5. Testing Undo / Rollback...');
    const undoResult = await bulkImageReplaceService.undoBulkReplacement(replaceResult.logId);
    assert.strictEqual(undoResult.success, true, 'undoBulkReplacement must succeed');
    assert.strictEqual(undoResult.revertedCount, 2, 'Must revert 2 designs');

    // Verify designs restored to old files
    const restored2001 = await Design.getById(2001);
    assert.strictEqual(restored2001.primary_image, '/uploads/previews/ARUVI BULK DESIGNS 2/old_floral_01.png', 'Primary image must be restored to old file');
    assert.strictEqual(restored2001.files[0].file_name, 'old_floral_01.zip', 'ZIP must be restored to old file');
    console.log('   ✅ Rollback / Undo successfully restored previous working files!\n');

    console.log('===============================================================');
    console.log('🎉 ALL GROUP REPLACE WORKFLOW TESTS PASSED PERFECTLY!');
    console.log('===============================================================');

    // Clean up temporary backup dir
    if (fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }

  } finally {
    Design.getAll = origGetAll;
    Design.getById = origGetById;
    Design.replacePrimaryImage = origReplacePrimaryImage;
    Design.replaceMachineFile = origReplaceMachineFile;
  }
}

runGroupReplaceFlowTest().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
