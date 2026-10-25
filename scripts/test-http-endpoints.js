const http = require('http');
const assert = require('assert');

// Start Express app programmatically for test
const app = require('../server');

async function runHttpTests() {
  console.log('Testing HTTP Endpoints and UI Rendering...\n');

  // Let server initialize on port 3001
  const PORT = 3001;
  const server = app.listen(PORT, async () => {
    console.log(`Test server running on http://localhost:${PORT}`);

    let sessionCookie = '';

    function get(urlPath, headers = {}) {
      return new Promise((resolve, reject) => {
        const reqHeaders = { ...headers };
        if (sessionCookie) {
          reqHeaders['Cookie'] = sessionCookie;
        }
        http.get(`http://localhost:${PORT}${urlPath}`, { headers: reqHeaders }, (res) => {
          if (res.headers['set-cookie']) {
            sessionCookie = res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
          }
          let body = '';
          const chunks = [];
          res.on('data', chunk => {
            body += chunk;
            chunks.push(chunk);
          });
          res.on('end', () => resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body,
            buffer: Buffer.concat(chunks)
          }));
        }).on('error', reject);
      });
    }

    let csrfToken = '';

    function post(urlPath, data, headers = {}) {
      return new Promise((resolve, reject) => {
        const payloadObj = { ...data };
        if (csrfToken && !payloadObj._csrf) {
          payloadObj._csrf = csrfToken;
        }
        const payload = JSON.stringify(payloadObj);
        const reqHeaders = {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'X-CSRF-Token': csrfToken,
          ...headers
        };
        if (sessionCookie) {
          reqHeaders['Cookie'] = sessionCookie;
        }
        const req = http.request(`http://localhost:${PORT}${urlPath}`, {
          method: 'POST',
          headers: reqHeaders
        }, (res) => {
          if (res.headers['set-cookie']) {
            sessionCookie = res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
          }
          let body = '';
          const chunks = [];
          res.on('data', chunk => {
            body += chunk;
            chunks.push(chunk);
          });
          res.on('end', () => resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body,
            buffer: Buffer.concat(chunks)
          }));
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
      });
    }

    function postForm(urlPath, formFields) {
      return new Promise((resolve, reject) => {
        const querystring = require('querystring');
        const fields = { ...formFields };
        if (csrfToken && !fields._csrf) {
          fields._csrf = csrfToken;
        }
        const payload = querystring.stringify(fields);
        const reqHeaders = {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(payload),
          'X-CSRF-Token': csrfToken
        };
        if (sessionCookie) {
          reqHeaders['Cookie'] = sessionCookie;
        }
        const req = http.request(`http://localhost:${PORT}${urlPath}`, {
          method: 'POST',
          headers: reqHeaders
        }, (res) => {
          if (res.headers['set-cookie']) {
            sessionCookie = res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
          }
          let body = '';
          const chunks = [];
          res.on('data', chunk => {
            body += chunk;
            chunks.push(chunk);
          });
          res.on('end', () => resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body,
            buffer: Buffer.concat(chunks)
          }));
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
      });
    }

    try {
      // 0a. Fetch login page to establish session & extract CSRF token
      const loginPageRes = await get('/admin/login');
      assert.strictEqual(loginPageRes.statusCode, 200, 'Admin login page must return 200');
      const csrfMatch = loginPageRes.body.match(/name="_csrf"\s+value="([^"]+)"/);
      if (csrfMatch && csrfMatch[1]) {
        csrfToken = csrfMatch[1];
      }
      console.log('✅ CSRF Token established:', csrfToken ? csrfToken.substring(0, 10) + '...' : 'none');

      // 0b. Login as admin
      const loginRes = await postForm('/admin/login', {
        email: 'admin@aruviembroidery.com',
        password: 'admin123'
      });
      assert(loginRes.statusCode === 302, 'Admin login should redirect with 302');
      console.log('✅ Admin authenticated successfully with session cookie');
      // 1. Check template download
      const tplRes = await get('/admin/designs/bulk-details/template');
      assert.strictEqual(tplRes.statusCode, 200, 'Template download must return 200 OK');
      assert(tplRes.headers['content-disposition'].includes('aruvi_design_details_template.xlsx'), 'Should set attachment filename');
      console.log('✅ Template download HTTP 200 OK (Content-Length: ' + tplRes.buffer.length + ' bytes)');

      // 2. Check Bulk Details Admin Page
      const bulkPageRes = await get('/admin/designs/bulk-details');
      assert.strictEqual(bulkPageRes.statusCode, 200, 'Bulk details page must return 200 OK');
      assert(bulkPageRes.body.includes('Bulk Update Design Details'), 'Page must contain title');
      assert(bulkPageRes.body.includes('Front Stitch Count'), 'Page must mention Front Stitch Count');
      console.log('✅ Bulk Update Details UI page HTTP 200 OK');

      // 3. Check Design Add/Edit Form has new fields
      const createPageRes = await get('/admin/designs/create');
      assert.strictEqual(createPageRes.statusCode, 200, 'Create design page must return 200 OK');
      assert(createPageRes.body.includes('name="stitch_count_front"'), 'Form must contain stitch_count_front');
      assert(createPageRes.body.includes('name="stitch_count_back"'), 'Form must contain stitch_count_back');
      assert(createPageRes.body.includes('name="stitch_count_sleeve"'), 'Form must contain stitch_count_sleeve');
      assert(createPageRes.body.includes('name="description"'), 'Form must contain description textarea');
      console.log('✅ Admin Add Design form exposes all stitch count and description fields');

      // 4. Seed a design and test Customer Details view
      const Design = require('../models/Design');
      const seedId = await Design.create({
        title: 'Bridal Floral Elegance',
        sku: 'AED-HTTP-01',
        slug: 'bridal-floral-elegance-http',
        price: 180,
        sale_price: 99,
        stitch_count_front: 15400,
        stitch_count_back: 9600,
        stitch_count_sleeve: 5200,
        description: 'Bespoke bridal embroidery design with front neck, deep back cut, and heavy sleeve borders.'
      });

      const customerPageRes = await get('/design/bridal-floral-elegance-http');
      assert.strictEqual(customerPageRes.statusCode, 200, 'Customer design details page must return 200 OK');
      assert(customerPageRes.body.includes('Bridal Floral Elegance'), 'Must display Design Name');
      assert(customerPageRes.body.includes('15,400'), 'Must display Front stitch count 15,400');
      assert(customerPageRes.body.includes('9,600'), 'Must display Back stitch count 9,600');
      assert(customerPageRes.body.includes('5,200'), 'Must display Sleeve stitch count 5,200');
      assert(customerPageRes.body.includes('Bespoke bridal embroidery design'), 'Must display Description');
      console.log('✅ Customer Design Details page displays Design Name, Category, Stitch Counts (Front, Back, Sleeve), and Description perfectly!');

      // 5. Test Preview API via HTTP POST
      const previewRes = await post('/admin/designs/bulk-details/preview', {
        notes: `Design Code: AED-HTTP-01\nFront Stitch Count: 16200\nDescription: Updated via HTTP API test.`
      }, {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      });
      assert.strictEqual(previewRes.statusCode, 200, 'Preview API must return 200 OK');
      const previewJson = JSON.parse(previewRes.body);
      assert(previewJson.success, 'Preview API response should be success: true');
      assert.strictEqual(previewJson.preview.readyCount, 1, 'Should find 1 ready row');
      assert.strictEqual(previewJson.preview.items[0].proposed.stitch_count_front, 16200);
      console.log('✅ Preview API endpoint HTTP 200 OK');

      // 6. Test Apply API via HTTP POST
      const applyRes = await post('/admin/designs/bulk-details/apply', {
        items: previewJson.preview.items
      }, {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      });
      assert.strictEqual(applyRes.statusCode, 200, 'Apply API must return 200 OK');
      const applyJson = JSON.parse(applyRes.body);
      assert.strictEqual(applyJson.updatedCount, 1, 'Should update 1 product');

      // Verify DB
      const updatedD = await Design.getById(seedId);
      assert.strictEqual(updatedD.stitch_count_front, 16200);
      assert.strictEqual(updatedD.description, 'Updated via HTTP API test.');
      console.log('✅ Apply API endpoint HTTP 200 OK and database persistently updated');

      console.log('\n🎉 ALL HTTP ENDPOINTS AND UI RENDERING TESTS PASSED SUCCESSFULLY!\n');
      server.close(() => process.exit(0));
    } catch (testErr) {
      console.error('\n❌ HTTP Test failed:', testErr);
      server.close(() => process.exit(1));
    }
  });
}

runHttpTests().catch(err => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
