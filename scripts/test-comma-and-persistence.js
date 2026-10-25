const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const HOST = '127.0.0.1';

function request(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  const cookies = {};
  const items = Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader];
  items.forEach(c => {
    const parts = c.split(';')[0].split('=');
    if (parts.length >= 2) {
      cookies[parts[0].trim()] = parts.slice(1).join('=').trim();
    }
  });
  return cookies;
}

function serializeCookies(cookieMap) {
  return Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function run() {
  console.log('====================================================');
  console.log('TESTING COMMA INPUTS, PUBLISH PERSISTENCE & SYNC');
  console.log('====================================================');

  const cookieJar = {};

  // 1. Get login page and CSRF token
  const loginGet = await request({
    host: HOST,
    port: PORT,
    path: '/admin/login',
    method: 'GET'
  });
  Object.assign(cookieJar, parseCookies(loginGet.headers['set-cookie']));
  const csrfMatch = loginGet.body.match(/name="_csrf"\s+value="([^"]+)"/);
  const csrfToken = csrfMatch ? csrfMatch[1] : '';

  // 2. Login
  const loginBody = `email=admin%40aruviembroidery.com&password=admin123&_csrf=${encodeURIComponent(csrfToken)}`;
  const loginRes = await request({
    host: HOST,
    port: PORT,
    path: '/admin/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(loginBody),
      'Cookie': serializeCookies(cookieJar)
    }
  }, loginBody);
  Object.assign(cookieJar, parseCookies(loginRes.headers['set-cookie']));
  assert(loginRes.statusCode === 302, 'Admin login should succeed');
  console.log('  ✓ Admin logged in');

  // 3. Create a design with comma-separated stitch counts: Front="2,000", Back="7,500", Sleeve="700"
  const boundary = '---------------------------TestBoundary' + Date.now();
  function buildMultipart(fields) {
    let body = '';
    for (const [key, val] of Object.entries(fields)) {
      if (val !== undefined && val !== null) {
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
        body += `${val}\r\n`;
      }
    }
    body += `--${boundary}--\r\n`;
    return body;
  }

  const createPayload = buildMultipart({
    _csrf: csrfToken,
    title: 'Comma Stitch Count Blouse',
    price: '250',
    sale_price: '99',
    category_id: '6',
    stitch_count_front: '2,000',
    stitch_count_back: '7,500',
    stitch_count_sleeve: '700',
    frontStitchCount: '2,000',
    backStitchCount: '7,500',
    sleeveStitchCount: '700',
    is_ajax: '1'
  });

  const createRes = await request({
    host: HOST,
    port: PORT,
    path: '/admin/designs/create?format=json',
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': Buffer.byteLength(createPayload),
      'Cookie': serializeCookies(cookieJar),
      'Accept': 'application/json',
      'X-CSRF-Token': csrfToken
    }
  }, createPayload);

  assert.strictEqual(createRes.statusCode, 200, 'Design creation with commas should return 200');
  const createData = JSON.parse(createRes.body);
  assert(createData.success, 'Design creation should succeed');
  assert.strictEqual(createData.design.frontStitchCount, 2000, 'Front stitch count parsed correctly');
  assert.strictEqual(createData.design.backStitchCount, 7500, 'Back stitch count parsed correctly');
  assert.strictEqual(createData.design.sleeveStitchCount, 700, 'Sleeve stitch count parsed correctly');
  assert.strictEqual(createData.design.totalStitchCount, 10200, 'Total stitch count 2000+7500+700 = 10,200');
  console.log('  ✓ Created design with Front="2,000", Back="7,500", Sleeve="700" -> Total = 10,200');

  const designId = createData.designId;

  // 4. Verify Admin Edit form displays Front 2,000, Back 7,500, Sleeve 700, Total 10,200
  const editPage = await request({
    host: HOST,
    port: PORT,
    path: `/admin/designs/edit/${designId}`,
    method: 'GET',
    headers: { 'Cookie': serializeCookies(cookieJar) }
  });
  assert.strictEqual(editPage.statusCode, 200);
  assert(editPage.body.includes('2,000'), 'Edit form includes formatted Front: 2,000');
  assert(editPage.body.includes('7,500'), 'Edit form includes formatted Back: 7,500');
  assert(editPage.body.includes('700'), 'Edit form includes Sleeve: 700');
  assert(editPage.body.includes('10,200'), 'Edit form includes Total: 10,200');
  console.log('  ✓ Edit form HTML pre-populates Front=2,000, Back=7,500, Sleeve=700, Total=10,200 stitches');

  // 5. Publish design (is_active = 1)
  const publishPayload = buildMultipart({
    _csrf: csrfToken,
    title: 'Comma Stitch Count Blouse',
    price: '250',
    sale_price: '99',
    category_id: '6',
    stitch_count_front: '2,000',
    stitch_count_back: '7,500',
    stitch_count_sleeve: '700',
    frontStitchCount: '2,000',
    backStitchCount: '7,500',
    sleeveStitchCount: '700',
    is_active: '1',
    is_ajax: '1'
  });

  const publishRes = await request({
    host: HOST,
    port: PORT,
    path: `/admin/designs/edit/${designId}?format=json`,
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': Buffer.byteLength(publishPayload),
      'Cookie': serializeCookies(cookieJar),
      'Accept': 'application/json',
      'X-CSRF-Token': csrfToken
    }
  }, publishPayload);

  assert.strictEqual(publishRes.statusCode, 200);
  const publishData = JSON.parse(publishRes.body);
  assert(publishData.success, 'Publish should succeed');
  assert.strictEqual(publishData.design.is_active, 1, 'Design is active after publishing');
  assert.strictEqual(publishData.design.frontStitchCount, 2000);
  assert.strictEqual(publishData.design.backStitchCount, 7500);
  assert.strictEqual(publishData.design.sleeveStitchCount, 700);
  assert.strictEqual(publishData.design.totalStitchCount, 10200);
  console.log('  ✓ Published design response confirmed with all 4 values and is_active=1');

  // 6. Check Customer Design Details API & HTML page
  const customerApi = await request({
    host: HOST,
    port: PORT,
    path: `/api/designs/${designId}`,
    method: 'GET'
  });
  assert.strictEqual(customerApi.statusCode, 200);
  const customerData = JSON.parse(customerApi.body);
  assert.strictEqual(customerData.frontStitchCount, 2000);
  assert.strictEqual(customerData.backStitchCount, 7500);
  assert.strictEqual(customerData.sleeveStitchCount, 700);
  assert.strictEqual(customerData.totalStitchCount, 10200);
  assert.strictEqual(customerData.stitch_count, 10200);
  console.log('  ✓ Customer API returns Front=2000, Back=7500, Sleeve=700, Total=10200');

  const customerHtml = await request({
    host: HOST,
    port: PORT,
    path: `/designs/${publishData.design.slug}`,
    method: 'GET'
  });
  assert.strictEqual(customerHtml.statusCode, 200);
  assert(customerHtml.body.includes('2,000'), 'Customer HTML includes 2,000 front stitches');
  assert(customerHtml.body.includes('7,500'), 'Customer HTML includes 7,500 back stitches');
  assert(customerHtml.body.includes('700'), 'Customer HTML includes 700 sleeve stitches');
  assert(customerHtml.body.includes('10,200'), 'Customer HTML includes 10,200 total stitches');
  console.log('  ✓ Customer HTML page renders 2,000 / 7,500 / 700 / 10,200');

  // 7. Verify disk persistence: check fallback_designs.json exists and contains the design
  const fallbackStorePath = path.join(__dirname, '..', 'public', 'uploads', 'fallback_designs.json');
  assert(fs.existsSync(fallbackStorePath), 'fallback_designs.json file exists on disk');
  const diskDesigns = JSON.parse(fs.readFileSync(fallbackStorePath, 'utf8'));
  const savedOnDisk = diskDesigns.find(d => d.id == designId);
  assert(savedOnDisk, 'Design persisted to disk in fallback_designs.json');
  assert.strictEqual(savedOnDisk.stitch_count_front, 2000);
  assert.strictEqual(savedOnDisk.stitch_count_back, 7500);
  assert.strictEqual(savedOnDisk.stitch_count_sleeve, 700);
  assert.strictEqual(savedOnDisk.stitch_count, 10200);
  console.log('  ✓ Disk persistence verified: stitch counts permanently stored in fallback_designs.json');

  // 8. Edit only description - stitch counts must NOT be erased
  const editDescPayload = buildMultipart({
    _csrf: csrfToken,
    title: 'Comma Stitch Count Blouse',
    price: '250',
    sale_price: '99',
    category_id: '6',
    description: 'Updated floral embroidery description for bridal blouse.',
    is_active: '1',
    is_ajax: '1'
  });

  const editDescRes = await request({
    host: HOST,
    port: PORT,
    path: `/admin/designs/edit/${designId}?format=json`,
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': Buffer.byteLength(editDescPayload),
      'Cookie': serializeCookies(cookieJar),
      'Accept': 'application/json',
      'X-CSRF-Token': csrfToken
    }
  }, editDescPayload);

  assert.strictEqual(editDescRes.statusCode, 200);
  const editDescData = JSON.parse(editDescRes.body);
  assert(editDescData.success);
  assert.strictEqual(editDescData.design.frontStitchCount, 2000, 'Front preserved after description edit');
  assert.strictEqual(editDescData.design.backStitchCount, 7500, 'Back preserved after description edit');
  assert.strictEqual(editDescData.design.sleeveStitchCount, 700, 'Sleeve preserved after description edit');
  assert.strictEqual(editDescData.design.totalStitchCount, 10200, 'Total preserved after description edit');
  console.log('  ✓ Description-only update preserved all stitch counts intact');

  console.log('====================================================');
  console.log('🎉 ALL COMMA AND PERSISTENCE TESTS PASSED (100%)');
  console.log('====================================================');
}

run().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
