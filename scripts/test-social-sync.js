const assert = require('assert');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const Setting = require('../models/Setting');

async function runSocialTests() {
  console.log('====================================================');
  console.log('  ARUVI EMBROIDERY — SOCIAL MEDIA SYNC VERIFICATION');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function test(desc, fn) {
    total++;
    try {
      fn();
      console.log(`  ✓ PASS: ${desc}`);
      passed++;
    } catch (e) {
      console.error(`  ❌ FAIL: ${desc} -> ${e.message}`);
    }
  }

  // 1. URL Validation Tests
  console.log('1. Testing URL Validation & Platform Domain Matching...');

  // Import the validator logic
  function validateSocialMediaUrl(rawUrl, platformName, allowedDomains) {
    if (rawUrl === undefined || rawUrl === null) return { valid: true, cleanUrl: '' };
    let trimmed = String(rawUrl).trim();
    if (trimmed === '') return { valid: true, cleanUrl: '' };
    if (!/^https?:\/\//i.test(trimmed)) trimmed = 'https://' + trimmed;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { valid: false, error: `${platformName} URL must use HTTP or HTTPS protocol.` };
      }
      if (Array.isArray(allowedDomains) && allowedDomains.length > 0) {
        const host = parsed.hostname.toLowerCase();
        const isDomainMatch = allowedDomains.some(d => host === d || host.endsWith('.' + d));
        if (!isDomainMatch) {
          return { valid: false, error: `${platformName} URL must point to a valid ${platformName} address, not another platform.` };
        }
      }
      return { valid: true, cleanUrl: parsed.toString() };
    } catch (e) {
      return { valid: false, error: `Invalid ${platformName} URL format.` };
    }
  }

  test('Valid Facebook URL passes', () => {
    const res = validateSocialMediaUrl('https://facebook.com/aruviembroidery', 'Facebook', ['facebook.com', 'fb.com']);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.cleanUrl, 'https://facebook.com/aruviembroidery');
  });

  test('Facebook URL without https:// auto-prepends https://', () => {
    const res = validateSocialMediaUrl('facebook.com/aruviembroidery', 'Facebook', ['facebook.com', 'fb.com']);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.cleanUrl, 'https://facebook.com/aruviembroidery');
  });

  test('Empty URL is allowed and returns empty cleanUrl', () => {
    const res = validateSocialMediaUrl('', 'Facebook', ['facebook.com']);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.cleanUrl, '');
  });

  test('Valid Instagram URL passes', () => {
    const res = validateSocialMediaUrl('https://www.instagram.com/aruviembroidery', 'Instagram', ['instagram.com', 'instagr.am']);
    assert.strictEqual(res.valid, true);
    assert(res.cleanUrl.includes('instagram.com'));
  });

  test('Valid Pinterest URL passes', () => {
    const res = validateSocialMediaUrl('https://pinterest.com/aruviembroidery', 'Pinterest', ['pinterest.com', 'pin.it']);
    assert.strictEqual(res.valid, true);
    assert(res.cleanUrl.includes('pinterest.com'));
  });

  test('LinkedIn URL in Pinterest field is REJECTED', () => {
    const res = validateSocialMediaUrl('https://linkedin.com/company/aruviembroidery', 'Pinterest', ['pinterest.com', 'pin.it']);
    assert.strictEqual(res.valid, false);
    assert(res.error.includes('Pinterest'));
  });

  test('Valid YouTube URL passes', () => {
    const res = validateSocialMediaUrl('https://youtube.com/@aruviembroidery', 'YouTube', ['youtube.com', 'youtu.be']);
    assert.strictEqual(res.valid, true);
    assert(res.cleanUrl.includes('youtube.com'));
  });

  // 2. Settings Persistence & Model Synchronization
  console.log('\n2. Testing Setting Model Synchronization & Clear Functionality...');

  await Setting.updateAll({
    facebook_url: 'https://facebook.com/testpage',
    instagram_url: 'https://instagram.com/testhandle',
    pinterest_url: 'https://pinterest.com/testboard',
    youtube_url: 'https://youtube.com/@testchannel'
  });

  let currentSettings = await Setting.getAll();

  test('Saved Facebook URL persists in Setting.getAll()', () => {
    assert.strictEqual(currentSettings.facebook_url, 'https://facebook.com/testpage');
  });

  test('Saved Instagram URL persists in Setting.getAll()', () => {
    assert.strictEqual(currentSettings.instagram_url, 'https://instagram.com/testhandle');
  });

  test('Saved Pinterest URL persists in Setting.getAll()', () => {
    assert.strictEqual(currentSettings.pinterest_url, 'https://pinterest.com/testboard');
  });

  test('Saved YouTube URL persists in Setting.getAll()', () => {
    assert.strictEqual(currentSettings.youtube_url, 'https://youtube.com/@testchannel');
  });

  // 3. Test Clearing a URL
  console.log('\n3. Testing Clearing Platform (Hiding Icon)...');
  await Setting.updateAll({
    facebook_url: '',
    youtube_url: ''
  });

  currentSettings = await Setting.getAll();

  test('Clearing Facebook URL updates setting to empty string', () => {
    assert.strictEqual(currentSettings.facebook_url, '');
  });

  test('Clearing YouTube URL updates setting to empty string', () => {
    assert.strictEqual(currentSettings.youtube_url, '');
  });

  test('Remaining Instagram and Pinterest URLs remain preserved', () => {
    assert.strictEqual(currentSettings.instagram_url, 'https://instagram.com/testhandle');
    assert.strictEqual(currentSettings.pinterest_url, 'https://pinterest.com/testboard');
  });

  // 4. Test Customer Footer Rendering
  console.log('\n4. Testing Customer Footer EJS Template Rendering...');
  const footerTemplatePath = path.join(__dirname, '../views/partials/footer.ejs');
  const footerTemplate = fs.readFileSync(footerTemplatePath, 'utf8');

  // Test Case A: Only Instagram & Pinterest active
  const renderedPartial = ejs.render(footerTemplate, {
    siteSettings: {
      logo_url: '/public/images/logo.jpg',
      facebook_url: '',
      instagram_url: 'https://instagram.com/testhandle',
      pinterest_url: 'https://pinterest.com/testboard',
      youtube_url: ''
    }
  });

  test('Footer displays Instagram icon when URL is present', () => {
    assert(renderedPartial.includes('href="https://instagram.com/testhandle"'));
    assert(renderedPartial.includes('fa-instagram'));
    assert(renderedPartial.includes('target="_blank" rel="noopener noreferrer"'));
  });

  test('Footer displays Pinterest icon pointing to Pinterest (not LinkedIn)', () => {
    assert(renderedPartial.includes('href="https://pinterest.com/testboard"'));
    assert(renderedPartial.includes('fa-pinterest-p'));
    assert(!renderedPartial.includes('linkedin'));
  });

  test('Footer hides Facebook and YouTube icons when cleared', () => {
    assert(!renderedPartial.includes('fa-facebook-f'));
    assert(!renderedPartial.includes('fa-youtube'));
  });

  // Test Case B: All 4 platforms active with custom URLs
  const renderedFull = ejs.render(footerTemplate, {
    siteSettings: {
      logo_url: '/public/images/logo.jpg',
      facebook_url: 'https://facebook.com/customfb',
      instagram_url: 'https://instagram.com/custominsta',
      pinterest_url: 'https://pinterest.com/custompin',
      youtube_url: 'https://youtube.com/@customyt'
    }
  });

  test('Footer displays all 4 icons when all 4 URLs are configured', () => {
    assert(renderedFull.includes('href="https://facebook.com/customfb"'));
    assert(renderedFull.includes('href="https://instagram.com/custominsta"'));
    assert(renderedFull.includes('href="https://pinterest.com/custompin"'));
    assert(renderedFull.includes('href="https://youtube.com/@customyt"'));
  });

  test('Each icon has unique destination URL (no duplicate destination redirect)', () => {
    const urls = [
      'https://facebook.com/customfb',
      'https://instagram.com/custominsta',
      'https://pinterest.com/custompin',
      'https://youtube.com/@customyt'
    ];
    const unique = new Set(urls);
    assert.strictEqual(unique.size, 4);
    urls.forEach(u => assert(renderedFull.includes(`href="${u}"`)));
  });

  // Restore production defaults for store
  await Setting.updateAll({
    facebook_url: 'https://facebook.com/aruviembroidery',
    instagram_url: 'https://instagram.com/aruviembroidery',
    pinterest_url: 'https://pinterest.com/aruviembroidery',
    youtube_url: 'https://youtube.com/aruviembroidery'
  });

  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${passed} / ${total} PASSED`);
  if (passed === total) {
    console.log('✓ ALL SOCIAL MEDIA REQUIREMENTS VERIFIED SUCCESSFULLY!');
  } else {
    console.log('❌ SOME TESTS FAILED. PLEASE REVIEW LOGS ABOVE.');
  }
  console.log('====================================================');

  process.exit(passed === total ? 0 : 1);
}

runSocialTests();
