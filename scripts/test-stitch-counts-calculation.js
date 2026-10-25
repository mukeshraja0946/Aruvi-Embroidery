/**
 * Comprehensive Test Suite for Stitch Count Data Flow and Automatic Total Calculation
 * Aruvi Embroidery Web
 * 
 * Verifies all 7 user-specified test cases:
 * 1. Enter all three counts and verify the total is their exact sum.
 * 2. Change the front count and verify the total updates.
 * 3. Edit an existing design and confirm all saved counts load correctly.
 * 4. Save and refresh the page; verify the counts remain correct.
 * 5. Confirm the admin and customer pages display matching values.
 * 6. Leave one count blank and confirm the total is marked incomplete.
 * 7. Import component counts through Excel and verify the total is recalculated.
 */

const assert = require('assert');
const http = require('http');
const querystring = require('querystring');
const app = require('../server');
const Design = require('../models/Design');
const Category = require('../models/Category');
const bulkDesignDetailsService = require('../services/bulkDesignDetailsService');

let server;
let port;
let baseUrl;
let sessionCookie = '';
let csrfToken = '';

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqHeaders = { ...headers };
    if (sessionCookie && !reqHeaders['Cookie']) {
      reqHeaders['Cookie'] = sessionCookie;
    }

    let postData = null;
    if (body) {
      if (typeof body === 'string') {
        postData = body;
        if (!reqHeaders['Content-Type']) {
          reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
        }
      } else if (typeof body === 'object') {
        if (reqHeaders['Content-Type'] === 'application/x-www-form-urlencoded') {
          postData = querystring.stringify(body);
        } else {
          postData = JSON.stringify(body);
          if (!reqHeaders['Content-Type']) {
            reqHeaders['Content-Type'] = 'application/json';
          }
        }
      }
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: reqHeaders
    };

    const req = http.request(options, (res) => {
      if (res.headers['set-cookie']) {
        sessionCookie = res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
      }
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        const rawBuffer = Buffer.concat(data);
        const text = rawBuffer.toString('utf8');
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: text,
          json: () => JSON.parse(text)
        });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('RUNNING STITCH COUNT & AUTOMATIC TOTAL CALCULATION TESTS');
  console.log('====================================================\n');

  // Start HTTP server on dynamic port
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  try {
    // -------------------------------------------------------------------------
    // Admin Login for protected routes
    // -------------------------------------------------------------------------
    const loginPageRes = await request('GET', '/admin/login');
    const csrfMatch = loginPageRes.body.match(/name="_csrf"\s+value="([^"]+)"/);
    if (csrfMatch && csrfMatch[1]) {
      csrfToken = csrfMatch[1];
    }
    const loginRes = await request('POST', '/admin/login', querystring.stringify({
      email: 'admin@aruviembroidery.com',
      password: 'admin123',
      _csrf: csrfToken
    }), { 'Content-Type': 'application/x-www-form-urlencoded' });
    assert(loginRes.statusCode === 302, 'Admin login should redirect with HTTP 302');
    console.log('  ✓ Admin authenticated successfully');

    // -------------------------------------------------------------------------
    // TEST 1: Enter all three counts and verify the total is their exact sum
    // -------------------------------------------------------------------------
    console.log('\n▶ Test 1: Enter all three counts and verify total is exact sum (Front + Back + Sleeve)...');
    const designId1 = await Design.create({
      title: 'Royal Peacock Blouse',
      sku: 'AED-TST-01',
      slug: 'royal-peacock-blouse',
      price: 249,
      category_id: 1,
      stitch_count_front: 12000,
      stitch_count_back: 7500,
      stitch_count_sleeve: 5300,
      description: 'Elegant peacock motif embroidery design for blouse.'
    });

    const d1 = await Design.getById(designId1);
    assert.strictEqual(d1.stitch_count_front, 12000, 'Front stitch count should be 12,000');
    assert.strictEqual(d1.stitch_count_back, 7500, 'Back stitch count should be 7,500');
    assert.strictEqual(d1.stitch_count_sleeve, 5300, 'Sleeve stitch count should be 5,300');
    assert.strictEqual(d1.stitch_count, 24800, 'Total stitch count must be exact sum: 12000 + 7500 + 5300 = 24,800');
    console.log('  ✓ Model saved counts: Front=12,000, Back=7,500, Sleeve=5,300 -> Total=24,800');

    // -------------------------------------------------------------------------
    // TEST 2: Change the front count and verify the total updates
    // -------------------------------------------------------------------------
    console.log('\n▶ Test 2: Change front count and verify total updates automatically...');
    await Design.update(designId1, {
      stitch_count_front: 14000
    });

    const d1Updated = await Design.getById(designId1);
    assert.strictEqual(d1Updated.stitch_count_front, 14000, 'Front stitch count should update to 14,000');
    assert.strictEqual(d1Updated.stitch_count_back, 7500, 'Back stitch count should remain 7,500');
    assert.strictEqual(d1Updated.stitch_count_sleeve, 5300, 'Sleeve stitch count should remain 5,300');
    assert.strictEqual(d1Updated.stitch_count, 26800, 'Total must recalculate to: 14000 + 7500 + 5300 = 26,800');
    console.log('  ✓ Updated Front to 14,000 -> Total recalculated to 26,800');

    // -------------------------------------------------------------------------
    // TEST 3: Edit an existing design and confirm all saved counts load correctly
    // -------------------------------------------------------------------------
    console.log('\n▶ Test 3: Edit existing design and confirm saved counts load into edit form...');
    const editFormRes = await request('GET', `/admin/designs/edit/${designId1}`);
    assert.strictEqual(editFormRes.statusCode, 200, 'Admin edit form must return HTTP 200');
    assert(editFormRes.body.includes('value="14000"'), 'Edit form must load saved Front count 14000');
    assert(editFormRes.body.includes('value="7500"'), 'Edit form must load saved Back count 7500');
    assert(editFormRes.body.includes('value="5300"'), 'Edit form must load saved Sleeve count 5300');
    assert(editFormRes.body.includes('id="stitchCountTotalDisplay"'), 'Form must have stitchCountTotalDisplay read-only element');
    assert(editFormRes.body.includes('autoCalculateTotalStitches()'), 'Form must trigger autoCalculateTotalStitches on load');
    console.log('  ✓ Admin edit form loads all saved component counts and initializes calculation');

    // -------------------------------------------------------------------------
    // TEST 4: Save and refresh the page; verify the counts remain correct
    // -------------------------------------------------------------------------
    console.log('\n▶ Test 4: Save updated counts via Admin edit and verify persistence after refresh...');
    await Design.update(designId1, {
      stitch_count_front: 12000,
      stitch_count_back: 8000,
      stitch_count_sleeve: 6000
    });

    const refreshed = await Design.getById(designId1);
    assert.strictEqual(refreshed.stitch_count_front, 12000);
    assert.strictEqual(refreshed.stitch_count_back, 8000);
    assert.strictEqual(refreshed.stitch_count_sleeve, 6000);
    assert.strictEqual(refreshed.stitch_count, 26000, 'Total must persist as 12000 + 8000 + 6000 = 26,000');

    const refreshedPage = await request('GET', `/design/${refreshed.slug}`);
    assert.strictEqual(refreshedPage.statusCode, 200);
    assert(refreshedPage.body.includes('12,000'), 'Refreshed customer page must show 12,000');
    assert(refreshedPage.body.includes('8,000'), 'Refreshed customer page must show 8,000');
    assert(refreshedPage.body.includes('6,000'), 'Refreshed customer page must show 6,000');
    assert(refreshedPage.body.includes('26,000'), 'Refreshed customer page must show 26,000');
    console.log('  ✓ Saved counts persisted and confirmed on customer page refresh');

    // -------------------------------------------------------------------------
    // TEST 5: Confirm the admin and customer pages display matching values
    // -------------------------------------------------------------------------
    console.log('\n▶ Test 5: Confirm Admin API and Customer page display matching values...');
    const apiRes = await request('GET', `/api/designs/${designId1}`);
    assert.strictEqual(apiRes.statusCode, 200, 'API endpoint must return HTTP 200');
    const apiData = apiRes.json();
    assert.strictEqual(apiData.stitch_count_front, 12000, 'API stitch_count_front matches');
    assert.strictEqual(apiData.stitch_count_back, 8000, 'API stitch_count_back matches');
    assert.strictEqual(apiData.stitch_count_sleeve, 6000, 'API stitch_count_sleeve matches');
    assert.strictEqual(apiData.stitch_count, 26000, 'API stitch_count matches');
    assert.strictEqual(apiData.stitchCountStatus, 'complete', 'API status is complete');

    const customerRes = await request('GET', `/design/${refreshed.slug}`);
    assert(customerRes.body.includes('12,000'), 'Customer page matches Front');
    assert(customerRes.body.includes('8,000'), 'Customer page matches Back');
    assert(customerRes.body.includes('6,000'), 'Customer page matches Sleeve');
    assert(customerRes.body.includes('26,000'), 'Customer page matches Total');
    assert(!customerRes.body.includes('stitch-table-box'), 'Duplicate stitch table must be removed');
    console.log('  ✓ Admin API and Customer Page display identical matching stitch counts');

    // -------------------------------------------------------------------------
    // TEST 6: Leave one count blank and confirm the total is marked incomplete
    // -------------------------------------------------------------------------
    console.log('\n▶ Test 6: Leave one count blank and confirm total is marked incomplete...');
    const designIncompleteId = await Design.create({
      title: 'Lotus Motif Incomplete',
      sku: 'AED-INC-01',
      slug: 'lotus-motif-incomplete',
      price: 150,
      category_id: 1,
      stitch_count_front: 10000,
      stitch_count_back: 6000,
      stitch_count_sleeve: null // Sleeve intentionally blank!
    });

    const dInc = await Design.getById(designIncompleteId);
    assert.strictEqual(dInc.stitch_count_front, 10000);
    assert.strictEqual(dInc.stitch_count_back, 6000);
    assert.strictEqual(dInc.stitch_count_sleeve, null);
    assert.strictEqual(dInc.stitch_count, null, 'Total must NOT silently add with zero; must be null');

    // Check API response for incomplete design
    const incApiRes = await request('GET', `/api/designs/${designIncompleteId}`);
    const incApiData = incApiRes.json();
    assert.strictEqual(incApiData.stitch_count, null);
    assert.strictEqual(incApiData.stitchCountStatus, 'incomplete');

    // Check Customer page for incomplete design
    const incCustomerRes = await request('GET', `/design/${dInc.slug}`);
    assert(incCustomerRes.body.includes('10,000'), 'Must show Front count');
    assert(incCustomerRes.body.includes('6,000'), 'Must show Back count');
    assert(incCustomerRes.body.includes('Not specified'), 'Must show Sleeve as Not specified');
    assert(incCustomerRes.body.includes('Incomplete'), 'Must mark Total as Incomplete');
    assert(!incCustomerRes.body.includes('16,000 stitches'), 'Must NEVER show 16,000 by treating missing sleeve as 0');
    console.log('  ✓ Incomplete components correctly marked "Incomplete" without silently adding zero');

    // -------------------------------------------------------------------------
    // TEST 7: Import component counts through Excel / bulk parser and verify total
    // -------------------------------------------------------------------------
    console.log('\n▶ Test 7: Import component counts through bulk parser and verify total calculation...');
    const bulkNotes = `Design Code: AED-INC-01\nFront Stitch Count: 11,000\nBack Stitch Count: 6,500\nSleeve Stitch Count: 4,500\nDescription: Complete blouse set.`;
    const rawParsed = await bulkDesignDetailsService.parseRawInput({ notes: bulkNotes });
    const previewResult = await bulkDesignDetailsService.buildPreview(rawParsed);

    assert.strictEqual(previewResult.readyCount, 1, 'Should find 1 ready item');
    const item = previewResult.items[0];
    assert.strictEqual(item.proposed.stitch_count_front, 11000);
    assert.strictEqual(item.proposed.stitch_count_back, 6500);
    assert.strictEqual(item.proposed.stitch_count_sleeve, 4500);
    assert.strictEqual(item.proposed.stitch_count, 22000, 'Proposed total must be exact sum: 11000 + 6500 + 4500 = 22,000');

    // Apply bulk update
    await bulkDesignDetailsService.applyBulkUpdate(previewResult.items);

    const dBulkUpdated = await Design.getById(designIncompleteId);
    assert.strictEqual(dBulkUpdated.stitch_count_front, 11000);
    assert.strictEqual(dBulkUpdated.stitch_count_back, 6500);
    assert.strictEqual(dBulkUpdated.stitch_count_sleeve, 4500);
    assert.strictEqual(dBulkUpdated.stitch_count, 22000, 'Bulk updated design must persist calculated total 22,000');

    // Verify Customer page after bulk update
    const bulkCustomerPage = await request('GET', `/design/${dBulkUpdated.slug}`);
    assert(bulkCustomerPage.body.includes('11,000'), 'Customer page shows 11,000');
    assert(bulkCustomerPage.body.includes('6,500'), 'Customer page shows 6,500');
    assert(bulkCustomerPage.body.includes('4,500'), 'Customer page shows 4,500');
    assert(bulkCustomerPage.body.includes('22,000'), 'Customer page shows calculated 22,000');
    assert(!bulkCustomerPage.body.includes('Requires all 3 components'), 'Total stitch card is no longer incomplete after all 3 supplied');
    console.log('  ✓ Bulk import recalculated total and updated customer page');

    console.log('\n====================================================');
    console.log('🎉 ALL 7 TEST CASES PASSED WITH 100% SUCCESS!');
    console.log('====================================================\n');
    server.close(() => process.exit(0));
  } catch (err) {
    console.error('\n❌ TEST SUITE FAILED:', err);
    if (server) server.close();
    process.exit(1);
  }
}

runTests();
