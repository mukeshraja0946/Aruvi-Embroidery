/**
 * Test Suite: Stitch Counts Persistence & Synchronization Verification
 * 
 * Specifically tests the 9 requirements from Section 7:
 * Test design with Front = 2,000, Back = 7,500, Sleeve = 700 -> Total = 10,200
 * 
 * 1. Admin form shows the three entered values and total 10,200.
 * 2. Saving as Draft preserves the counts.
 * 3. Publishing preserves the counts.
 * 4. Reopening Edit Design displays the saved counts.
 * 5. Refreshing the admin page does not lose them.
 * 6. Customer Design Details page shows the same four values.
 * 7. Editing only the description or price does not erase the counts.
 * 8. Other products retain their own existing stitch counts.
 * 9. Invalid or missing values are handled safely.
 */

const assert = require('assert');
const http = require('http');
const querystring = require('querystring');
const app = require('../server');
const Design = require('../models/Design');
const Category = require('../models/Category');

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
    if (csrfToken && !reqHeaders['X-CSRF-Token']) {
      reqHeaders['X-CSRF-Token'] = csrfToken;
    }

    let postData = null;
    if (body) {
      let bodyObj = body;
      if (typeof body === 'object' && csrfToken && !body._csrf) {
        bodyObj = { ...body, _csrf: csrfToken };
      }
      if (typeof bodyObj === 'string') {
        postData = bodyObj;
        if (!reqHeaders['Content-Type']) {
          reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
        }
      } else if (typeof bodyObj === 'object') {
        if (reqHeaders['Content-Type'] === 'application/x-www-form-urlencoded') {
          postData = querystring.stringify(bodyObj);
        } else {
          postData = JSON.stringify(bodyObj);
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
  console.log('RUNNING STITCH COUNTS PERSISTENCE & SYNC TEST SUITE');
  console.log('====================================================\n');

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 0. Extract CSRF token and Authenticate as Admin
    const loginPageRes = await request('GET', '/admin/login');
    const csrfMatch = loginPageRes.body.match(/name="_csrf"\s+value="([^"]+)"/);
    if (csrfMatch && csrfMatch[1]) {
      csrfToken = csrfMatch[1];
    }

    const loginRes = await request('POST', '/admin/login', {
      email: 'admin@aruviembroidery.com',
      password: 'admin123',
      _csrf: csrfToken
    }, { 'Content-Type': 'application/x-www-form-urlencoded' });
    assert.strictEqual(loginRes.statusCode, 302, 'Admin login should redirect on success');
    console.log('  ✓ Admin authenticated successfully\n');

    const cat = await Category.create({ name: 'Bridal Blouses', slug: 'bridal-blouses' });
    const categoryId = cat.id || 1;

    // Baseline: Other product to test isolation (Requirement 8)
    const otherDesignId = await Design.create({
      title: 'Control Design Isolated',
      sku: 'AED-ISO-99',
      price: 399,
      stitch_count_front: 5000,
      stitch_count_back: 6000,
      stitch_count_sleeve: 1000,
      stitch_count: 12000,
      is_active: 1
    });

    // ---------------------------------------------------------------
    // 1 & 2: Saving as Draft preserves Front=2000, Back=7500, Sleeve=700 -> Total=10,200
    // ---------------------------------------------------------------
    console.log('▶ Test 1 & 2: Saving as Draft preserves Front=2,000, Back=7,500, Sleeve=700 -> Total=10,200...');
    const draftPayload = {
      title: 'Test Stitch Sync Blouse',
      sku: 'AED-TST-01',
      price: '499',
      category_id: String(categoryId),
      stitch_count_front: '2000',
      stitch_count_back: '7500',
      stitch_count_sleeve: '700',
      status_draft: '1',
      is_ajax: '1'
    };

    const draftRes = await request('POST', '/admin/designs/create?format=json', draftPayload, {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    });

    assert.strictEqual(draftRes.statusCode, 200, 'Draft save should return 200');
    const draftData = draftRes.json();
    assert.strictEqual(draftData.success, true);
    assert.ok(draftData.designId, 'Should return saved designId');
    const testDesignId = draftData.designId;

    // Check saved draft design
    const draftDesign = await Design.getById(testDesignId);
    assert.strictEqual(draftDesign.stitch_count_front, 2000, 'Draft front count should be 2000');
    assert.strictEqual(draftDesign.stitch_count_back, 7500, 'Draft back count should be 7500');
    assert.strictEqual(draftDesign.stitch_count_sleeve, 700, 'Draft sleeve count should be 700');
    assert.strictEqual(draftDesign.stitch_count, 10200, 'Draft total should be calculated to 10200');
    assert.strictEqual(draftDesign.totalStitchCount, 10200, 'totalStitchCount should be 10200');
    assert.strictEqual(draftDesign.frontStitchCount, 2000, 'frontStitchCount should be 2000');
    assert.strictEqual(draftDesign.backStitchCount, 7500, 'backStitchCount should be 7500');
    assert.strictEqual(draftDesign.sleeveStitchCount, 700, 'sleeveStitchCount should be 700');
    assert.strictEqual(draftDesign.is_active, 0, 'Draft should be inactive (status_draft)');
    console.log('  ✓ Draft saved with Front=2,000, Back=7,500, Sleeve=700 and calculated Total=10,200\n');

    // ---------------------------------------------------------------
    // 3: Publishing preserves the counts
    // ---------------------------------------------------------------
    console.log('▶ Test 3: Publishing preserves the counts...');
    const publishPayload = {
      title: 'Test Stitch Sync Blouse',
      sku: 'AED-TST-01',
      price: '499',
      category_id: String(categoryId),
      stitch_count_front: '2000',
      stitch_count_back: '7500',
      stitch_count_sleeve: '700',
      is_active: '1',
      is_ajax: '1'
    };

    const publishRes = await request('POST', `/admin/designs/edit/${testDesignId}?format=json`, publishPayload, {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    });

    assert.strictEqual(publishRes.statusCode, 200, 'Publishing should return 200');
    const publishData = publishRes.json();
    assert.strictEqual(publishData.success, true);
    assert.strictEqual(publishData.design.frontStitchCount, 2000);
    assert.strictEqual(publishData.design.backStitchCount, 7500);
    assert.strictEqual(publishData.design.sleeveStitchCount, 700);
    assert.strictEqual(publishData.design.totalStitchCount, 10200);
    assert.strictEqual(publishData.design.is_active, 1);
    console.log('  ✓ Published design response confirmed with all 4 stitch count values and is_active=1\n');

    // ---------------------------------------------------------------
    // 4 & 5: Reopening and refreshing Admin Edit Design displays saved counts
    // ---------------------------------------------------------------
    console.log('▶ Test 4 & 5: Reopening Edit Design and refreshing admin page...');
    const editPageRes = await request('GET', `/admin/designs/edit/${testDesignId}`);
    assert.strictEqual(editPageRes.statusCode, 200);
    assert.ok(editPageRes.body.includes('value="2000"'), 'Edit page should pre-populate front count 2000');
    assert.ok(editPageRes.body.includes('value="7500"'), 'Edit page should pre-populate back count 7500');
    assert.ok(editPageRes.body.includes('value="700"'), 'Edit page should pre-populate sleeve count 700');
    assert.ok(editPageRes.body.includes('10,200 stitches'), 'Edit page should pre-populate total 10,200 stitches');
    assert.ok(editPageRes.body.includes('Persisted Total: 10,200 stitches'), 'Edit page should show Persisted Total status');
    console.log('  ✓ Admin Edit form reliably pre-populates Front=2,000, Back=7,500, Sleeve=700, Total=10,200\n');

    // ---------------------------------------------------------------
    // 6: Customer Design Details page shows the same four values
    // ---------------------------------------------------------------
    console.log('▶ Test 6: Customer Design Details page shows the same four values...');
    const pubDesign = await Design.getById(testDesignId);
    const customerPageRes = await request('GET', `/designs/${pubDesign.slug}`);
    assert.strictEqual(customerPageRes.statusCode, 200);

    // Front: 2,000 stitches
    assert.ok(customerPageRes.body.includes('2,000'), 'Customer page should show Front 2,000 stitches');
    // Back: 7,500 stitches
    assert.ok(customerPageRes.body.includes('7,500'), 'Customer page should show Back 7,500 stitches');
    // Sleeve: 700 stitches
    assert.ok(customerPageRes.body.includes('700'), 'Customer page should show Sleeve 700 stitches');
    // Total: 10,200 stitches
    assert.ok(customerPageRes.body.includes('10,200'), 'Customer page should show Total 10,200 stitches');

    // Also verify Customer API endpoint (/api/designs/:id)
    const customerApiRes = await request('GET', `/api/designs/${testDesignId}`);
    assert.strictEqual(customerApiRes.statusCode, 200);
    const apiData = customerApiRes.json();
    assert.strictEqual(apiData.frontStitchCount, 2000);
    assert.strictEqual(apiData.backStitchCount, 7500);
    assert.strictEqual(apiData.sleeveStitchCount, 700);
    assert.strictEqual(apiData.totalStitchCount, 10200);
    assert.strictEqual(apiData.stitch_count, 10200);
    assert.strictEqual(apiData.stitchCountStatus, 'complete');
    console.log('  ✓ Customer page and Customer API return identical values: Front=2,000, Back=7,500, Sleeve=700, Total=10,200\n');

    // ---------------------------------------------------------------
    // 7: Editing only description or price does not erase counts
    // ---------------------------------------------------------------
    console.log('▶ Test 7: Editing only the description or price does not erase counts...');
    // Simulate updating price and description without providing stitch count fields
    const partialUpdatePayload = {
      title: 'Test Stitch Sync Blouse',
      sku: 'AED-TST-01',
      price: '599',
      sale_price: '499',
      category_id: String(categoryId),
      description: 'Updated floral embroidery design description for testing isolation.',
      is_active: '1',
      is_ajax: '1'
    };

    const partialUpdateRes = await request('POST', `/admin/designs/edit/${testDesignId}?format=json`, partialUpdatePayload, {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    });

    assert.strictEqual(partialUpdateRes.statusCode, 200);
    const refetched = await Design.getById(testDesignId);
    assert.strictEqual(refetched.price, 599, 'Price should be updated to 599');
    assert.strictEqual(refetched.description, 'Updated floral embroidery design description for testing isolation.');
    assert.strictEqual(refetched.stitch_count_front, 2000, 'Front count must remain 2000');
    assert.strictEqual(refetched.stitch_count_back, 7500, 'Back count must remain 7500');
    assert.strictEqual(refetched.stitch_count_sleeve, 700, 'Sleeve count must remain 700');
    assert.strictEqual(refetched.stitch_count, 10200, 'Total count must remain 10200');
    console.log('  ✓ Editing only description and price preserved all four stitch counts intact\n');

    // ---------------------------------------------------------------
    // 8: Other products retain their own existing stitch counts
    // ---------------------------------------------------------------
    console.log('▶ Test 8: Other products retain their own existing stitch counts...');
    const controlDesign = await Design.getById(otherDesignId);
    assert.strictEqual(controlDesign.stitch_count_front, 5000);
    assert.strictEqual(controlDesign.stitch_count_back, 6000);
    assert.strictEqual(controlDesign.stitch_count_sleeve, 1000);
    assert.strictEqual(controlDesign.stitch_count, 12000);
    console.log('  ✓ Control design counts remained untouched: 5,000 + 6,000 + 1,000 = 12,000\n');

    // ---------------------------------------------------------------
    // 9: Invalid or missing values are handled safely
    // ---------------------------------------------------------------
    console.log('▶ Test 9: Invalid or missing values handled safely...');
    // Negative number rejection
    const invalidNegativeRes = await request('POST', `/admin/designs/edit/${testDesignId}?format=json`, {
      title: 'Test Stitch Sync Blouse',
      sku: 'AED-TST-01',
      price: '599',
      category_id: String(categoryId),
      stitch_count_front: '-500',
      is_ajax: '1'
    }, {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    });
    assert.strictEqual(invalidNegativeRes.statusCode, 400, 'Negative stitch count should return 400 error');
    assert.ok(invalidNegativeRes.json().message.includes('non-negative whole number'));

    // Non-numeric string rejection
    const invalidAlphaRes = await request('POST', `/admin/designs/edit/${testDesignId}?format=json`, {
      title: 'Test Stitch Sync Blouse',
      sku: 'AED-TST-01',
      price: '599',
      category_id: String(categoryId),
      stitch_count_front: 'abc',
      is_ajax: '1'
    }, {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    });
    assert.strictEqual(invalidAlphaRes.statusCode, 400, 'Alphabetic stitch count should return 400 error');

    // Incomplete component handling: Front=2000, Back=7500, Sleeve="" (missing) -> Total is null (Incomplete)
    const incompleteRes = await request('POST', `/admin/designs/edit/${testDesignId}?format=json`, {
      title: 'Test Stitch Sync Blouse',
      sku: 'AED-TST-01',
      price: '599',
      category_id: String(categoryId),
      stitch_count_front: '2000',
      stitch_count_back: '7500',
      stitch_count_sleeve: '',
      is_ajax: '1'
    }, {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    });
    assert.strictEqual(incompleteRes.statusCode, 200);
    const incompleteDesign = await Design.getById(testDesignId);
    assert.strictEqual(incompleteDesign.stitch_count_front, 2000);
    assert.strictEqual(incompleteDesign.stitch_count_back, 7500);
    assert.strictEqual(incompleteDesign.stitch_count_sleeve, null);
    assert.strictEqual(incompleteDesign.stitch_count, null, 'Incomplete components must yield null total');

    // Customer page shows Incomplete badge without crashing
    const incCustomerRes = await request('GET', `/designs/${incompleteDesign.slug}`);
    assert.strictEqual(incCustomerRes.statusCode, 200);
    assert.ok(incCustomerRes.body.includes('Incomplete'), 'Customer page should show Incomplete status');
    assert.ok(incCustomerRes.body.includes('Requires all 3 components'), 'Customer page should indicate required components');

    console.log('  ✓ Negative, alphabetic, and incomplete stitch counts safely validated\n');

    console.log('====================================================');
    console.log('🎉 ALL 9 VERIFICATION REQUIREMENTS PASSED WITH 100% SUCCESS!');
    console.log('====================================================');
  } finally {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
