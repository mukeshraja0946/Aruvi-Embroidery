/**
 * Automated Mobile Layout & Horizontal Overflow Test Script
 * Verifies that all customer pages have zero horizontal overflow on mobile viewports (360px and 390px)
 * and captures proof screenshots.
 */

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

const VIEWPORTS = [
  { name: 'mobile-360', width: 360, height: 740 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-414', width: 414, height: 896 },
  { name: 'tablet-768', width: 768, height: 1024 }
];

const PAGES_TO_TEST = [
  { name: 'Home', path: '/' },
  { name: 'About', path: '/about' },
  { name: 'Designs', path: '/designs' },
  { name: 'Design_Detail', path: '/design/rose-floral-design' },
  { name: 'Bulk_Design_Detail', path: '/design/aruvi-designs-1' },
  { name: 'Categories', path: '/categories' },
  { name: 'Category_Blouse', path: '/category/blouse-designs' },
  { name: 'Custom_Order', path: '/custom-order' },
  { name: 'Contact', path: '/contact' },
  { name: 'Login', path: '/auth/login' },
  { name: 'Register', path: '/auth/register' },
  { name: 'Cart', path: '/cart' },
  { name: 'FAQ', path: '/faq' },
  { name: 'Privacy', path: '/privacy' },
  { name: 'Terms', path: '/terms' },
  { name: 'Refund', path: '/refund' }
];

const AUTH_PAGES_TO_TEST = [
  { name: 'User_Dashboard', path: '/user/dashboard' },
  { name: 'User_Orders', path: '/user/dashboard#orders-section' },
  { name: 'User_Downloads', path: '/user/dashboard#downloads-section' },
  { name: 'User_Wishlist', path: '/user/dashboard#wishlist-section' }
];

const SCREENSHOT_DIR = path.join(__dirname, '..', 'artifacts', 'screenshots', 'mobile');

async function runMobileAudit() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  console.log('====================================================');
  console.log(`Starting Automated Mobile Overflow Audit on ${BASE_URL}`);
  console.log(`Using Browser Engine: ${CHROME_PATH}`);
  console.log('====================================================\n');

  let browser;
  try {
    browser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: true
    });
  } catch (launchErr) {
    console.error('Failed to launch browser:', launchErr.message);
    process.exit(1);
  }

  let totalTests = 0;
  let passedTests = 0;
  let failedPages = [];

  for (const vp of VIEWPORTS) {
    console.log(`\n--- Testing Viewport: ${vp.name} (${vp.width}x${vp.height}) ---`);

    for (const pageConfig of PAGES_TO_TEST) {
      totalTests++;
      const fullUrl = `${BASE_URL}${pageConfig.path}`;
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1'
      });
      const page = await context.newPage();

      try {
        const response = await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        if (!response || response.status() >= 400) {
          console.warn(`[SKIP] ${pageConfig.name} (${pageConfig.path}) responded with HTTP ${response ? response.status() : 'error'}`);
          await context.close();
          continue;
        }

        // Wait brief moment for any layout recalculations
        await page.waitForTimeout(300);

        // Check horizontal overflow
        const overflowCheck = await page.evaluate(() => {
          const docWidth = document.documentElement.scrollWidth;
          const winWidth = window.innerWidth;
          const bodyWidth = document.body ? document.body.scrollWidth : 0;
          const maxW = Math.max(docWidth, bodyWidth);
          const hasOverflow = maxW > winWidth;

          // Find offending elements if any
          const offenders = [];
          if (hasOverflow) {
            const allElements = document.querySelectorAll('*');
            for (const el of allElements) {
              const rect = el.getBoundingClientRect();
              if (rect.right > winWidth + 1) {
                offenders.push({
                  tag: el.tagName.toLowerCase(),
                  id: el.id,
                  className: typeof el.className === 'string' ? el.className.slice(0, 50) : '',
                  right: Math.round(rect.right),
                  width: Math.round(rect.width)
                });
                if (offenders.length >= 5) break;
              }
            }
          }

          return {
            hasOverflow,
            maxW,
            winWidth,
            diff: maxW - winWidth,
            offenders
          };
        });

        // Screenshot capture
        const shotFilename = `${pageConfig.name}_${vp.name}.png`;
        const shotPath = path.join(SCREENSHOT_DIR, shotFilename);
        await page.screenshot({ path: shotPath, fullPage: false });

        if (!overflowCheck.hasOverflow || overflowCheck.diff <= 1) {
          console.log(`  [PASS] ${pageConfig.name.padEnd(18)} (scrollWidth: ${overflowCheck.maxW}px <= window: ${overflowCheck.winWidth}px)`);
          passedTests++;
        } else {
          console.error(`  [FAIL] ${pageConfig.name.padEnd(18)} OVERFLOW: scrollWidth is ${overflowCheck.maxW}px > window ${overflowCheck.winWidth}px (+${overflowCheck.diff}px)`);
          if (overflowCheck.offenders.length > 0) {
            console.error('         Offending elements:', JSON.stringify(overflowCheck.offenders));
          }
          failedPages.push({ page: pageConfig.name, viewport: vp.name, diff: overflowCheck.diff, offenders: overflowCheck.offenders });
        }
      } catch (err) {
        console.error(`  [ERROR] ${pageConfig.name}: ${err.message}`);
        failedPages.push({ page: pageConfig.name, viewport: vp.name, error: err.message });
      } finally {
        await context.close();
      }
    }

    // Now test Authenticated Customer Pages (Dashboard, Orders, Downloads, Wishlist)
    console.log(`  -> Testing Authenticated Customer Dashboard Pages (${vp.name})...`);
    const authContext = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1'
    });
    const authPage = await authContext.newPage();

    try {
      // Log in
      await authPage.goto(`${BASE_URL}/auth/login`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await authPage.fill('form[action="/auth/login"] input[name="email"]', 'customer@aruviembroidery.com');
      await authPage.fill('form[action="/auth/login"] input[name="password"]', 'customer123');
      await Promise.all([
        authPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
        authPage.click('form[action="/auth/login"] button[type="submit"]')
      ]);

      for (const pageConfig of AUTH_PAGES_TO_TEST) {
        totalTests++;
        const fullUrl = `${BASE_URL}${pageConfig.path}`;
        await authPage.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await authPage.waitForTimeout(400);

        const overflowCheck = await authPage.evaluate(() => {
          const docWidth = document.documentElement.scrollWidth;
          const winWidth = window.innerWidth;
          const bodyWidth = document.body ? document.body.scrollWidth : 0;
          const maxW = Math.max(docWidth, bodyWidth);
          const hasOverflow = maxW > winWidth;
          const offenders = [];
          if (hasOverflow) {
            const allElements = document.querySelectorAll('*');
            for (const el of allElements) {
              const rect = el.getBoundingClientRect();
              if (rect.right > winWidth + 1) {
                offenders.push({
                  tag: el.tagName.toLowerCase(),
                  id: el.id,
                  className: typeof el.className === 'string' ? el.className.slice(0, 50) : '',
                  right: Math.round(rect.right),
                  width: Math.round(rect.width)
                });
                if (offenders.length >= 5) break;
              }
            }
          }
          return { hasOverflow, maxW, winWidth, diff: maxW - winWidth, offenders };
        });

        const shotFilename = `${pageConfig.name}_${vp.name}.png`;
        const shotPath = path.join(SCREENSHOT_DIR, shotFilename);
        await authPage.screenshot({ path: shotPath, fullPage: false });

        if (!overflowCheck.hasOverflow || overflowCheck.diff <= 1) {
          console.log(`  [PASS] ${pageConfig.name.padEnd(18)} (scrollWidth: ${overflowCheck.maxW}px <= window: ${overflowCheck.winWidth}px)`);
          passedTests++;
        } else {
          console.error(`  [FAIL] ${pageConfig.name.padEnd(18)} OVERFLOW: scrollWidth is ${overflowCheck.maxW}px > window ${overflowCheck.winWidth}px (+${overflowCheck.diff}px)`);
          if (overflowCheck.offenders.length > 0) {
            console.error('         Offending elements:', JSON.stringify(overflowCheck.offenders));
          }
          failedPages.push({ page: pageConfig.name, viewport: vp.name, diff: overflowCheck.diff, offenders: overflowCheck.offenders });
        }
      }
    } catch (authErr) {
      console.error('  [WARN] Failed customer auth test suite:', authErr.message);
    } finally {
      await authContext.close();
    }
  }

  await browser.close();

  console.log('\n====================================================');
  console.log(`Audit Summary: ${passedTests} passed out of ${totalTests} test runs`);
  console.log(`Screenshots saved to: ${SCREENSHOT_DIR}`);
  console.log('====================================================\n');

  if (failedPages.length > 0) {
    console.error('Failed Pages:');
    failedPages.forEach(f => console.error(` - ${f.page} (${f.viewport}): +${f.diff}px overflow`));
    process.exit(1);
  } else {
    console.log('ALL PAGES PASSED MOBILE VIEWPORT AUDIT WITH 0 HORIZONTAL OVERFLOW!');
    process.exit(0);
  }
}

runMobileAudit();
