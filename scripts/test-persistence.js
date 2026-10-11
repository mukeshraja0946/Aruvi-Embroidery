const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const dotenv = require('dotenv');
dotenv.config();

const storage = require('../config/storage');
const db = require('../config/db');
const Design = require('../models/Design');

async function runPersistenceTests() {
  console.log('====================================================');
  console.log('  ARUVI EMBROIDERY — PERSISTENT STORAGE VERIFICATION');
  console.log('====================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passedTests++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
    }
  }

  // 1. Verify Storage Directories
  console.log('1. Verifying Storage Paths...');
  const uploadsDir = storage.getUploadsDir();
  const previewsDir = storage.getPreviewsDir();
  const designsDir = storage.getDesignsDir();

  console.log(`   - Uploads Base: ${uploadsDir}`);
  console.log(`   - Previews:     ${previewsDir}`);
  console.log(`   - Designs:      ${designsDir}`);

  assert(fs.existsSync(uploadsDir), 'Uploads directory exists');
  assert(fs.existsSync(previewsDir), 'Previews directory exists');
  assert(fs.existsSync(designsDir), 'Designs directory exists');

  // 2. Test File Creation in Persistent Storage
  console.log('\n2. Testing Product File Upload Simulation...');
  const testImgFilename = `test_preview_${Date.now()}.png`;
  const testZipFilename = `test_archive_${Date.now()}.zip`;

  const testImgPath = path.join(previewsDir, testImgFilename);
  const testZipPath = path.join(designsDir, testZipFilename);

  // Write mock PNG and binary ZIP
  fs.writeFileSync(testImgPath, Buffer.from('TEST_PNG_DATA_ARUVI_STUDIO'));
  
  const mockZip = new AdmZip();
  mockZip.addFile('test_embroidery.dst', Buffer.from('ARUVI_DST_BINARY_HEADER'));
  mockZip.addFile('test_embroidery.pes', Buffer.from('ARUVI_PES_BINARY_HEADER'));
  mockZip.writeZip(testZipPath);

  assert(storage.fileExists(testImgPath), 'storage.fileExists detects test PNG');
  assert(storage.fileExists(testZipPath), 'storage.fileExists detects test ZIP');

  const resolvedImg = storage.resolveFilePath(`/public/uploads/previews/${testImgFilename}`);
  const resolvedZip = storage.resolveFilePath(`/public/uploads/designs/${testZipFilename}`);

  assert(resolvedImg === testImgPath, 'storage.resolveFilePath accurately maps web URL to disk PNG');
  assert(resolvedZip === testZipPath, 'storage.resolveFilePath accurately maps web URL to disk ZIP');

  // 3. Test Database Creation & Integrity
  console.log('\n3. Testing Product Creation in Database...');
  const testSku = `TEST-SKU-${Date.now()}`;
  let createdDesignId = null;

  try {
    createdDesignId = await Design.create({
      title: 'Persistent Verification Test Product',
      sku: testSku,
      slug: `test-product-${Date.now()}`,
      price: 499.00,
      sale_price: 399.00,
      category_id: 1,
      formats: 'DST, PES',
      is_active: 1
    });

    assert(Boolean(createdDesignId), `Product created with ID: ${createdDesignId}`);

    // Attach image and ZIP
    await Design.addFile(createdDesignId, testImgFilename, `/public/uploads/previews/${testImgFilename}`, 'PNG', 26, 1);
    await Design.addFile(createdDesignId, testZipFilename, `/public/uploads/designs/${testZipFilename}`, 'ZIP', fs.statSync(testZipPath).size, 0);

    const fetched = await Design.getById(createdDesignId);
    assert(fetched && fetched.primary_image === `/public/uploads/previews/${testImgFilename}`, 'Product primary_image set correctly');
    
    const machineFile = (fetched.files || []).find(f => !f.is_preview && f.file_format === 'ZIP');
    assert(machineFile && machineFile.file_path === `/public/uploads/designs/${testZipFilename}`, 'Product ZIP package saved with correct path');

    // 4. Test Edit Text & Price Without New Files
    console.log('\n4. Testing Edit Text and Price Without Selecting Replacement Files...');
    const originalImagePath = fetched.primary_image;
    const originalZipPath = machineFile.file_path;

    await Design.update(createdDesignId, {
      title: 'Updated Test Product Title',
      price: 599.00,
      sale_price: 449.00,
      description: 'Updated description without files'
    });

    const updatedFetched = await Design.getById(createdDesignId);
    assert(updatedFetched.title === 'Updated Test Product Title', 'Product title updated');
    assert(Number(updatedFetched.price) === 599.00, 'Product price updated');
    assert(updatedFetched.primary_image === originalImagePath, 'Existing image path PRESERVED unchanged');

    const updatedMachineFile = (updatedFetched.files || []).find(f => !f.is_preview && f.file_format === 'ZIP');
    assert(updatedMachineFile && updatedMachineFile.file_path === originalZipPath, 'Existing ZIP package path PRESERVED unchanged');
    assert(fs.existsSync(testImgPath), 'Physical image file remains intact on disk');
    assert(fs.existsSync(testZipPath), 'Physical ZIP file remains intact on disk');

    // 5. Test Download File Resolution
    console.log('\n5. Testing Customer Download Package File Resolution...');
    const resolvedDownload = storage.resolveFilePath(updatedMachineFile.file_path);
    assert(Boolean(resolvedDownload && fs.existsSync(resolvedDownload)), 'Download path resolves to authentic physical ZIP');

    const downloadedZip = new AdmZip(resolvedDownload);
    const entries = downloadedZip.getEntries().map(e => e.entryName);
    assert(entries.includes('test_embroidery.dst') && entries.includes('test_embroidery.pes'), 'Customer ZIP contains actual design machine files (not sample fallback)');

    // 6. Test Explicit File Replacement
    console.log('\n6. Testing Explicit Replacement Upload...');
    const replacementZipFilename = `test_replacement_${Date.now()}.zip`;
    const replacementZipPath = path.join(designsDir, replacementZipFilename);
    const replacementZip = new AdmZip();
    replacementZip.addFile('new_flower.dst', Buffer.from('NEW_FLOWER_DST'));
    replacementZip.writeZip(replacementZipPath);

    // Simulate replacement in controller: delete old DB file record ONLY AFTER new file confirmed on disk
    assert(fs.existsSync(replacementZipPath), 'Replacement file confirmed on disk before DB update');
    
    if (db.isConnected()) {
      await db.query('DELETE FROM design_files WHERE design_id = ? AND is_preview = 0', [createdDesignId]);
    }
    await Design.addFile(createdDesignId, replacementZipFilename, `/public/uploads/designs/${replacementZipFilename}`, 'ZIP', fs.statSync(replacementZipPath).size, 0);

    const postReplace = await Design.getById(createdDesignId);
    const replacedFile = (postReplace.files || []).find(f => !f.is_preview && f.file_format === 'ZIP');
    assert(replacedFile.file_name === replacementZipFilename, 'Product now references new replacement file');

    // 7. Cleanup Test Files
    console.log('\n7. Cleaning Up Test Artifacts Safely...');
    await Design.delete(createdDesignId);
    if (fs.existsSync(testImgPath)) fs.unlinkSync(testImgPath);
    if (fs.existsSync(testZipPath)) fs.unlinkSync(testZipPath);
    if (fs.existsSync(replacementZipPath)) fs.unlinkSync(replacementZipPath);
    assert(!fs.existsSync(testImgPath), 'Test image cleaned up');
    assert(!fs.existsSync(replacementZipPath), 'Test replacement cleaned up');

  } catch (err) {
    console.error('Test Execution Error:', err);
  }

  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${passedTests} / ${totalTests} PASSED`);
  if (passedTests === totalTests) {
    console.log('✓ ALL PERSISTENCE REQUIREMENTS VERIFIED SUCCESSFULLY!');
  } else {
    console.log('❌ SOME TESTS FAILED. PLEASE REVIEW ABOVE LOGS.');
  }
  console.log('====================================================');

  process.exit(passedTests === totalTests ? 0 : 1);
}

runPersistenceTests();
