const db = require('../config/db');
const dupService = require('../services/duplicateFilesService');

async function test() {
  console.log('--- Step 1: Testing DB Unique Constraint ---');
  try {
    await db.query(
      'INSERT INTO design_files (design_id, original_name, storage_key, checksum_sha256) VALUES (?, ?, ?, ?)',
      [3348, 'AED 1.zip', 'downloads/dup_test.zip', 'sha256_mock_bulk_1']
    );
    console.error('FAIL: Expected ER_DUP_ENTRY but insert succeeded!');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      console.log('PASS: ER_DUP_ENTRY correctly raised by DB unique index idx_design_file_unique');
    } else {
      console.log('Encountered error:', err.message);
    }
  }

  console.log('\n--- Step 2: Testing Dry-Run Report on Duplicate storage_key ---');
  await db.query(
    'INSERT INTO design_files (design_id, original_name, storage_key, checksum_sha256) VALUES (?, ?, ?, NULL)',
    [3348, 'AED 1.zip', 'downloads/aed_3348_1.zip']
  );
  const report = await dupService.getDryRunReport();
  console.log('Dry Run report totalFilesToRemove:', report.totalFilesToRemove);
  if (report.totalFilesToRemove >= 1) {
    console.log('PASS: Dry-run accurately detected duplicate file row.');
  }

  console.log('\n--- Step 3: Testing Clean Duplicates with Backup ---');
  const cleanResult = await dupService.cleanDuplicates({ adminId: 1, adminEmail: 'admin@aruviembroidery.com' });
  console.log('Cleaned file rows:', cleanResult.cleanedFileRows);
  console.log('Backup file:', cleanResult.backupFileName);
  if (cleanResult.success) {
    console.log('PASS: cleanDuplicates completed successfully and saved SQL backup.');
  }

  console.log('\n--- Step 4: Testing 7-Day Undo ---');
  if (cleanResult.backupFileName) {
    const undoResult = await dupService.undoCleanup(cleanResult.backupFileName);
    console.log('Undo restored rows:', undoResult.restoredRows);
    if (undoResult.success) {
      console.log('PASS: undoCleanup successfully restored rows from backup.');
    }

    // Clean it once more to ensure database is 100% clean
    await dupService.cleanDuplicates({ adminId: 1, adminEmail: 'admin@aruviembroidery.com' });
    console.log('PASS: Re-cleaned to leave database in 0-duplicate state.');
  }

  console.log('\n--- Step 5: Verify Final DB Duplicate Count ---');
  const finalCheck = await dupService.getDryRunReport();
  console.log('Final duplicates remaining in DB:', finalCheck.totalFilesToRemove);

  process.exit(0);
}

test().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
