const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const cookieJar = {};
let csrfToken = '';

function getCookieHeader() {
  return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const reqOptions = { ...options };
    reqOptions.headers = { ...reqOptions.headers };
    if (!reqOptions.headers['Cookie'] && Object.keys(cookieJar).length > 0) {
      reqOptions.headers['Cookie'] = getCookieHeader();
    } else if (reqOptions.headers['Cookie']) {
      // Keep existing or ensure merged
    }

    const req = http.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (res.headers['set-cookie']) {
          res.headers['set-cookie'].forEach(c => {
            const parts = c.split(';')[0].split('=');
            if (parts.length >= 2) {
              cookieJar[parts[0].trim()] = parts.slice(1).join('=');
            }
          });
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          buffer,
          text: buffer.toString('utf8'),
          json: () => {
            try { return JSON.parse(buffer.toString('utf8')); }
            catch (e) { return null; }
          }
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- 1. Testing Admin Login & CSRF Token Acquisition ---');
  // First GET /admin/login to get initial CSRF and session
  const loginPageRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/admin/login',
    method: 'GET'
  });
  assert.strictEqual(loginPageRes.statusCode, 200, 'Login page should load');
  
  // Extract CSRF token from page
  const csrfMatch = loginPageRes.text.match(/name="_csrf"\s+value="([^"]+)"/);
  assert(csrfMatch, 'Login page should contain CSRF token');
  csrfToken = csrfMatch[1];
  console.log('Initial CSRF token acquired:', csrfToken.substring(0, 10) + '...');

  // POST /admin/login
  const loginBody = `email=admin%40aruvi.com&password=admin123&_csrf=${encodeURIComponent(csrfToken)}`;
  const loginRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/admin/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(loginBody),
      'Cookie': getCookieHeader(),
      'X-CSRF-Token': csrfToken
    }
  }, loginBody);
  assert(loginRes.statusCode === 302 || loginRes.statusCode === 200, 'Login should succeed');
  console.log('Logged in successfully!');

  // Test GET /admin/api/csrf-token
  console.log('\n--- 2. Testing /admin/api/csrf-token Endpoint ---');
  const csrfApiRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/admin/api/csrf-token',
    method: 'GET',
    headers: { 'Cookie': getCookieHeader() }
  });
  assert.strictEqual(csrfApiRes.statusCode, 200, '/admin/api/csrf-token should return 200');
  const csrfData = csrfApiRes.json();
  assert(csrfData && csrfData.success && csrfData.csrfToken, 'Should return valid csrfToken');
  csrfToken = csrfData.csrfToken;
  console.log('Dynamic CSRF token fetched:', csrfToken.substring(0, 10) + '...');

  // Test Templates Download for ALL Formats
  console.log('\n--- 3. Testing Download Templates for ALL 4 File Formats ---');
  
  // 3A: Excel (.xlsx)
  const excelRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/admin/designs/bulk-details/template/excel',
    method: 'GET',
    headers: { 'Cookie': getCookieHeader() }
  });
  assert.strictEqual(excelRes.statusCode, 200, 'Excel template should return 200');
  assert(excelRes.headers['content-type'].includes('spreadsheetml'), 'Excel content-type should be xlsx');
  assert(excelRes.headers['content-disposition'].includes('aruvi_design_details_template.xlsx'), 'Filename should be xlsx');
  assert(excelRes.buffer.length > 1000, 'Excel buffer size should be > 1KB');
  console.log('✓ Excel template download verified! Size:', excelRes.buffer.length, 'bytes');

  // 3B: Word (.docx)
  const wordRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/admin/designs/bulk-details/template/word',
    method: 'GET',
    headers: { 'Cookie': getCookieHeader() }
  });
  assert.strictEqual(wordRes.statusCode, 200, 'Word template should return 200');
  assert(wordRes.headers['content-type'].includes('wordprocessingml'), 'Word content-type should be docx');
  assert(wordRes.headers['content-disposition'].includes('aruvi_design_details_template.docx'), 'Filename should be docx');
  assert(wordRes.buffer.length > 1000, 'Word buffer size should be > 1KB');
  console.log('✓ Word template download verified! Size:', wordRes.buffer.length, 'bytes');

  // 3C: PDF (.pdf)
  const pdfRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/admin/designs/bulk-details/template/pdf',
    method: 'GET',
    headers: { 'Cookie': getCookieHeader() }
  });
  assert.strictEqual(pdfRes.statusCode, 200, 'PDF template should return 200');
  assert(pdfRes.headers['content-type'].includes('application/pdf'), 'PDF content-type should be pdf');
  assert(pdfRes.headers['content-disposition'].includes('aruvi_design_details_template.pdf'), 'Filename should be pdf');
  assert(pdfRes.buffer.length > 500, 'PDF buffer size should be > 500B');
  console.log('✓ PDF template download verified! Size:', pdfRes.buffer.length, 'bytes');

  // 3D: Plain Text (.txt)
  const txtRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/admin/designs/bulk-details/template/txt',
    method: 'GET',
    headers: { 'Cookie': getCookieHeader() }
  });
  assert.strictEqual(txtRes.statusCode, 200, 'TXT template should return 200');
  assert(txtRes.headers['content-type'].includes('text/plain'), 'TXT content-type should be text/plain');
  assert(txtRes.headers['content-disposition'].includes('aruvi_design_details_template.txt'), 'Filename should be txt');
  assert(txtRes.text.includes('ARUVI EMBROIDERY STUDIO'), 'TXT content should include template header');
  console.log('✓ Plain text template download verified! Size:', txtRes.buffer.length, 'bytes');

  // 3E: Default route fallback
  const defaultRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/admin/designs/bulk-details/template',
    method: 'GET',
    headers: { 'Cookie': getCookieHeader() }
  });
  assert.strictEqual(defaultRes.statusCode, 200, 'Default template route should return 200');
  assert(defaultRes.headers['content-type'].includes('spreadsheetml'), 'Default template should be xlsx');
  console.log('✓ Default /template route fallback verified!');

  // Test Bulk Details Preview with Multipart Upload & CSRF Headers
  console.log('\n--- 4. Testing Bulk Details Preview Upload with CSRF Protection ---');
  
  // Helper to build multipart request
  function createMultipartPayload(boundary, filename, fileBuffer, fields = {}) {
    const parts = [];
    for (const [key, val] of Object.entries(fields)) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`));
    }
    if (filename && fileBuffer) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="details_file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
      parts.push(fileBuffer);
      parts.push(Buffer.from('\r\n'));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return Buffer.concat(parts);
  }

  // 4A: Upload Excel Template
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const multipartBody = createMultipartPayload(boundary, 'template.xlsx', excelRes.buffer, {
    '_csrf': csrfToken,
    'clear_field_option': '0'
  });

  const previewExcelRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: `/admin/designs/bulk-details/preview?_csrf=${encodeURIComponent(csrfToken)}`,
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': multipartBody.length,
      'Cookie': getCookieHeader(),
      'X-CSRF-Token': csrfToken,
      'X-Requested-With': 'XMLHttpRequest'
    }
  }, multipartBody);

  const previewData = previewExcelRes.json();
  console.log('previewExcelRes status:', previewExcelRes.statusCode, 'body:', previewData);
  assert.strictEqual(previewExcelRes.statusCode, 200, 'Excel preview upload should return 200 OK');
  assert(previewData && previewData.success, 'Excel preview response should indicate success: true');
  assert(previewData.preview && (previewData.preview.totalRows >= 2 || previewData.preview.items.length >= 2), 'Preview should parse at least 2 rows from template');
  console.log('✓ Excel template uploaded & parsed successfully! Rows parsed:', (previewData.preview.totalRows || previewData.preview.items.length));

  // 4B: Upload Word Template (.docx)
  const boundaryWord = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const wordBody = createMultipartPayload(boundaryWord, 'template.docx', wordRes.buffer, {
    '_csrf': csrfToken,
    'clear_field_option': '0'
  });
  const previewWordRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: `/admin/designs/bulk-details/preview?_csrf=${encodeURIComponent(csrfToken)}`,
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundaryWord}`,
      'Content-Length': wordBody.length,
      'Cookie': getCookieHeader(),
      'X-CSRF-Token': csrfToken,
      'X-Requested-With': 'XMLHttpRequest'
    }
  }, wordBody);

  assert.strictEqual(previewWordRes.statusCode, 200, 'Word preview upload should return 200 OK');
  const previewWordData = previewWordRes.json();
  assert(previewWordData && previewWordData.success, 'Word preview response should indicate success: true');
  console.log('✓ Word template uploaded & parsed successfully! Rows parsed:', previewWordData.preview.totalRows);

  // 4C: Upload PDF Template (.pdf)
  const boundaryPdf = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const pdfBody = createMultipartPayload(boundaryPdf, 'template.pdf', pdfRes.buffer, {
    '_csrf': csrfToken,
    'clear_field_option': '0'
  });
  const previewPdfRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: `/admin/designs/bulk-details/preview?_csrf=${encodeURIComponent(csrfToken)}`,
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundaryPdf}`,
      'Content-Length': pdfBody.length,
      'Cookie': getCookieHeader(),
      'X-CSRF-Token': csrfToken,
      'X-Requested-With': 'XMLHttpRequest'
    }
  }, pdfBody);

  assert.strictEqual(previewPdfRes.statusCode, 200, 'PDF preview upload should return 200 OK');
  const previewPdfData = previewPdfRes.json();
  assert(previewPdfData && previewPdfData.success, 'PDF preview response should indicate success: true');
  console.log('✓ PDF template uploaded & parsed successfully! Rows parsed:', previewPdfData.preview.totalRows);

  // 4D: Upload Plain Text Template (.txt)
  const boundaryTxt = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const txtBody = createMultipartPayload(boundaryTxt, 'template.txt', txtRes.buffer, {
    '_csrf': csrfToken,
    'clear_field_option': '0'
  });
  const previewTxtRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: `/admin/designs/bulk-details/preview?_csrf=${encodeURIComponent(csrfToken)}`,
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundaryTxt}`,
      'Content-Length': txtBody.length,
      'Cookie': getCookieHeader(),
      'X-CSRF-Token': csrfToken,
      'X-Requested-With': 'XMLHttpRequest'
    }
  }, txtBody);

  assert.strictEqual(previewTxtRes.statusCode, 200, 'TXT preview upload should return 200 OK');
  const previewTxtData = previewTxtRes.json();
  assert(previewTxtData && previewTxtData.success, 'TXT preview response should indicate success: true');
  console.log('✓ TXT template uploaded & parsed successfully! Rows parsed:', previewTxtData.preview.totalRows);

  // 4E: Notes tab with direct notes input
  const boundaryNotes = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const notesBody = createMultipartPayload(boundaryNotes, null, null, {
    '_csrf': csrfToken,
    'clear_field_option': '0',
    'notes': 'Design Code: AED-BLO-01\nFront Stitch Count: 12500\nBack Stitch Count: 8200\nSleeve Stitch Count: 4500\nDescription: Floral blouse'
  });
  const previewNotesRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: `/admin/designs/bulk-details/preview?_csrf=${encodeURIComponent(csrfToken)}`,
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundaryNotes}`,
      'Content-Length': notesBody.length,
      'Cookie': getCookieHeader(),
      'X-CSRF-Token': csrfToken,
      'X-Requested-With': 'XMLHttpRequest'
    }
  }, notesBody);

  assert.strictEqual(previewNotesRes.statusCode, 200, 'Notes preview upload should return 200 OK');
  const previewNotesData = previewNotesRes.json();
  assert(previewNotesData && previewNotesData.success, 'Notes preview should succeed');
  console.log('✓ Notes input parsed successfully! Rows parsed:', previewNotesData.preview.totalRows);

  // 4F: Test that missing CSRF token is properly rejected with 403
  console.log('\n--- 5. Verifying CSRF Security Enforcement ---');
  const badTokenRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/admin/designs/bulk-details/preview',
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': multipartBody.length,
      'Cookie': getCookieHeader(),
      'X-Requested-With': 'XMLHttpRequest'
      // Note: No X-CSRF-Token header or ?_csrf query parameter
    }
  }, multipartBody);
  assert.strictEqual(badTokenRes.statusCode, 403, 'Should reject request with missing token as 403 Forbidden');
  console.log('✓ Missing CSRF token correctly rejected with 403 Forbidden!');

  console.log('\n======================================================');
  console.log('ALL TESTS PASSED WITH 100% SUCCESS!');
  console.log('1. Session / CSRF token validation and auto-refresh: VERIFIED');
  console.log('2. Download templates for Excel (.xlsx): VERIFIED');
  console.log('3. Download templates for Word (.docx): VERIFIED');
  console.log('4. Download templates for PDF (.pdf): VERIFIED');
  console.log('5. Download templates for Plain Text (.txt): VERIFIED');
  console.log('6. End-to-end preview uploading with all formats: VERIFIED');
  console.log('======================================================');
}

runTests().catch(err => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
