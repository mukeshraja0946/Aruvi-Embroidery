const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');

async function runTests() {
  console.log('=== STARTING AUTOMATED PREVIEW PNG DOWNLOAD TESTS ===\n');

  // Load app
  const app = require('../server');
  const server = http.createServer(app);

  const db = require('../config/db');
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`Test server listening on port ${port}`);

  // Wait for database connection to be ready
  for (let i = 0; i < 30; i++) {
    if (db.isConnected()) break;
    await new Promise(r => setTimeout(r, 200));
  }
  console.log('Database connection ready.');

  try {
    // 1. Test design detail page HTML rendering
    console.log('\n[TEST 1]: Verifying Design Detail Page HTML & Button Markup...');
    const detailRes = await fetch(`${baseUrl}/design/aed-100`);
    const detailHtml = await detailRes.text();

    assert.strictEqual(detailRes.status, 200, `Expected HTTP 200 for design detail page, got ${detailRes.status}`);
    assert(detailHtml.includes('id="downloadPreviewBtn"'), 'Missing #downloadPreviewBtn element');
    assert(detailHtml.includes('class="download-preview-btn"'), 'Missing .download-preview-btn class');
    assert(detailHtml.includes('fa-download'), 'Missing fa-download icon');
    assert(detailHtml.includes('<span>Download</span>'), 'Missing Download label span');
    assert(detailHtml.includes('downloadPreviewImage(event)'), 'Missing downloadPreviewImage onclick handler');
    assert(detailHtml.includes('tap-zoom-badge'), 'Missing tap-zoom-badge');
    console.log('✓ TEST 1 PASSED: Design Detail page contains Download button and Zoom badge with proper attributes');

    // 2. Test server-side endpoint with JPG input -> Conversion to authentic PNG
    console.log('\n[TEST 2]: Testing JPG to authentic PNG conversion via /api/designs/:id/download-preview-png...');
    // We know design 3225 has JPG preview '/public/uploads/previews/preview-1791824449573-3f54472ba6c2d136.jpg'
    const jpgDownloadRes = await fetch(`${baseUrl}/api/designs/3225/download-preview-png`);
    assert.strictEqual(jpgDownloadRes.status, 200, `Expected HTTP 200, got ${jpgDownloadRes.status}`);

    const contentType = jpgDownloadRes.headers.get('content-type');
    assert.strictEqual(contentType, 'image/png', `Expected Content-Type image/png, got ${contentType}`);

    const disposition = jpgDownloadRes.headers.get('content-disposition');
    assert(disposition && disposition.includes('attachment') && disposition.includes('.png'), `Invalid Content-Disposition: ${disposition}`);
    console.log(`  Content-Disposition header: ${disposition}`);

    const buffer = Buffer.from(await jpgDownloadRes.arrayBuffer());
    assert(buffer.length > 8, 'Downloaded PNG buffer is too small');
    // Check PNG signature: 89 50 4E 47 0D 0A 1A 0A
    const isPngMagic = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
    assert.strictEqual(isPngMagic, true, 'Downloaded file does NOT have authentic PNG magic bytes (0x89 0x50 0x4E 0x47)!');
    console.log(`✓ TEST 2 PASSED: Successfully converted JPG to valid PNG (${buffer.length} bytes) with authentic PNG magic bytes`);

    // 3. Test with explicit imgUrl parameter (e.g. switching thumbnail)
    console.log('\n[TEST 3]: Testing download with explicit imgUrl parameter (thumbnail switching)...');
    const thumbUrl = '/public/uploads/previews/preview-1791824449516-c3e8c8084f82dc41.png';
    const thumbDownloadRes = await fetch(`${baseUrl}/api/designs/3225/download-preview-png?imgUrl=${encodeURIComponent(thumbUrl)}`);
    assert.strictEqual(thumbDownloadRes.status, 200, `Expected HTTP 200, got ${thumbDownloadRes.status}`);
    const thumbBuffer = Buffer.from(await thumbDownloadRes.arrayBuffer());
    const isThumbPngMagic = thumbBuffer[0] === 0x89 && thumbBuffer[1] === 0x50 && thumbBuffer[2] === 0x4E && thumbBuffer[3] === 0x47;
    assert.strictEqual(isThumbPngMagic, true, 'Thumbnail download does not have PNG magic bytes');
    console.log(`✓ TEST 3 PASSED: Custom thumbnail preview download succeeded with authentic PNG (${thumbBuffer.length} bytes)`);

    // 4. Test Security: Attempt to access machine file (ZIP, DST, PES)
    console.log('\n[TEST 4]: Testing Security: Blocking machine embroidery files (.zip, .dst, .pes)...');
    const zipAttempt = await fetch(`${baseUrl}/api/designs/3225/download-preview-png?imgUrl=/storage/designs/machine.zip`);
    assert.strictEqual(zipAttempt.status, 403, `Expected HTTP 403 for .zip attempt, got ${zipAttempt.status}`);
    const zipJson = await zipAttempt.json();
    assert.strictEqual(zipJson.success, false, 'Expected success: false for zip attempt');

    const dstAttempt = await fetch(`${baseUrl}/api/designs/3225/download-preview-png?imgUrl=/storage/designs/machine.dst`);
    assert.strictEqual(dstAttempt.status, 403, `Expected HTTP 403 for .dst attempt, got ${dstAttempt.status}`);

    const pathTraversalAttempt = await fetch(`${baseUrl}/api/designs/3225/download-preview-png?imgUrl=../../.env`);
    assert.strictEqual(pathTraversalAttempt.status, 403, `Expected HTTP 403 for path traversal attempt, got ${pathTraversalAttempt.status}`);
    console.log('✓ TEST 4 PASSED: Security guards properly blocked ZIP, DST, and directory traversal attempts with HTTP 403');

    // 5. Test Non-existent design
    console.log('\n[TEST 5]: Testing Error Handling for non-existent design...');
    const notFoundRes = await fetch(`${baseUrl}/api/designs/999999/download-preview-png`);
    assert.strictEqual(notFoundRes.status, 404, `Expected HTTP 404, got ${notFoundRes.status}`);
    console.log('✓ TEST 5 PASSED: Handled non-existent design gracefully with HTTP 404');

    console.log('\n==================================================');
    console.log('ALL PREVIEW PNG DOWNLOAD TESTS PASSED SUCCESSFULLY!');
    console.log('==================================================\n');
  } finally {
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 1000);
  }
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
