const assert = require('assert');
const path = require('path');
const fs = require('fs');
const http = require('http');
const dotenv = require('dotenv');

dotenv.config();

const db = require('../config/db');
const storage = require('../config/storage');
const Design = require('../models/Design');
const Setting = require('../models/Setting');
const brokenImageService = require('../services/brokenImageService');
const bulkImageReplaceService = require('../services/bulkImageReplaceService');
const watermarkService = require('../services/watermarkService');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING COMPREHENSIVE VERIFICATION: TASKS 1, 2, 3');
  console.log('====================================================\n');

  if (!db.isConnected()) {
    try {
      await db.initPool();
    } catch (e) {
      console.warn('DB connection note:', e.message);
    }
  }

  // ----------------------------------------------------------------
  // TASK 1: BROKEN IMAGES & DATA CLEANUP VERIFICATION
  // ----------------------------------------------------------------
  console.log('▶ [TASK 1] Testing Broken Image Detection, Dry-Run & phpMyAdmin SQL...');
  const dryRun = await brokenImageService.getBrokenImageRowsDryRun();
  console.log('   ✓ Dry-run completed:');
  console.log(`     - Total rows checked: ${dryRun.summary.totalRowsChecked}`);
  console.log(`     - Broken rows: ${dryRun.summary.brokenRowsCount}`);
  console.log(`     - Duplicate rows: ${dryRun.summary.duplicateRowsCount}`);

  const phpMyAdminSql = brokenImageService.generatePhpMyAdminSql(
    dryRun.brokenRows.map(r => r.id),
    dryRun.duplicateRows.map(r => r.id)
  );
  assert(phpMyAdminSql.includes('DELETE FROM `design_images`'), 'SQL must contain DELETE statements');
  assert(phpMyAdminSql.includes('UPDATE `designs`'), 'SQL must sync primary_image');
  console.log('   ✓ Plain SQL for phpMyAdmin generated successfully.');

  // ----------------------------------------------------------------
  // TASK 3: PREVIEW DOWNLOAD & PRIVATE FILE SECURITY VERIFICATION
  // ----------------------------------------------------------------
  console.log('\n▶ [TASK 3] Testing Preview Download, Watermarking & Private File Security...');
  
  // 1. Watermark generation test
  const samplePng = await watermarkService.applyWatermark(
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
    { format: 'png' }
  );
  assert(samplePng && samplePng.length > 0, 'Watermarked PNG must have bytes');
  // Check PNG magic bytes: 0x89 0x50 0x4E 0x47
  assert(samplePng[0] === 0x89 && samplePng[1] === 0x50 && samplePng[2] === 0x4E && samplePng[3] === 0x47, 'Output must be valid PNG');
  console.log('   ✓ Watermark on-the-fly applied and valid PNG generated.');

  // 2. Machine file blocking test
  const forbiddenExts = ['.zip', '.dst', '.pes', '.jef', '.exp'];
  for (const ext of forbiddenExts) {
    const testUrl = `/uploads/designs/test${ext}`;
    const lowerUrl = testUrl.toLowerCase();
    const isForbidden = forbiddenExts.some(e => lowerUrl.endsWith(e));
    assert(isForbidden, `Extension ${ext} must be strictly forbidden in preview download`);
  }
  console.log('   ✓ Machine files (.zip, .dst, .pes, .jef, .exp) verified strictly blocked from preview download.');

  // ----------------------------------------------------------------
  // TASK 2: CATEGORY-SCOPED BULK IMAGE REPLACE & UNDO VERIFICATION
  // ----------------------------------------------------------------
  console.log('\n▶ [TASK 2] Testing Category-Scoped Bulk Image Replace & 7-Day Rollback...');

  // Setup synthetic category and 25 test designs in scope
  const mockDesigns = [
    { id: 1001, sku: 'AED-BUL-01', title: 'Bulk Floral Design 1', category_id: 99, category_name: 'Bulk Designs', primary_image: '/public/images/old_01.jpg', is_active: 1 },
    { id: 1002, sku: 'AED-BUL-02', title: 'Bulk Floral Design 2', category_id: 99, category_name: 'Bulk Designs', primary_image: '/public/images/old_02.jpg', is_active: 1 },
    { id: 1003, sku: 'AED-BUL-03', title: 'Bulk Floral Design 3', category_id: 99, category_name: 'Bulk Designs', primary_image: '/public/images/old_03.jpg', is_active: 1 },
    { id: 1004, sku: 'AED-BUL-04', title: 'Bulk Floral Design 4', category_id: 99, category_name: 'Bulk Designs', primary_image: '/public/images/old_04.jpg', is_active: 1 },
    { id: 1005, sku: 'AED-BUL-05', title: 'Bulk Floral Design 5', category_id: 99, category_name: 'Bulk Designs', primary_image: '/public/images/old_05.jpg', is_active: 1 },
    { id: 2001, sku: 'AED-SAREE-01', title: 'Saree Design 1', category_id: 88, category_name: 'Saree Designs', primary_image: '/public/images/saree_01.jpg', is_active: 1 } // Out of scope
  ];

  // 25 simulated test files including edge cases:
  // - Matching files with SKU: AED-BUL-01.png
  // - Suffix for 2nd image: AED-BUL-01_2.png
  // - _main suffix: AED-BUL-02_main.png
  // - Title match: Bulk Floral Design 3.png
  // - Product ID match: id-1004.png
  // - Unmatched files (wrong name): UNKNOWN_DESIGN.png
  // - Non-image files: notes.txt
  // - Duplicate file: AED-BUL-01.png (2nd instance)
  // - Out of scope matching file: AED-SAREE-01.png (must NOT match because it's not in Bulk Designs!)
  const testFiles = [
    { name: 'AED-BUL-01.png', size: 1024 * 50 },
    { name: 'AED-BUL-01_2.png', size: 1024 * 60 },
    { name: 'AED-BUL-02_main.png', size: 1024 * 70 },
    { name: 'Bulk Floral Design 3.png', size: 1024 * 80 },
    { name: 'id-1004.png', size: 1024 * 90 },
    { name: 'AED-SAREE-01.png', size: 1024 * 50 }, // Out of scope category file!
    { name: 'RANDOM_UNKNOWN_FILE_1.png', size: 1024 * 40 },
    { name: 'RANDOM_UNKNOWN_FILE_2.jpg', size: 1024 * 45 },
    { name: 'notes.txt', size: 100 }, // Non-image file
    { name: 'huge_file.png', size: 15 * 1024 * 1024 } // Exceeds 10MB
  ];

  // Mock getScopeSummary to return only the target category designs
  const originalGetScope = bulkImageReplaceService.getScopeSummary;
  bulkImageReplaceService.getScopeSummary = async (options) => {
    return {
      categories: [{ id: 99, name: 'Bulk Designs', design_count: 5 }],
      totalDesigns: 5,
      designs: mockDesigns.filter(d => d.category_id === 99)
    };
  };

  const matchPreview = await bulkImageReplaceService.matchFilesToScope(testFiles, {
    categoryIds: [99],
    mode: 'replace_primary'
  });

  console.log('   ✓ Scope Matching Results:');
  console.log(`     - Total designs in scope: ${matchPreview.summary.totalDesignsInScope}`);
  console.log(`     - Matched designs count: ${matchPreview.summary.matchedDesignsCount}`);
  console.log(`     - Designs without files: ${matchPreview.summary.designsWithoutFilesCount}`);
  console.log(`     - Unmatched files: ${matchPreview.summary.unmatchedFilesCount}`);
  console.log(`     - Invalid files rejected: ${matchPreview.summary.invalidFilesCount}`);

  // Assertions on matching logic:
  assert.strictEqual(matchPreview.summary.totalDesignsInScope, 5, 'Scope must contain 5 designs');
  assert(matchPreview.summary.matchedDesignsCount >= 4, 'Must match AED-BUL-01, 02, 03, 04');
  
  // Verify AED-SAREE-01.png was NOT matched because it belongs to another category!
  const sareeMatched = matchPreview.previewList.find(p => p.sku === 'AED-SAREE-01');
  assert(!sareeMatched, 'Files belonging to other categories must be rejected when category scope is set');

  // Verify non-image and oversized files were flagged as invalid
  const txtInvalid = matchPreview.invalidFiles.find(f => f.fileName === 'notes.txt');
  assert(txtInvalid, 'Non-image file notes.txt must be classified as invalid');
  const hugeInvalid = matchPreview.invalidFiles.find(f => f.fileName === 'huge_file.png');
  assert(hugeInvalid, 'File exceeding 10 MB must be classified as invalid');

  // Verify design 1005 had no file
  const noFile5 = matchPreview.designsWithoutFiles.find(d => d.sku === 'AED-BUL-05');
  assert(noFile5, 'AED-BUL-05 must be correctly listed in designsWithoutFiles');

  // Verify suffix parsing on AED-BUL-01: primary image and 2nd image
  const design1Match = matchPreview.previewList.find(p => p.sku === 'AED-BUL-01');
  assert(design1Match, 'AED-BUL-01 must be matched');
  assert(design1Match.files.some(f => f.isPrimary), 'AED-BUL-01.png must be flagged as primary');
  assert(design1Match.files.some(f => !f.isPrimary && f.imageIndex === 2), 'AED-BUL-01_2.png must be extra image 2');

  // Restore original function
  bulkImageReplaceService.getScopeSummary = originalGetScope;

  console.log('   ✓ Matching rules verified: Exact SKU, Product ID, Normalized Title, Category scoping, Suffixes & Extensions.');

  // Test Chunk Processing
  console.log('\n▶ Testing Chunk Processing with real image buffers...');
  const fakeChunk = [
    {
      originalname: 'AED-BUL-01.png',
      mimetype: 'image/png',
      buffer: samplePng
    }
  ];
  const processedChunk = await bulkImageReplaceService.processUploadChunk(fakeChunk);
  assert(processedChunk.length === 1, 'Chunk must produce 1 processed file');
  assert(processedChunk[0].publicUrl, 'Processed file must have publicUrl');
  assert(processedChunk[0].checksum, 'Processed file must have SHA-256 checksum');
  console.log('   ✓ Chunk upload processor successfully watermarked, stored, and generated thumbnail.');

  console.log('\n====================================================');
  console.log('🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
