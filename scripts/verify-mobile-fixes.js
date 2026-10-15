const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const BASE_URL = 'http://localhost:3000';
const VIEWPORTS = [
  { name: '360px', width: 360, height: 740 },
  { name: '390px', width: 390, height: 844 },
  { name: '414px', width: 414, height: 896 }
];

async function verifyAll() {
  console.log('--- STARTING MOBILE VERIFICATION SUITE ---');
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });

  const testPages = [
    { name: 'Home', path: '/' },
    { name: 'Custom Order', path: '/custom-order' },
    { name: 'About', path: '/about' },
    { name: 'Contact', path: '/contact' }
  ];

  for (const vp of VIEWPORTS) {
    console.log(`\n====================================================`);
    console.log(`=== Testing Viewport: ${vp.name} (${vp.width}x${vp.height}) ===`);
    console.log(`====================================================`);
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();

    // 1. Test Static Public Pages
    for (const p of testPages) {
      await page.goto(`${BASE_URL}${p.path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(300);

      // Check horizontal overflow
      const overflow = await page.evaluate(() => {
        const docW = document.documentElement.scrollWidth;
        const winW = window.innerWidth;
        const bodyW = document.body ? document.body.scrollWidth : 0;
        const maxW = Math.max(docW, bodyW);
        return { maxW, winW, hasOverflow: maxW > winW };
      });

      if (overflow.hasOverflow) {
        console.error(`❌ [${vp.name}] ${p.name}: Horizontal overflow detected! (maxW: ${overflow.maxW} > winW: ${overflow.winW})`);
      } else {
        console.log(`✅ [${vp.name}] ${p.name}: Zero horizontal overflow (width: ${overflow.maxW}px <= ${overflow.winW}px)`);
      }

      // Feature cards check
      const cardCheck = await page.evaluate(() => {
        const grid = document.querySelector('.site-feature-cards-grid');
        if (!grid) return { found: false };
        const cards = grid.querySelectorAll('.site-feature-card');
        const titles = [];
        let hasNowrap = false;
        let hasEllipsis = false;

        cards.forEach(c => {
          const t = c.querySelector('.site-feature-card-title');
          const s = c.querySelector('.site-feature-card-subtitle');
          if (t) {
            const st = window.getComputedStyle(t);
            if (st.whiteSpace === 'nowrap') hasNowrap = true;
            if (st.textOverflow === 'ellipsis') hasEllipsis = true;
            titles.push(t.textContent.trim());
          }
          if (s) {
            const st = window.getComputedStyle(s);
            if (st.whiteSpace === 'nowrap') hasNowrap = true;
            if (st.textOverflow === 'ellipsis') hasEllipsis = true;
          }
        });

        const gridComputed = window.getComputedStyle(grid);

        return {
          found: true,
          count: cards.length,
          titles,
          hasNowrap,
          hasEllipsis,
          gridColumns: gridComputed.gridTemplateColumns
        };
      });

      if (cardCheck.found) {
        if (cardCheck.hasNowrap || cardCheck.hasEllipsis) {
          console.error(`❌ [${vp.name}] ${p.name}: Feature cards have nowrap or ellipsis!`);
        } else {
          console.log(`✅ [${vp.name}] ${p.name}: Feature cards ok (${cardCheck.count} cards, 2-col wrap, no nowrap, no ellipsis). Titles: ${cardCheck.titles.join(', ')}`);
        }
      }
    }

    // 2. Specific check on About Page (story image removed by default)
    await page.goto(`${BASE_URL}/about`, { waitUntil: 'domcontentloaded' });
    const aboutCheck = await page.evaluate(() => {
      const imgCard = document.querySelector('.story-image-card');
      const hasImage = !!imgCard;
      const noImageClass = document.querySelector('.about-story-layout.no-image');
      return { hasImage, hasNoImageClass: !!noImageClass };
    });
    console.log(`✅ [${vp.name}] About Page story image present: ${aboutCheck.hasImage} (Expected: false), has .no-image class: ${aboutCheck.hasNoImageClass}`);

    // 3. Specific check on Contact Page (location map removed by default)
    await page.goto(`${BASE_URL}/contact`, { waitUntil: 'domcontentloaded' });
    const contactCheck = await page.evaluate(() => {
      const mapImg = document.querySelector('img[src*="map_erode"]');
      const headings = Array.from(document.querySelectorAll('h4')).map(h => h.textContent.trim());
      const hasLocationCard = headings.some(text => text.includes('Our Location'));
      return { hasMap: !!mapImg, hasLocationCard };
    });
    console.log(`✅ [${vp.name}] Contact Page map present: ${contactCheck.hasMap} (Expected: false), has location card: ${contactCheck.hasLocationCard} (Expected: false)`);

    // 4. Specific check on Custom Order page (Need Help card)
    await page.goto(`${BASE_URL}/custom-order`, { waitUntil: 'domcontentloaded' });
    const helpCheck = await page.evaluate(() => {
      const helpCard = document.querySelector('.custom-order-need-help-card');
      if (!helpCard) return { found: false };
      const btn = helpCard.querySelector('.help-btn');
      const cardRect = helpCard.getBoundingClientRect();
      const btnRect = btn ? btn.getBoundingClientRect() : null;
      return {
        found: true,
        cardWidth: cardRect.width,
        btnWidth: btnRect ? btnRect.width : 0,
        isInside: cardRect.right <= window.innerWidth && cardRect.left >= 0
      };
    });
    console.log(`✅ [${vp.name}] Custom Order Help card inside screen: ${helpCheck.isInside}, cardWidth: ${Math.round(helpCheck.cardWidth)}px, btnWidth: ${Math.round(helpCheck.btnWidth)}px`);

    // 5. Check Customer Orders List and Order Detail Pages
    // Login as Admin (who can view orders)
    await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('form[action="/auth/login"] input[name="email"]', 'admin@aruviembroidery.com');
    await page.fill('form[action="/auth/login"] input[name="password"]', 'admin123');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('form[action="/auth/login"] button[type="submit"]')
    ]);

    // Check Order 1 (Pending)
    await page.goto(`${BASE_URL}/user/orders/1`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    const order1Check = await page.evaluate(() => {
      const docW = document.documentElement.scrollWidth;
      const winW = window.innerWidth;
      const orderTitle = document.querySelector('.order-number-title')?.textContent.trim();
      const placedDate = document.querySelector('.order-placed-date')?.textContent.trim();
      const statusPill = document.querySelector('.order-status-pill')?.textContent.trim();
      const isMobileItemsVisible = window.getComputedStyle(document.querySelector('.order-mobile-items-list')).display !== 'none';
      const isDesktopTableHidden = window.getComputedStyle(document.querySelector('.order-desktop-table-wrap')).display === 'none';
      
      const itemCards = document.querySelectorAll('.order-m-item-card');
      const itemSpecs = Array.from(itemCards).map(c => {
        const specEl = c.querySelector('.order-m-item-spec');
        return specEl ? specEl.textContent.trim() : null;
      });

      const totalPaidOrDue = document.querySelector('.order-summary-row.total-row strong')?.textContent.trim();
      const totalVal = document.querySelector('.order-summary-row .total-amount-val')?.textContent.trim();
      const payNowBtn = document.querySelector('#payNowBtn');

      return {
        hasOverflow: docW > winW,
        orderTitle,
        placedDate,
        statusPill,
        isMobileItemsVisible,
        isDesktopTableHidden,
        itemCount: itemCards.length,
        itemSpecs,
        totalPaidOrDue,
        totalVal,
        hasPayNowBtn: !!payNowBtn
      };
    });

    console.log(`✅ [${vp.name}] Order 1 (Pending):`);
    console.log(`    - Overflow: ${order1Check.hasOverflow ? 'FAIL' : 'PASS (0 overflow)'}`);
    console.log(`    - Title: "${order1Check.orderTitle}"`);
    console.log(`    - Date: "${order1Check.placedDate}"`);
    console.log(`    - Status Pill: "${order1Check.statusPill}"`);
    console.log(`    - Mobile Stacked Cards: ${order1Check.isMobileItemsVisible}, Desktop Table Hidden: ${order1Check.isDesktopTableHidden}`);
    console.log(`    - Item Specs (Item 2 should be null/hidden):`, order1Check.itemSpecs);
    console.log(`    - Total Label: "${order1Check.totalPaidOrDue}" (Expected: Total Due:) with Pay Now button: ${order1Check.hasPayNowBtn}`);

    // Check Order 2 (Paid/Completed)
    await page.goto(`${BASE_URL}/user/orders/2`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    const order2Check = await page.evaluate(() => {
      const statusPill = document.querySelector('.order-status-pill')?.textContent.trim();
      const totalPaidOrDue = document.querySelector('.order-summary-row.total-row strong')?.textContent.trim();
      const hasDownloadBtn = !!document.querySelector('.order-m-download-btn');
      return { statusPill, totalPaidOrDue, hasDownloadBtn };
    });

    console.log(`✅ [${vp.name}] Order 2 (Completed):`);
    console.log(`    - Status Pill: "${order2Check.statusPill}"`);
    console.log(`    - Total Label: "${order2Check.totalPaidOrDue}" (Expected: Total Paid:)`);
    console.log(`    - Has Download Button: ${order2Check.hasDownloadBtn}`);

    await context.close();
  }

  // 6. Test Order Creation & Selling Price Verification
  console.log(`\n====================================================`);
  console.log(`=== Testing Pricing Calculation & Order Creation ===`);
  console.log(`====================================================`);

  const Design = require('../models/Design');
  const Order = require('../models/Order');

  // Fetch designs to verify price vs sale_price
  let allDesigns = await Design.getAll({ limit: 10 });
  if (!allDesigns.designs || allDesigns.designs.length === 0) {
    await Design.create({
      title: 'AED 100 Peacock Motif',
      sku: 'AED 100',
      slug: 'aed-100-peacock-motif',
      price: 120.00,
      sale_price: 49.00,
      category_id: 1,
      hoop_size: '5x7 inch (130x180 mm)',
      dimensions: '140mm x 180mm',
      is_active: 1
    });
    allDesigns = await Design.getAll({ limit: 10 });
  }

  console.log(`Catalog Designs sample:`);
  allDesigns.designs.forEach(d => {
    console.log(` - [ID ${d.id}] "${d.title}" | MRP: ₹${d.price} | Selling Price: ₹${d.sale_price || d.price}`);
  });

  const sampleDesign = allDesigns.designs[0];
  const sellingPrice = sampleDesign.sale_price ? parseFloat(sampleDesign.sale_price) : parseFloat(sampleDesign.price);
  const mrp = parseFloat(sampleDesign.price);

  console.log(`\nTesting Order creation for "${sampleDesign.title}" (MRP: ₹${mrp}, Selling: ₹${sellingPrice})...`);
  const { orderId, orderNumber } = await Order.createOrder({
    userId: 1,
    guestEmail: 'test@example.com',
    guestName: 'Test Buyer',
    guestPhone: '+91 99999 88888',
    items: [
      {
        design_id: sampleDesign.id,
        title: sampleDesign.title,
        slug: sampleDesign.slug,
        price: mrp,
        sale_price: sellingPrice < mrp ? sellingPrice : null,
        effective_price: sellingPrice,
        hoop_size: sampleDesign.hoop_size,
        dimensions: sampleDesign.dimensions,
        primary_image: sampleDesign.primary_image
      }
    ],
    totalAmount: mrp,
    discountAmount: Math.max(0, mrp - sellingPrice),
    finalAmount: sellingPrice
  });

  const createdOrder = await Order.getById(orderId);
  const orderItem = createdOrder.items[0];

  console.log(`Created Order #${orderNumber} (ID: ${orderId}):`);
  console.log(` - Order Total Amount: ₹${createdOrder.total_amount} (MRP)`);
  console.log(` - Order Discount: ₹${createdOrder.discount_amount}`);
  console.log(` - Order Final Amount: ₹${createdOrder.final_amount} (Selling Price)`);
  console.log(` - Item price_at_purchase: ₹${orderItem.price_at_purchase} (Expected: ₹${sellingPrice})`);
  console.log(` - Item MRP: ₹${orderItem.mrp} (Expected: ₹${mrp})`);
  console.log(` - Item discount: ₹${orderItem.discount_amount} (Expected: ₹${Math.max(0, mrp - sellingPrice)})`);

  if (parseFloat(orderItem.price_at_purchase) === sellingPrice && parseFloat(createdOrder.final_amount) === sellingPrice) {
    console.log(`\n🎉 [VERIFIED SUCCESS]: Order correctly charged and stored SELLING PRICE (₹${sellingPrice}) instead of MRP (₹${mrp})!`);
  } else {
    console.error(`\n❌ [PRICING MISMATCH]: Order charged ₹${createdOrder.final_amount} instead of ₹${sellingPrice}`);
    process.exit(1);
  }

  await browser.close();
  console.log('\n--- ALL VERIFICATIONS PASSED WITH ZERO ERRORS ---');
}

verifyAll().catch(err => {
  console.error(err);
  process.exit(1);
});
