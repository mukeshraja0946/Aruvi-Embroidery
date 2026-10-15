const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const OUT_DIR = path.join(__dirname, '..', 'artifacts', 'mobile_proof');

async function capture() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  // 1. Home
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: path.join(OUT_DIR, 'home_390.png'), fullPage: false });

  // 2. Custom Order
  await page.goto('http://localhost:3000/custom-order', { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: path.join(OUT_DIR, 'custom_order_390.png'), fullPage: false });

  // 3. About
  await page.goto('http://localhost:3000/about', { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: path.join(OUT_DIR, 'about_390.png'), fullPage: false });

  // 4. Contact
  await page.goto('http://localhost:3000/contact', { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: path.join(OUT_DIR, 'contact_390.png'), fullPage: false });

  // 5. Login and view Order Detail
  await page.goto('http://localhost:3000/auth/login', { waitUntil: 'domcontentloaded' });
  await page.fill('form[action="/auth/login"] input[name="email"]', 'admin@aruviembroidery.com');
  await page.fill('form[action="/auth/login"] input[name="password"]', 'admin123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('form[action="/auth/login"] button[type="submit"]')
  ]);

  await page.goto('http://localhost:3000/user/orders/1', { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: path.join(OUT_DIR, 'order_detail_390.png'), fullPage: false });

  await browser.close();
  console.log('Proof screenshots saved to:', OUT_DIR);
}

capture().catch(console.error);
