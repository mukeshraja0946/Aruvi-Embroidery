/**
 * Automated Verification Script for Mobile UI Fixes
 * Tests viewports: 360px, 390px, 414px
 * Captures screenshots and verifies layout metrics
 */

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const OUTPUT_DIR = path.join(__dirname, '..', 'artifacts', 'screenshots', 'verify_mobile');

const VIEWPORTS = [
  { name: '360px', width: 360, height: 740 },
  { name: '390px', width: 390, height: 844 },
  { name: '414px', width: 414, height: 896 }
];

async function run() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('====================================================');
  console.log(`Starting Mobile UI Verification on ${BASE_URL}`);
  console.log(`Using Chrome: ${CHROME_PATH}`);
  console.log(`Output Directory: ${OUTPUT_DIR}`);
  console.log('====================================================\n');

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const report = {
    viewports: {},
    summary: {
      sortDropdown: [],
      productCard: [],
      rightSpace: [],
      header: [],
      detailPage: []
    }
  };

  try {
    for (const vp of VIEWPORTS) {
      console.log(`\n----------------- Testing Viewport: ${vp.name} (${vp.width}x${vp.height}) -----------------`);
      report.viewports[vp.name] = {};

      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1'
      });
      const page = await context.newPage();

      // 1. HOME PAGE
      await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);

      // Verify Header & Feature strip on Home
      const homeHeaderMetrics = await page.evaluate(() => {
        const header = document.querySelector('.site-header');
        const hamburger = document.querySelector('.mobile-menu-toggle');
        const logo = document.querySelector('.brand-logo');
        const iconBtns = Array.from(document.querySelectorAll('.header-icon-btn'));
        const badges = Array.from(document.querySelectorAll('.header-icon-btn .cart-badge'));
        const featurePills = Array.from(document.querySelectorAll('.hero-pill-item'));
        const pillIcons = Array.from(document.querySelectorAll('.hero-pill-item .pill-icon'));

        const headerRect = header ? header.getBoundingClientRect() : null;
        const burgerRect = hamburger ? hamburger.getBoundingClientRect() : null;
        const logoRect = logo ? logo.getBoundingClientRect() : null;

        return {
          headerHeight: headerRect ? Math.round(headerRect.height) : 0,
          burgerSize: burgerRect ? { width: Math.round(burgerRect.width), height: Math.round(burgerRect.height) } : null,
          logoLeft: logoRect ? Math.round(logoRect.left) : 0,
          logoHeight: logoRect ? Math.round(logoRect.height) : 0,
          logoGap: (logoRect && burgerRect) ? Math.round(logoRect.left - burgerRect.right) : 0,
          iconBtnCount: iconBtns.length,
          iconBtnSizes: iconBtns.map(btn => {
            const r = btn.getBoundingClientRect();
            return { width: Math.round(r.width), height: Math.round(r.height) };
          }),
          badgeSizes: badges.map(b => {
            const r = b.getBoundingClientRect();
            return { width: Math.round(r.width), height: Math.round(r.height) };
          }),
          featurePillCount: featurePills.length,
          pillIconSizes: pillIcons.map(pi => {
            const r = pi.getBoundingClientRect();
            return { width: Math.round(r.width), height: Math.round(r.height) };
          }),
          scrollWidth: document.documentElement.scrollWidth,
          windowWidth: window.innerWidth
        };
      });

      console.log(`[Home ${vp.name}] Header height: ${homeHeaderMetrics.headerHeight}px, Burger: ${homeHeaderMetrics.burgerSize?.width}x${homeHeaderMetrics.burgerSize?.height}px, Logo gap: ${homeHeaderMetrics.logoGap}px, IconBtns: ${homeHeaderMetrics.iconBtnSizes[0]?.width}x${homeHeaderMetrics.iconBtnSizes[0]?.height}px, Badges: ${homeHeaderMetrics.badgeSizes[0]?.width}x${homeHeaderMetrics.badgeSizes[0]?.height}px, Feature icons: ${homeHeaderMetrics.pillIconSizes[0]?.width}x${homeHeaderMetrics.pillIconSizes[0]?.height}px`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, `home_${vp.name}.png`), fullPage: false });

      // 2. DESIGNS PAGE (Dropdown CLOSED)
      await page.goto(`${BASE_URL}/designs`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);

      const designsMetrics = await page.evaluate(() => {
        const toolbar = document.querySelector('.mobile-shop-toolbar');
        const filterBtn = document.querySelector('.mobile-filter-btn');
        const sortBtn = document.querySelector('.aruvi-sort-btn');
        const sortLabel = document.querySelector('.aruvi-sort-btn-label');
        const viewBtns = Array.from(document.querySelectorAll('.mobile-view-toggle .view-btn'));
        const container = document.querySelector('.designs-page-container');
        const grid = document.querySelector('.grid-4-strict');
        const cards = Array.from(document.querySelectorAll('.listing-product-card'));
        const firstCard = cards[0];
        const cardImg = firstCard ? firstCard.querySelector('.card-image-box img') : null;
        const discountBadge = firstCard ? firstCard.querySelector('.price-numbers-row .discount-badge') : null;
        const priceRow = firstCard ? firstCard.querySelector('.card-price-action-row') : null;

        const contRect = container ? container.getBoundingClientRect() : null;
        const gridRect = grid ? grid.getBoundingClientRect() : null;
        const sortRect = sortBtn ? sortBtn.getBoundingClientRect() : null;
        const filterRect = filterBtn ? filterBtn.getBoundingClientRect() : null;
        const firstCardRect = firstCard ? firstCard.getBoundingClientRect() : null;
        const secondCardRect = cards[1] ? cards[1].getBoundingClientRect() : null;
        const imgRect = cardImg ? cardImg.getBoundingClientRect() : null;
        const imgBoxRect = firstCard ? firstCard.querySelector('.card-image-box').getBoundingClientRect() : null;

        // Container computed padding
        const compContainer = container ? window.getComputedStyle(container) : null;

        return {
          windowWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          containerPaddingLeft: compContainer ? compContainer.paddingLeft : null,
          containerPaddingRight: compContainer ? compContainer.paddingRight : null,
          gridWidth: gridRect ? Math.round(gridRect.width) : 0,
          gridLeft: gridRect ? Math.round(gridRect.left) : 0,
          gridRight: gridRect ? Math.round(gridRect.right) : 0,
          card1Width: firstCardRect ? Math.round(firstCardRect.width) : 0,
          card2Width: secondCardRect ? Math.round(secondCardRect.width) : 0,
          cardGap: (firstCardRect && secondCardRect) ? Math.round(secondCardRect.left - firstCardRect.right) : 0,
          imgBoxAspect: imgBoxRect ? (imgBoxRect.width / imgBoxRect.height).toFixed(2) : null,
          imgObjectFit: cardImg ? window.getComputedStyle(cardImg).objectFit : null,
          discountBadgeInline: !!discountBadge,
          sortLabelText: sortLabel ? sortLabel.innerText.trim() : '',
          filterBtnWidth: filterRect ? Math.round(filterRect.width) : 0,
          sortBtnWidth: sortRect ? Math.round(sortRect.width) : 0,
          viewBtnSizes: viewBtns.map(vb => {
            const r = vb.getBoundingClientRect();
            return { width: Math.round(r.width), height: Math.round(r.height) };
          })
        };
      });

      console.log(`[Designs ${vp.name}] Container padding: ${designsMetrics.containerPaddingLeft}/${designsMetrics.containerPaddingRight}, Grid width: ${designsMetrics.gridWidth}px, Card gap: ${designsMetrics.cardGap}px, Sort label: "${designsMetrics.sortLabelText}", Sort width: ${designsMetrics.sortBtnWidth}px, Filter width: ${designsMetrics.filterBtnWidth}px, ViewBtn: ${designsMetrics.viewBtnSizes[0]?.width}x${designsMetrics.viewBtnSizes[0]?.height}px, Img aspect: ${designsMetrics.imgBoxAspect}, Img object-fit: ${designsMetrics.imgObjectFit}, %OFF inline: ${designsMetrics.discountBadgeInline}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, `designs_closed_${vp.name}.png`), fullPage: false });

      // 3. DESIGNS PAGE (Dropdown OPEN)
      const sortTrigger = await page.$('.aruvi-sort-btn');
      if (sortTrigger) {
        await sortTrigger.click();
        await page.waitForTimeout(350);

        const dropdownMetrics = await page.evaluate(() => {
          const panel = document.querySelector('.aruvi-sort-panel.open');
          const items = Array.from(document.querySelectorAll('.aruvi-sort-panel.open .aruvi-sort-item'));
          const selectedItem = document.querySelector('.aruvi-sort-panel.open .aruvi-sort-item.selected');
          const checkIcon = selectedItem ? selectedItem.querySelector('.aruvi-sort-item-check') : null;
          const sortBtn = document.querySelector('.aruvi-sort-btn');

          const panelRect = panel ? panel.getBoundingClientRect() : null;
          const btnRect = sortBtn ? sortBtn.getBoundingClientRect() : null;
          const checkRect = checkIcon ? checkIcon.getBoundingClientRect() : null;

          return {
            panelOpen: !!panel,
            panelWidth: panelRect ? Math.round(panelRect.width) : 0,
            panelHeight: panelRect ? Math.round(panelRect.height) : 0,
            panelTop: panelRect ? Math.round(panelRect.top) : 0,
            btnBottom: btnRect ? Math.round(btnRect.bottom) : 0,
            panelLeft: panelRect ? Math.round(panelRect.left) : 0,
            panelRight: panelRect ? Math.round(panelRect.right) : 0,
            btnRight: btnRect ? Math.round(btnRect.right) : 0,
            itemHeights: items.map(it => Math.round(it.getBoundingClientRect().height)),
            selectedBg: selectedItem ? window.getComputedStyle(selectedItem).backgroundColor : null,
            selectedColor: selectedItem ? window.getComputedStyle(selectedItem).color : null,
            checkSize: checkRect ? { width: Math.round(checkRect.width), height: Math.round(checkRect.height) } : null
          };
        });

        console.log(`[Designs Dropdown ${vp.name}] Panel open: ${dropdownMetrics.panelOpen}, Width: ${dropdownMetrics.panelWidth}px, Item height: ${dropdownMetrics.itemHeights[0]}px, Selected bg: ${dropdownMetrics.selectedBg}, Check: ${dropdownMetrics.checkSize?.width}x${dropdownMetrics.checkSize?.height}px, Panel top vs btn bottom: ${dropdownMetrics.panelTop} vs ${dropdownMetrics.btnBottom}`);
        await page.screenshot({ path: path.join(OUTPUT_DIR, `designs_dropdown_open_${vp.name}.png`), fullPage: false });

        // Close dropdown
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      }

      // 4. DESIGN DETAIL PAGE
      await page.goto(`${BASE_URL}/design/rose-floral-design`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);

      const detailMetrics = await page.evaluate(() => {
        const dummyTabs = document.querySelector('.product-tabs-nav, .tab-nav-btn');
        const dummyRelated = document.querySelector('.dummy-related-designs');
        const lotusMandala = Array.from(document.querySelectorAll('*')).some(el => el.textContent && el.textContent.includes('Lotus Mandala'));
        const priya120 = Array.from(document.querySelectorAll('*')).some(el => el.textContent && el.textContent.includes('(120)'));
        const mainImg = document.getElementById('mainDisplayImg');
        const mainDisplay = document.querySelector('.main-image-display');
        const tapBadge = document.querySelector('.tap-zoom-badge');
        const thumbnails = document.querySelector('.thumbnails-stack');
        const techDetails = Array.from(document.querySelectorAll('h3')).some(h => h.textContent.includes('Technical File Details'));
        const buyNowBtn = document.querySelector('button[form="buyNowForm"], .btn-primary');

        const mainRect = mainImg ? mainImg.getBoundingClientRect() : null;
        const dispRect = mainDisplay ? mainDisplay.getBoundingClientRect() : null;

        return {
          dummyTabsFound: !!dummyTabs,
          lotusMandalaFound: lotusMandala,
          priya120Found: priya120,
          techDetailsFound: techDetails,
          buyNowFound: !!buyNowBtn,
          mainImgFit: mainImg ? window.getComputedStyle(mainImg).objectFit : null,
          mainImgDisplayBg: mainDisplay ? window.getComputedStyle(mainDisplay).backgroundColor : null,
          mainImgWidth: mainRect ? Math.round(mainRect.width) : 0,
          mainImgHeight: mainRect ? Math.round(mainRect.height) : 0,
          tapBadgeFound: !!tapBadge,
          thumbnailsFound: !!thumbnails
        };
      });

      console.log(`[Detail ${vp.name}] Dummy tabs: ${detailMetrics.dummyTabsFound}, Lotus Mandala: ${detailMetrics.lotusMandalaFound}, 120 reviews: ${detailMetrics.priya120Found}, Tech details: ${detailMetrics.techDetailsFound}, Main img fit: ${detailMetrics.mainImgFit}, Main img bg: ${detailMetrics.mainImgDisplayBg}, Tap badge: ${detailMetrics.tapBadgeFound}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, `detail_${vp.name}.png`), fullPage: false });

      // Test Lightbox on Detail Page
      const mainImgElem = await page.$('.main-image-display');
      if (mainImgElem) {
        await mainImgElem.click();
        await page.waitForTimeout(300);
        const lightboxOpen = await page.evaluate(() => {
          const m = document.getElementById('imageLightboxModal');
          return m && m.style.display !== 'none';
        });
        console.log(`[Detail ${vp.name}] Lightbox opened on tap: ${lightboxOpen}`);
        await page.screenshot({ path: path.join(OUTPUT_DIR, `detail_lightbox_${vp.name}.png`), fullPage: false });

        // Close lightbox
        const closeBtn = await page.$('.lightbox-close-btn');
        if (closeBtn) await closeBtn.click();
        await page.waitForTimeout(200);
      }

      // 5. CART PAGE
      await page.goto(`${BASE_URL}/cart`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUTPUT_DIR, `cart_${vp.name}.png`), fullPage: false });

      // 6. PROFILE / AUTH LOGIN PAGE
      await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUTPUT_DIR, `login_profile_${vp.name}.png`), fullPage: false });

      await context.close();
    }

    console.log('\n====================================================');
    console.log('Verification Complete. All Screenshots Captured.');
    console.log('====================================================');
  } catch (err) {
    console.error('Audit failed:', err);
  } finally {
    await browser.close();
  }
}

run();
