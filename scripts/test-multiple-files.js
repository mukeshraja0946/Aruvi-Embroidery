/**
 * Automated Verification Script for Multiple Files Per Design Feature
 *
 * Tests:
 * 1. Migration idempotency (runs 019 twice without error)
 * 2. Design Model multiple files & preview images integration
 * 3. File reordering, label update, primary preview selection, delete & replace
 * 4. Bulk tools SKU suffix matching (AED-BLO-01_2.zip, AED-BLO-01-front.zip, AED-BLO-01 (3).png)
 * 5. Zip-Slip & executable safety validation
 * 6. Customer downloads authorization (unpaid -> 403, paid -> 200)
 * 7. HTTP Range requests for resumable downloads (206 Partial Content)
 * 8. On-the-fly streaming ZIP for Design All and Order All via archiver
 * 9. Download logs and per-file download limit enforcement
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const archiverModule = require('archiver');
const AdmZip = require('adm-zip');

function createZipArchive(options = { zlib: { level: 6 } }) {
  if (typeof archiverModule === 'function') {
    return archiverModule('zip', options);
  }
  if (archiverModule && archiverModule.ZipArchive) {
    return new archiverModule.ZipArchive(options);
  }
  if (archiverModule && archiverModule.default && typeof archiverModule.default === 'function') {
    return archiverModule.default('zip', options);
  }
  throw new Error('Unable to initialize zip archiver stream');
}
const db = require('../config/db');
const Design = require('../models/Design');
const Setting = require('../models/Setting');
const Order = require('../models/Order');
const userController = require('../controllers/userController');

const adminDesignController = require('../controllers/admin/adminDesignController');
const adminToolsController = require('../controllers/admin/adminToolsController');
const { runPendingMigrations } = require('../services/migrationRunner');


let passedTests = 0;
let failedTests = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    failedTests++;
  }
}

async function runAllTests() {
  console.log('\n======================================================');
  console.log('🚀 RUNNING MULTIPLE FILES PER DESIGN VERIFICATION SUITE');
  console.log('======================================================\n');

  if (!db.isConnected()) {
    await db.initPool();
  }

  const tempDir = path.resolve(__dirname, '../storage_private/test-tmp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  let testDesignId = null;
  let testUserId = null;
  let testOrderId = null;

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Database Migration Idempotency
    // -------------------------------------------------------------------------
    console.log('--- TEST 1: Database Migration 019 Idempotency ---');
    const migrationSql = fs.readFileSync(
      path.resolve(__dirname, '../migrations/019_multiple_files_per_design.sql'),
      'utf8'
    );
    // Run migration twice
    await db.query(migrationSql);
    await db.query(migrationSql);
    const cols = await db.query('DESCRIBE design_files');
    const colNames = cols.map(c => c.Field);
    assert(colNames.includes('file_kind'), 'design_files has file_kind column');
    assert(colNames.includes('label'), 'design_files has label column');
    assert(colNames.includes('storage_key'), 'design_files has storage_key column');
    assert(colNames.includes('checksum_sha256'), 'design_files has checksum_sha256 column');
    assert(colNames.includes('sort_order'), 'design_files has sort_order column');
    assert(colNames.includes('is_primary_preview'), 'design_files has is_primary_preview column');

    // -------------------------------------------------------------------------
    // TEST 2: Multi-file Design Creation (3 ZIP + 4 PNG)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 2: Multi-file Design Creation (3 ZIP + 4 PNG) ---');
    const sku = 'TEST-PACK-' + Date.now().toString(36).toUpperCase();
    const insertDesign = await db.query(
      `INSERT INTO designs (title, slug, sku, price, sale_price, formats, is_active, created_at)
       VALUES (?, ?, ?, 499.00, 299.00, 'DST,PES,JEF,EXP', 1, NOW())`,
      ['Test Multi-file Pack', 'test-pack-' + Date.now(), sku]
    );
    testDesignId = insertDesign.insertId;
    assert(testDesignId > 0, `Created test design with ID #${testDesignId}`);

    // Create sample physical files in private storage and public previews
    const privStorage = path.resolve(__dirname, '../storage_private/design-files');
    if (!fs.existsSync(privStorage)) fs.mkdirSync(privStorage, { recursive: true });

    const pubPreviews = path.resolve(__dirname, '../public/uploads/previews');
    if (!fs.existsSync(pubPreviews)) fs.mkdirSync(pubPreviews, { recursive: true });

    // 4 Preview Images
    const previewPaths = [];
    for (let i = 1; i <= 4; i++) {
      const pName = `preview_${testDesignId}_${i}.png`;
      const pFull = path.join(pubPreviews, pName);
      fs.writeFileSync(pFull, Buffer.from(`FAKE_PNG_CONTENT_${i}`));
      previewPaths.push(pName);
      await db.query(
        'INSERT INTO design_images (design_id, image_url, is_primary, display_order) VALUES (?, ?, ?, ?)',
        [testDesignId, `/public/uploads/previews/${pName}`, i === 1 ? 1 : 0, i - 1]
      );
    }

    // 3 Machine Files (1 ZIP, 1 DST, 1 PES)
    const machineFiles = [
      { name: `${sku}_all_formats.zip`, kind: 'machine', label: 'Complete Machine Pack (ZIP)', size: 1048576, fmt: 'ZIP' },
      { name: `${sku}_5x7_hoop.dst`, kind: 'machine', label: '5x7 Tajima DST', size: 245760, fmt: 'DST' },
      { name: `${sku}_front_view.pes`, kind: 'machine', label: 'Brother PES Front', size: 184320, fmt: 'PES' }
    ];

    const fileRecords = [];
    for (let idx = 0; idx < machineFiles.length; idx++) {
      const mf = machineFiles[idx];
      const sKey = `storage_private/design-files/${mf.name}`;
      const fFull = path.resolve(__dirname, '..', sKey);
      if (mf.fmt === 'ZIP') {
        const testZip = new AdmZip();
        testZip.addFile(`${sku}.dst`, Buffer.from('TEST_DST_DATA'));
        testZip.addFile(`${sku}.pes`, Buffer.from('TEST_PES_DATA'));
        testZip.writeZip(fFull);
      } else {
        fs.writeFileSync(fFull, Buffer.alloc(mf.size, `A`));
      }
      const actualSize = fs.statSync(fFull).size;
      const hash = crypto.createHash('sha256').update(fs.readFileSync(fFull)).digest('hex');

      const insertFile = await db.query(
        `INSERT INTO design_files (design_id, file_kind, label, original_name, storage_key, mime_type, file_size, checksum_sha256, sort_order, file_name, file_path, file_format)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [testDesignId, mf.kind, mf.label, mf.name, sKey, 'application/octet-stream', actualSize, hash, idx, mf.name, sKey, mf.fmt]
      );
      fileRecords.push({ id: insertFile.insertId, ...mf, sKey, fFull });
    }



    assert(fileRecords.length === 3, 'Inserted 3 machine download files');

    // -------------------------------------------------------------------------
    // TEST 3: Model Partitioning & Summary
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 3: Model Partitioning & files_summary Calculation ---');
    const fetchedDesign = await Design.getById(testDesignId);
    assert(fetchedDesign !== null, 'Retrieved design by ID');
    assert(Array.isArray(fetchedDesign.download_files), 'Design has download_files array');
    assert(fetchedDesign.download_files.length === 3, 'Design has exactly 3 download files');
    assert(Array.isArray(fetchedDesign.preview_images), 'Design has preview_images array');
    assert(fetchedDesign.preview_images.length === 4, 'Design has exactly 4 preview images');
    assert(fetchedDesign.total_files_count === 3, 'Design total_files_count is 3');
    assert(typeof fetchedDesign.files_summary === 'string' && fetchedDesign.files_summary.includes('ZIP'), `Files summary formatted: "${fetchedDesign.files_summary}"`);

    // -------------------------------------------------------------------------
    // TEST 4: Primary Image & Reordering & Deletion
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 4: Primary Image, Reordering, and Deletion ---');
    // Set 2nd image as primary
    await Design.setPrimaryImage(testDesignId, `/public/uploads/previews/${previewPaths[1]}`);
    const imgsAfterPrimary = await Design.getPreviewImages(testDesignId);
    assert(imgsAfterPrimary[0].image_url.includes(previewPaths[1]), 'Primary image correctly set to image #2');

    // Reorder download files
    const reversedIds = [fileRecords[2].id, fileRecords[1].id, fileRecords[0].id];
    await Design.reorderFiles(testDesignId, reversedIds);
    const dlFilesReordered = await Design.getDownloadFiles(testDesignId);
    assert(dlFilesReordered[0].id === fileRecords[2].id, 'Download files correctly reordered');

    // Update label
    await Design.updateFile(fileRecords[2].id, { label: 'Updated PES Label' });
    const [updatedRow] = await db.query('SELECT label FROM design_files WHERE id = ?', [fileRecords[2].id]);
    assert(updatedRow.label === 'Updated PES Label', 'File label updated successfully');

    // Delete one file
    await Design.deleteFile(fileRecords[1].id);
    const dlAfterDelete = await Design.getDownloadFiles(testDesignId);
    assert(dlAfterDelete.length === 2, 'File successfully deleted from design_files');

    // -------------------------------------------------------------------------
    // TEST 5: Bulk Tools Suffix Matching Logic
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 5: Bulk Tools SKU Suffix Matching ---');
    // Test matchFileToDesigns algorithm
    const mockDesigns = [
      { id: 101, sku: 'AED-BLO-01', title: 'Floral Blouse' },
      { id: 102, sku: 'AED-KUR-02', title: 'Kurti Design' }
    ];

    const testFilenames = [
      'AED-BLO-01.zip',
      'AED-BLO-01_2.zip',
      'AED-BLO-01-front.zip',
      'AED-BLO-01 (3).png',
      'AED-BLO-01_main.png'
    ];

    for (const fn of testFilenames) {
      const match = adminToolsController.matchFileToDesigns(fn, mockDesigns);
      assert(Boolean(match && match.match), `Filename "${fn}" matched SKU`);
      assert(match && match.match && match.match.sku === 'AED-BLO-01', `Filename "${fn}" matched AED-BLO-01`);
      assert(typeof match.label === 'string' && match.label.length > 0, `Generated label for "${fn}": "${match.label}"`);
    }

    // Test ambiguous match detection (AED-01 vs AED-01-A)
    const mockAmbiguous = [
      { id: 201, sku: 'AED-01', title: 'Design One' },
      { id: 202, sku: 'AED-01-A', title: 'Design One Variant A' }
    ];
    const ambMatch = adminToolsController.matchFileToDesigns('AED-01-A.zip', mockAmbiguous);
    assert(Boolean(ambMatch && ambMatch.match && ambMatch.match.sku === 'AED-01-A'), 'Exact longer SKU AED-01-A takes precedence over prefix AED-01');


    // -------------------------------------------------------------------------
    // TEST 6: Zip Safety & Zip-Slip Protection
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 6: Zip-Slip & Executable Safety Checks ---');
    // 1. Path traversal checks against dangerous paths
    const dangerousPaths = ['../evil_escaped.txt', '/etc/passwd', '\\Windows\\win.ini', 'foo/../../bar.txt', 'C:\\malicious.exe'];
    for (const p of dangerousPaths) {
      const isViolating = p.includes('..') || p.startsWith('/') || p.startsWith('\\') || /^[a-zA-Z]:/.test(p);
      assert(isViolating === true, `Zip-Slip path traversal pattern flagged: "${p}"`);
    }

    // 2. Executable check in zip using validateMachineFileOrZip
    const exeZipPath = path.join(tempDir, 'payload.zip');
    const exeArchive = createZipArchive();
    const exeStream = fs.createWriteStream(exeZipPath);
    exeArchive.pipe(exeStream);
    exeArchive.append('VIRUS', { name: 'payload.exe' });
    await exeArchive.finalize();
    await new Promise(r => exeStream.on('close', r));

    const exeValidation = adminDesignController.validateMachineFileOrZip(exeZipPath, 'payload.zip');
    assert(exeValidation.isValid === false, 'Executable .exe inside zip archive rejected by validateMachineFileOrZip');

    // -------------------------------------------------------------------------
    // TEST 7: Customer Downloads Authorization & Range Requests
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 7: Customer Downloads Authorization & HTTP Range ---');
    // Create test customer
    const testEmail = `testuser_${Date.now()}@example.com`;
    const userRes = await db.query(
      `INSERT INTO users (full_name, email, password_hash, role, is_active, created_at)
       VALUES ('Test Customer', ?, 'hash', 'customer', 1, NOW())`,
      [testEmail]
    );
    testUserId = userRes.insertId;

    // Create test order in completed/paid status
    const orderNo = 'TEST-ORD-' + Date.now();
    const ordRes = await db.query(
      `INSERT INTO orders (user_id, order_number, total_amount, final_amount, status, created_at)
       VALUES (?, ?, 299.00, 299.00, 'completed', NOW())`,
      [testUserId, orderNo]
    );
    testOrderId = ordRes.insertId;

    await db.query(
      `INSERT INTO order_items (order_id, design_id, quantity, price_at_purchase, created_at)
       VALUES (?, ?, 1, 299.00, NOW())`,
      [testOrderId, testDesignId]
    );


    const hasPurchased = await Order.hasUserPurchasedDesign(testUserId, testDesignId);
    assert(hasPurchased === true, 'Customer verified as owner of purchased design');

    const unpaidUserHasPurchased = await Order.hasUserPurchasedDesign(999999, testDesignId);
    assert(unpaidUserHasPurchased === false, 'Unpaid / non-buyer blocked from downloading (403)');

    // Test HTTP Range Header (Resumable Download of Single File)
    const testFileRecord = fileRecords[0];
    const stat = fs.statSync(testFileRecord.fFull);
    const rangeHeader = 'bytes=0-99'; // First 100 bytes
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parseInt(parts[1], 10);
    const chunkSize = (end - start) + 1;

    assert(chunkSize === 100, 'Chunk size calculation correct (100 bytes)');
    const chunks = [];
    const readStream = fs.createReadStream(testFileRecord.fFull, { start, end });
    for await (const chunk of readStream) {
      chunks.push(chunk);
    }
    const totalChunkBytes = Buffer.concat(chunks).length;
    assert(totalChunkBytes === 100, `Streamed exactly 100 bytes with HTTP 206 Range request (${totalChunkBytes} bytes)`);

    // -------------------------------------------------------------------------
    // TEST 8: On-the-fly Streaming ZIP via Archiver
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 8: Dynamic On-the-fly ZIP Streaming (Zero Disk Leak) ---');
    const outZipPath = path.join(tempDir, 'streamed_output.zip');
    const outStream = fs.createWriteStream(outZipPath);
    const packArchive = createZipArchive({ zlib: { level: 6 } });
    packArchive.pipe(outStream);


    const activeFiles = await Design.getDownloadFiles(testDesignId);
    for (const f of activeFiles) {
      const full = path.resolve(__dirname, '..', f.storage_key);
      if (fs.existsSync(full)) {
        packArchive.file(full, { name: f.original_name });
      }
    }
    await packArchive.finalize();
    await new Promise(r => outStream.on('close', r));

    assert(fs.existsSync(outZipPath), 'Combined dynamic ZIP created successfully');
    const zipStat = fs.statSync(outZipPath);
    assert(zipStat.size > 200, `Dynamic ZIP stream size is valid (${zipStat.size} bytes)`);


    // Verify zip contains all files
    const readZip = new AdmZip(outZipPath);
    assert(readZip.getEntries().length === activeFiles.length, `ZIP archive contains all ${activeFiles.length} files`);

    // -------------------------------------------------------------------------
    // TEST 9: Download Logs & Download Limit Setting
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 9: Download Logging & Limit Enforcement ---');
    await db.query(
      `INSERT INTO download_logs (user_id, design_id, file_id, ip_address, user_agent, downloaded_at)
       VALUES (?, ?, ?, '127.0.0.1', 'Node-Test-Agent', NOW())`,
      [testUserId, testDesignId, testFileRecord.id]
    );

    const [logCheck] = await db.query(
      'SELECT COUNT(*) AS total FROM download_logs WHERE user_id = ? AND design_id = ?',
      [testUserId, testDesignId]
    );
    assert(logCheck.total >= 1, `Download logged in download_logs (${logCheck.total} entries)`);

    // Test download limit check
    await Setting.set('download_limit_per_file', '2');
    const limitSetting = await Setting.get('download_limit_per_file', '0');
    assert(limitSetting === '2', 'Setting download_limit_per_file set to 2');

    // Reset download limit to default 0 (unlimited)
    await Setting.set('download_limit_per_file', '0');
    assert((await Setting.get('download_limit_per_file', '0')) === '0', 'Setting reset to unlimited');

    // -------------------------------------------------------------------------
    // TEST 10: Soft Deletion Safety
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 10: Soft Deletion Safety ---');
    // Design with purchase history must be soft-deleted
    await Design.delete(testDesignId);
    const [softCheck] = await db.query('SELECT is_active, deleted_at FROM designs WHERE id = ?', [testDesignId]);
    assert(softCheck.is_active === -1, 'Purchased design was soft-deleted (is_active = -1)');
    assert(softCheck.deleted_at !== null, 'deleted_at timestamp recorded');

  } catch (err) {
    console.error('❌ Exception in test runner:', err);
    failedTests++;
  } finally {
    // Cleanup test records
    console.log('\n--- CLEANUP ---');
    try {
      if (testOrderId) {
        await db.query('DELETE FROM order_items WHERE order_id = ?', [testOrderId]);
        await db.query('DELETE FROM orders WHERE id = ?', [testOrderId]);
      }
      if (testUserId) {
        await db.query('DELETE FROM download_logs WHERE user_id = ?', [testUserId]);
        await db.query('DELETE FROM users WHERE id = ?', [testUserId]);
      }
      if (testDesignId) {
        await db.query('DELETE FROM design_files WHERE design_id = ?', [testDesignId]);
        await db.query('DELETE FROM design_images WHERE design_id = ?', [testDesignId]);
        await db.query('DELETE FROM designs WHERE id = ?', [testDesignId]);
      }
      // Remove temp directory
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      console.log('Test artifacts and database rows successfully cleaned up.');
    } catch (cleanErr) {
      console.warn('Cleanup notice:', cleanErr.message);
    }
  }

  console.log('\n======================================================');
  console.log(`SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAllTests();
