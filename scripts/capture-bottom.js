const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const OUT_DIR = path.join(__dirname, '..', 'artifacts', 'mobile_proof');

async function captureBottom() {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  // 1. Custom order scrolled to bottom (Need help & feature cards)
  await page.goto('http://localhost:3000/custom-order', { waitUntil: 'domcontentloaded' });
  await page.locator('.custom-order-need-help-card').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT_DIR, 'custom_order_bottom_390.png') });

  // 2. About page scrolled to story & stats
  await page.goto('http://localhost:3000/about', { waitUntil: 'domcontentloaded' });
  await page.locator('.about-story-layout').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT_DIR, 'about_story_390.png') });

  // 3. Contact page scrolled to contact info & FAQ
  await page.goto('http://localhost:3000/contact', { waitUntil: 'domcontentloaded' });
  await page.locator('.contact-info-list').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT_DIR, 'contact_info_390.png') });

  // 4. Order detail scrolled to summary & pay now
  await page.goto('http://localhost:3000/auth/login', { waitUntil: 'domcontentloaded' });
  await page.fill('form[action="/auth/login"] input[name="email"]', 'admin@aruviembroidery.com');
  await page.fill('form[action="/auth/login"] input[name="password"]', 'admin123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('form[action="/auth/login"] button[type="submit"]')
  ]);

  await page.goto('http://localhost:3000/user/orders/1', { waitUntil: 'domcontentloaded' });
  await page.locator('.order-summary-box').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT_DIR, 'order_detail_bottom_390.png') });

  await browser.close();
  console.log('Scrolled screenshots saved!');
}

captureBottom().catch(console.error);
