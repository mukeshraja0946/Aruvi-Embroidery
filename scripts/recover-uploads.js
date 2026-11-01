const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const uploadRecoveryService = require('../services/uploadRecoveryService');
const storage = require('../config/storage');

async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const isDryRun = !isApply;

  const versionsDirArg = args.find(a => a.startsWith('--versions-dir='));
  const versionsDir = versionsDirArg ? versionsDirArg.split('=')[1]
    : (process.env.VERSIONS_DIR || '/home/u101925264/domains/aruviembroidery.com/hbuilds/versions');

  console.log('====================================================');
  console.log('🌸 Aruvi Embroidery — Upload Recovery Tool');
  console.log(` Mode: ${isDryRun ? 'DRY RUN (simulation only, zero disk writes)' : 'APPLY (copying files to persistent storage)'}`);
  console.log(` Versions Directory: ${versionsDir}`);
  console.log(` Target UPLOAD_DIR:   ${storage.getUploadsDir()}`);
  console.log('====================================================');

  const versions = uploadRecoveryService.getDeploymentVersions(versionsDir);
  console.log(`📂 Detected ${versions.length} past deployment version directories.`);

  if (versions.length === 0) {
    console.log('\nNotice: No versions directory found at specified path.');
    console.log('If you are on Hostinger, ensure the path matches your hbuilds folder:');
    console.log('  /home/u101925264/domains/aruviembroidery.com/hbuilds/versions');
    console.log('You can override the path via: npm run recover-uploads -- --versions-dir=/path/to/versions\n');
  }

  const job = uploadRecoveryService.startRecoveryJob({
    versionsDir,
    dryRun: isDryRun
  });

  // Poll until job completes
  while (true) {
    await new Promise(r => setTimeout(r, 500));
    const status = uploadRecoveryService.getJobStatus(job.id);
    process.stdout.write(`\rProgress: ${status.progress}% (${status.totalFilesFound} scanned) ...`);
    if (status.status === 'completed' || status.status === 'failed') {
      console.log('\n');
      break;
    }
  }

  const finalStatus = uploadRecoveryService.getJobStatus(job.id);

  console.log('====================================================');
  console.log('📊 Recovery Summary:');
  console.log(`   - Total Files Scanned: ${finalStatus.totalFilesFound}`);
  console.log(`   - ${isDryRun ? 'Files To Copy' : 'Files Copied'}:       ${finalStatus.copiedCount}`);
  console.log(`   - Files Skipped (Already in Storage): ${finalStatus.skippedCount}`);
  console.log(`   - Conflicts (Size differences):       ${finalStatus.conflictCount}`);
  console.log(`   - Errors:                             ${finalStatus.errorCount}`);
  console.log('====================================================');

  // Save CSV report
  const csvData = uploadRecoveryService.generateCsv(job.id);
  if (csvData) {
    const csvFileName = `recovery_report_${Date.now()}_${isDryRun ? 'dry_run' : 'applied'}.csv`;
    const csvPath = path.join(process.cwd(), csvFileName);
    fs.writeFileSync(csvPath, csvData, 'utf8');
    console.log(`📄 CSV Audit Report saved: ${csvFileName}`);
  }

  if (isDryRun && finalStatus.copiedCount > 0) {
    console.log('\n💡 To apply and copy these missing files to persistent storage, run:');
    console.log('   npm run recover-uploads -- --apply\n');
  } else if (!isDryRun) {
    console.log('\n✅ Recovery complete! All missing files safely copied to persistent storage.\n');
  }
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(err => {
    console.error('❌ Recovery tool error:', err);
    process.exit(1);
  });
}

module.exports = main;
