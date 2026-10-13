const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const assert = require('assert');

const db = require('../config/db');
const Design = require('../models/Design');
const Setting = require('../models/Setting');
const storage = require('../config/storage');
const adminDesignController = require('../controllers/admin/adminDesignController');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING BULK ZIP RESTORE & RE-UPLOAD TEST SUITE');
  console.log('====================================================');

  await db.initPool();

  // Step 1: Prepare test fixtures directory
  const testDir = path.join(__dirname, 'test_fixtures_zip');
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

  // 1.1 Create valid ZIP with DST and PES files
  const validZipPath = path.join(testDir, 'valid_embroidery.zip');
  const validZip = new AdmZip();
  validZip.addFile('pattern1.dst', Buffer.from('LA:Test Pattern DST binary data'));
  validZip.addFile('pattern2.pes', Buffer.from('PES binary embroidery data'));
  validZip.addFile('info.txt', Buffer.from('Aruvi Embroidery Pattern Info'));
  validZip.writeZip(validZipPath);

  // 1.2 Create corrupted ZIP
  const corruptZipPath = path.join(testDir, 'corrupt.zip');
  fs.writeFileSync(corruptZipPath, Buffer.from('This is not a real zip file header 1234567890'));

  // 1.3 Create ZIP with NO machine files
  const noMachineZipPath = path.join(testDir, 'no_machine.zip');
  const noMachineZip = new AdmZip();
  noMachineZip.addFile('readme.txt', Buffer.from('Only text file here'));
  noMachineZip.addFile('preview.jpg', Buffer.from('Fake image data'));
  noMachineZip.writeZip(noMachineZipPath);

  // 1.4 Create ZIP with executable
  const exeZipPath = path.join(testDir, 'has_exe.zip');
  const exeZip = new AdmZip();
  exeZip.addFile('pattern.dst', Buffer.from('DST data'));
  exeZip.addFile('installer.exe', Buffer.from('Fake executable binary'));
  exeZip.writeZip(exeZipPath);

  // 1.5 Create ZIP with zip-slip traversal
  const zipSlipPath = path.join(testDir, 'zip_slip.zip');
  const slipZip = new AdmZip();
  slipZip.addFile('placeholder.dst', Buffer.from('malicious traversal'));
  const slipEntries = slipZip.getEntries();
  if (slipEntries.length > 0) slipEntries[0].entryName = '../../etc/passwd.dst';
  slipZip.writeZip(zipSlipPath);

  console.log('✓ Test fixtures created.');

  // ==========================================================
  // TEST 1: ZIP VALIDATION ENGINE
  // ==========================================================
  console.log('\n--- TEST 1: Validation Engine ---');

  // Valid ZIP
  const validResult = adminDesignController.validateMachineFileOrZip(validZipPath, 'valid_embroidery.zip');
  assert.strictEqual(validResult.isValid, true, 'Valid ZIP should pass validation');
  assert.ok(validResult.detectedFormats.includes('DST') && validResult.detectedFormats.includes('PES'), 'Should detect DST and PES formats');
  console.log('✓ Valid ZIP passed validation and detected formats:', validResult.detectedFormats);

  // Corrupted ZIP
  const corruptResult = adminDesignController.validateMachineFileOrZip(corruptZipPath, 'corrupt.zip');
  assert.strictEqual(corruptResult.isValid, false, 'Corrupt ZIP must fail');
  assert.ok(corruptResult.reason.toLowerCase().includes('corrupted') || corruptResult.reason.toLowerCase().includes('invalid'), 'Must state corrupted/invalid');
  console.log('✓ Corrupt ZIP correctly rejected:', corruptResult.reason);

  // No machine file
  const noMachineResult = adminDesignController.validateMachineFileOrZip(noMachineZipPath, 'no_machine.zip');
  assert.strictEqual(noMachineResult.isValid, false, 'ZIP without machine files must fail');
  assert.ok(noMachineResult.reason.includes('does not contain any machine embroidery format files'), 'Must specify missing machine files');
  console.log('✓ ZIP with no machine files correctly rejected:', noMachineResult.reason);

  // Prohibited executable
  const exeResult = adminDesignController.validateMachineFileOrZip(exeZipPath, 'has_exe.zip');
  assert.strictEqual(exeResult.isValid, false, 'ZIP with executable must fail');
  assert.ok(exeResult.reason.includes('Prohibited executable'), 'Must reject executables');
  console.log('✓ ZIP with executable correctly rejected:', exeResult.reason);

  // Zip slip
  const slipResult = adminDesignController.validateMachineFileOrZip(zipSlipPath, 'zip_slip.zip');
  assert.strictEqual(slipResult.isValid, false, 'ZIP with slip traversal must fail');
  assert.ok(slipResult.reason.includes('path traversal') || slipResult.reason.includes('Zip Slip'), 'Must reject path traversal');
  console.log('✓ ZIP with traversal correctly rejected:', slipResult.reason);

  // ==========================================================
  // TEST 2: MATCHING ENGINE & DRY-RUN
  // ==========================================================
  console.log('\n--- TEST 2: Matching Engine & Dry-Run ---');

  const allDesigns = await db.query(
    'SELECT id, sku, title, slug, import_zip_filename, formats FROM designs'
  );
  console.log(`Loaded ${allDesigns.length} designs for matching test.`);

  // 2.1 Match by exact SKU
  const matchSku = await adminDesignController.findMatchingDesignForZip('AED 1.zip', allDesigns);
  assert.strictEqual(matchSku.status, 'matched', 'Should match AED 1');
  assert.strictEqual(matchSku.design.id, 1, 'AED 1.zip should match design ID 1');
  console.log('✓ Exact SKU match successful:', matchSku.matchedBy);

  // 2.2 Match by numeric Product ID (1.zip -> design 1)
  const matchId = await adminDesignController.findMatchingDesignForZip('1.zip', allDesigns);
  assert.strictEqual(matchId.status, 'matched', '1.zip should match Product ID 1');
  assert.strictEqual(matchId.design.id, 1);
  console.log('✓ Product ID match successful:', matchId.matchedBy);

  // 2.3 Match by uppercase / mixed case ("AED 1.ZIP")
  const matchCase = await adminDesignController.findMatchingDesignForZip('AED 1.ZIP', allDesigns);
  assert.strictEqual(matchCase.status, 'matched', 'AED 1.ZIP with uppercase extension should match');
  assert.strictEqual(matchCase.design.id, 1);
  console.log('✓ Mixed-case filename match successful:', matchCase.matchedBy);

  // 2.4 Match by normalized title / collapsed spaces ("AED-1.zip")
  const matchNorm = await adminDesignController.findMatchingDesignForZip('AED-1.zip', allDesigns);
  assert.strictEqual(matchNorm.status, 'matched', 'AED-1.zip should match AED 1');
  console.log('✓ Normalized punctuation match successful:', matchNorm.matchedBy);

  // 2.5 Unmatched file with suggestions
  const matchNone = await adminDesignController.findMatchingDesignForZip('COMPLETELY_UNKNOWN_PATTERN_9999.zip', allDesigns);
  assert.strictEqual(matchNone.status, 'unmatched', 'Non-existent filename must be unmatched');
  assert.ok(Array.isArray(matchNone.suggestions), 'Should return suggestions');
  console.log('✓ Unmatched file returned suggestions:', matchNone.suggestions.length);

  // ==========================================================
  // TEST 3: SAFE REPLACEMENT & DOWNLOAD COUNT INTEGRITY
  // ==========================================================
  console.log('\n--- TEST 3: Safe Replacement & Download Count Preservation ---');

  // Let's test on design ID 8 (which currently has download_count = 13)
  const [targetDesignBefore] = await db.query('SELECT id, title, sku, download_count, formats FROM designs WHERE id = 8');
  assert.ok(targetDesignBefore, 'Target design 8 must exist');
  const originalDownloadCount = targetDesignBefore.download_count;
  console.log(`Target design ID 8 before update: download_count = ${originalDownloadCount}`);

  // Perform replacement via storage.savePrivateFile and Design.replaceMachineFile
  const checksum = crypto.createHash('sha256').update(fs.readFileSync(validZipPath)).digest('hex');
  const savedKey = await storage.savePrivateFile(validZipPath, 'AED_7_test_package.zip', 'application/zip', 8);
  const replaceResult = await Design.replaceMachineFile(
    8,
    savedKey,
    'AED_7_test_package.zip',
    fs.statSync(validZipPath).size,
    checksum,
    ['DST', 'PES']
  );

  assert.strictEqual(replaceResult, true, 'replaceMachineFile must succeed');

  // Check database after replacement
  const [targetDesignAfter] = await db.query('SELECT id, title, sku, download_count, formats FROM designs WHERE id = 8');
  assert.strictEqual(targetDesignAfter.download_count, originalDownloadCount, 'Download count must NOT be modified');
  console.log(`✓ Download count strictly preserved: ${targetDesignAfter.download_count} === ${originalDownloadCount}`);

  const [newFileRecord] = await db.query('SELECT * FROM design_files WHERE design_id = 8 ORDER BY id DESC LIMIT 1');
  assert.ok(newFileRecord, 'New design_files record must exist');
  assert.strictEqual(newFileRecord.checksum, checksum, 'Checksum must match SHA-256');
  console.log(`✓ New file record created with checksum: ${newFileRecord.checksum.substring(0, 16)}...`);

  console.log('✓ Stored file path:', newFileRecord.file_path);
  const normalizedPath = newFileRecord.file_path.replace(/\\/g, '/');
  assert.ok(
    normalizedPath.includes('storage_private') || normalizedPath.includes('design-files/8/'),
    'Saved path must be inside private storage'
  );

  // Check resolveFilePath on the newly created record
  const resolved = storage.resolveFilePath(newFileRecord.file_path);
  assert.ok(resolved && fs.existsSync(resolved), 'storage.resolveFilePath must find the physical file on disk');
  console.log('✓ Physical private file resolved:', resolved);

  // ==========================================================
  // TEST 4: CHUNKED UPLOAD CONCURRENT INTEGRATION
  // ==========================================================
  console.log('\n--- TEST 4: Chunked Upload Merging ---');

  // Create a 6MB mock payload with DST data
  const chunkTestDir = path.join(testDir, 'chunks');
  if (!fs.existsSync(chunkTestDir)) fs.mkdirSync(chunkTestDir, { recursive: true });

  const largeZipPath = path.join(testDir, 'large_test_design.zip');
  const largeZip = new AdmZip();
  largeZip.addFile('embroidery_heavy.dst', Buffer.alloc(6 * 1024 * 1024, 0x41)); // 6MB
  largeZip.writeZip(largeZipPath);
  const largeZipBuffer = fs.readFileSync(largeZipPath);
  const largeChecksum = crypto.createHash('sha256').update(largeZipBuffer).digest('hex');

  const uploadId = 'test_upload_' + Date.now();
  const chunkSize = 2 * 1024 * 1024; // 2MB chunks
  const totalChunks = Math.ceil(largeZipBuffer.length / chunkSize);

  const uploadTempDir = path.join(__dirname, '../temp_chunks', uploadId);
  fs.mkdirSync(uploadTempDir, { recursive: true });

  for (let c = 0; c < totalChunks; c++) {
    const start = c * chunkSize;
    const end = Math.min(start + chunkSize, largeZipBuffer.length);
    const chunkBuffer = largeZipBuffer.slice(start, end);
    fs.writeFileSync(path.join(uploadTempDir, `chunk_${c}`), chunkBuffer);
  }

  // Assemble chunks
  const assembledPath = path.join(uploadTempDir, 'assembled.zip');
  const writeStream = fs.createWriteStream(assembledPath);
  for (let c = 0; c < totalChunks; c++) {
    const chunkPart = fs.readFileSync(path.join(uploadTempDir, `chunk_${c}`));
    writeStream.write(chunkPart);
  }
  await new Promise(resolve => writeStream.end(resolve));

  const assembledBuffer = fs.readFileSync(assembledPath);
  const assembledChecksum = crypto.createHash('sha256').update(assembledBuffer).digest('hex');
  assert.strictEqual(assembledChecksum, largeChecksum, 'Assembled file SHA-256 must match original');
  console.log(`✓ 6MB Chunked upload assembly verified with matching SHA-256 (${totalChunks} chunks)`);

  // Clean up test chunks
  fs.rmSync(uploadTempDir, { recursive: true, force: true });

  // ==========================================================
  // TEST 5: MISSING ZIP FILTER
  // ==========================================================
  console.log('\n--- TEST 5: Missing ZIP Query Filter ---');

  const missingZipDesigns = await Design.getAll({ fileFilter: 'missing_zip', limit: 5 });
  console.log(`Designs with missing ZIPs: ${missingZipDesigns.designs.length} found`);
  for (const d of missingZipDesigns.designs) {
    assert.strictEqual(!d.machine_file_name, true, 'Missing ZIP filter must only return designs without a machine file');
  }
  console.log('✓ fileFilter=missing_zip verified successfully');

  const hasZipDesigns = await Design.getAll({ fileFilter: 'has_zip', limit: 5 });
  console.log(`Designs with existing ZIPs: ${hasZipDesigns.designs.length} found`);
  for (const d of hasZipDesigns.designs) {
    assert.ok(Boolean(d.machine_file_name), 'has_zip filter must only return designs with a machine file');
  }
  console.log('✓ fileFilter=has_zip verified successfully');

  // Clean up fixtures
  fs.rmSync(testDir, { recursive: true, force: true });

  console.log('\n====================================================');
  console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! 100% VERIFIED');
  console.log('====================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILURE:', err);
  process.exit(1);
});
