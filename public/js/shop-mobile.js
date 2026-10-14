/**
 * ARUVI EMBROIDERY STUDIO - Mobile Shop & Catalog Interactions
 * Implements mobile-specific UX:
 * 1. Debounced live search suggestions (300ms) with clear (x) button
 * 2. Smart sticky toolbar (slide up on scroll down, reappear on scroll up)
 * 3. Horizontally scrollable category pills with auto-centering active pill
 * 4. Filter drawer live count on Apply button ("Show 114 designs")
 * 5. Instant add-to-cart with 1.5s checkmark feedback & live cart badge sync
 * 6. Infinite scroll / Load more (24/page) with skeleton cards
 * 7. Scroll position saving & restoration
 * 8. Floating back-to-top button
 */

(function () {
  'use strict';

  // 1. DOM Elements
  const searchInput = document.getElementById('shopSearchInput');
  const searchClearBtn = document.getElementById('searchClearBtn');
  const suggestionsBox = document.getElementById('searchSuggestionsDropdown');
  const searchForm = document.getElementById('shopSearchForm');
  const stickyToolbar = document.getElementById('mobileStickyToolbar');
  const categoryPillsRow = document.getElementById('categoryPillsRow');
  const filterSidebar = document.getElementById('filterSidebar');
  const filterOverlay = document.getElementById('filterOverlay');
  const openFilterBtn = document.getElementById('openMobileFilterBtn');
  const closeFilterBtn = document.getElementById('closeFilterBtn');
  const drawerApplyBtn = document.getElementById('drawerApplyBtn');
  const drawerClearBtn = document.getElementById('drawerClearBtn');
  const designsGrid = document.getElementById('designsGrid');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const loadMoreContainer = document.getElementById('loadMoreContainer');
  const loadMoreSpinner = document.getElementById('loadMoreSpinner');
  const backToTopBtn = document.getElementById('backToTopBtn');

  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';

  // -------------------------------------------------------------------------
  // 2. LIVE SEARCH SUGGESTIONS (Debounced 300ms) & CLEAR BUTTON
  // -------------------------------------------------------------------------
  let searchDebounceTimer = null;

  if (searchInput) {
    // Show/hide clear button on input
    searchInput.addEventListener('input', function () {
      const query = this.value.trim();
      if (searchClearBtn) {
        if (query.length > 0) {
          searchClearBtn.classList.add('visible');
        } else {
          searchClearBtn.classList.remove('visible');
        }
      }

      clearTimeout(searchDebounceTimer);
      if (query.length < 2) {
        hideSuggestions();
        return;
      }

      searchDebounceTimer = setTimeout(() => {
        fetchSearchSuggestions(query);
      }, 300);
    });

    // Enter submits form
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        hideSuggestions();
      }
    });

    // Close suggestions on outside tap
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#designsSearchBar') && !e.target.closest('.designs-search-bar')) {
        hideSuggestions();
      }
    });
  }

  if (searchClearBtn && searchInput) {
    searchClearBtn.addEventListener('click', function (e) {
      e.preventDefault();
      searchInput.value = '';
      searchClearBtn.classList.remove('visible');
      hideSuggestions();
      searchInput.focus();
    });
  }

  async function fetchSearchSuggestions(query) {
    if (!suggestionsBox) return;
    try {
      const res = await fetch(`/api/search/suggestions?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error('Network error');
      const data = await res.json();
      renderSuggestions(data.suggestions || [], query);
    } catch (err) {
      console.warn('Live search suggestion error:', err);
      hideSuggestions();
    }
  }

  function renderSuggestions(list, query) {
    if (!suggestionsBox) return;
    if (!list || list.length === 0) {
      suggestionsBox.innerHTML = `
        <div class="search-suggestion-empty">
          <i class="fa-solid fa-magnifying-glass"></i>
          <span>No designs matching "${escapeHtml(query)}"</span>
        </div>
      `;
      suggestionsBox.style.display = 'block';
      return;
    }

    let html = '<div class="search-suggestions-list">';
    list.forEach(item => {
      const img = item.primary_image || '/public/images/cat_blouse.jpg';
      const curP = item.sale_price !== null && item.sale_price !== undefined ? parseFloat(item.sale_price) : parseFloat(item.price);
      const origP = parseFloat(item.price || 0);
      const hasDisc = origP > curP;

      html += `
        <a href="/design/${item.slug}" class="search-suggestion-item">
          <div class="suggestion-thumb">
            <img src="${escapeHtml(img)}" alt="${escapeHtml(item.title || item.sku)}" onerror="this.onerror=null; this.src='/public/images/cat_blouse.jpg';">
          </div>
          <div class="suggestion-info">
            <div class="suggestion-title">${highlightMatch(item.title || item.sku, query)}</div>
            <div class="suggestion-meta">
              <span class="suggestion-cat">${escapeHtml(item.category_name || 'Design')}</span>
              ${item.sku ? `<span class="suggestion-sku">${escapeHtml(item.sku)}</span>` : ''}
            </div>
            <div class="suggestion-price">
              ${hasDisc ? `<span class="suggestion-old-price">₹${origP}</span>` : ''}
              <span class="suggestion-cur-price">₹${curP}</span>
            </div>
          </div>
          <i class="fa-solid fa-chevron-right suggestion-arrow"></i>
        </a>
      `;
    });

    html += `
      <a href="/designs?search=${encodeURIComponent(query)}" class="search-suggestion-viewall">
        <span>View all results for "${escapeHtml(query)}"</span>
        <i class="fa-solid fa-arrow-right"></i>
      </a>
    `;
    html += '</div>';

    suggestionsBox.innerHTML = html;
    suggestionsBox.style.display = 'block';
  }

  function hideSuggestions() {
    if (suggestionsBox) suggestionsBox.style.display = 'none';
  }

  function highlightMatch(text, query) {
    if (!text) return '';
    const safeText = escapeHtml(text);
    if (!query) return safeText;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return safeText.replace(regex, '<mark>$1</mark>');
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // -------------------------------------------------------------------------
  // 3. HORIZONTALLY SCROLLABLE CATEGORY PILLS (Auto-center active pill)
  // -------------------------------------------------------------------------
  if (categoryPillsRow) {
    const activePill = categoryPillsRow.querySelector('.cat-pill-btn.active');
    if (activePill) {
      setTimeout(() => {
        try {
          activePill.scrollIntoView({
            behavior: 'smooth',
            inline: 'center',
            block: 'nearest'
          });
        } catch (e) {
          categoryPillsRow.scrollLeft = activePill.offsetLeft - (categoryPillsRow.clientWidth / 2) + (activePill.clientWidth / 2);
        }
      }, 100);
    }
  }

  // -------------------------------------------------------------------------
  // 4. SMART STICKY TOOLBAR (Hides on scroll down, shows on scroll up)
  // -------------------------------------------------------------------------
  let lastScrollY = window.pageYOffset || document.documentElement.scrollTop;
  let isToolbarHidden = false;
  let scrollThreshold = 10;

  function handleSmartStickyToolbar() {
    if (window.innerWidth >= 768 || !stickyToolbar) return;

    const currentScrollY = window.pageYOffset || document.documentElement.scrollTop;
    const scrollDelta = currentScrollY - lastScrollY;

    // Only apply sticky hide/show after scrolling past initial header (~110px)
    if (currentScrollY > 110) {
      if (scrollDelta > scrollThreshold && !isToolbarHidden) {
        // Scrolling DOWN -> Slide UP & hide
        stickyToolbar.classList.add('toolbar-hidden');
        isToolbarHidden = true;
      } else if (scrollDelta < -scrollThreshold && isToolbarHidden) {
        // Scrolling UP -> Slide DOWN & show
        stickyToolbar.classList.remove('toolbar-hidden');
        isToolbarHidden = false;
      }
    } else {
      stickyToolbar.classList.remove('toolbar-hidden');
      isToolbarHidden = false;
    }

    lastScrollY = currentScrollY;
  }

  // Floating Back to Top Button
  function handleBackToTopVisibility() {
    if (!backToTopBtn) return;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;
    const twoScreensHeight = window.innerHeight * 1.6;

    if (scrollY > twoScreensHeight) {
      backToTopBtn.style.display = 'flex';
      backToTopBtn.classList.add('visible');
    } else {
      backToTopBtn.classList.remove('visible');
      setTimeout(() => {
        if (!backToTopBtn.classList.contains('visible')) {
          backToTopBtn.style.display = 'none';
        }
      }, 200);
    }
  }

  if (backToTopBtn) {
    backToTopBtn.addEventListener('click', function () {
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    });
  }

  window.addEventListener('scroll', () => {
    handleSmartStickyToolbar();
    handleBackToTopVisibility();
  }, { passive: true });

  // -------------------------------------------------------------------------
  // 5. FILTER BOTTOM SHEET DRAWER & LIVE COUNT ON APPLY BUTTON
  // -------------------------------------------------------------------------
  let countDebounceTimer = null;

  function openFilterDrawer() {
    if (filterSidebar) filterSidebar.classList.add('open');
    if (filterOverlay) filterOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    updateFilterLiveCount();
  }

  function closeFilterDrawer() {
    if (filterSidebar) filterSidebar.classList.remove('open');
    if (filterOverlay) filterOverlay.classList.remove('active');
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  }

  if (openFilterBtn) openFilterBtn.addEventListener('click', openFilterDrawer);
  if (closeFilterBtn) closeFilterBtn.addEventListener('click', closeFilterDrawer);
  if (filterOverlay) filterOverlay.addEventListener('click', closeFilterDrawer);

  // Live filter count calculation
  const filterForm = document.getElementById('filterForm');
  if (filterForm) {
    filterForm.addEventListener('change', function () {
      clearTimeout(countDebounceTimer);
      countDebounceTimer = setTimeout(updateFilterLiveCount, 200);
    });
  }

  async function updateFilterLiveCount() {
    if (!drawerApplyBtn || !filterForm) return;

    try {
      const formData = new FormData(filterForm);
      const params = new URLSearchParams();

      for (const [key, value] of formData.entries()) {
        if (value && value !== '' && key !== '_csrf') {
          params.append(key, value);
        }
      }

      drawerApplyBtn.disabled = true;
      drawerApplyBtn.textContent = 'Updating count...';

      const res = await fetch(`/api/designs/count?${params.toString()}`);
      if (!res.ok) throw new Error('Count failed');
      const data = await res.json();

      const count = typeof data.count !== 'undefined' ? data.count : 0;
      drawerApplyBtn.disabled = false;
      drawerApplyBtn.textContent = `Show ${count} ${count === 1 ? 'design' : 'designs'}`;
    } catch (err) {
      console.warn('Failed to fetch live filter count:', err);
      if (drawerApplyBtn) {
        drawerApplyBtn.disabled = false;
        drawerApplyBtn.textContent = 'Apply Filters';
      }
    }
  }

  // -------------------------------------------------------------------------
  // 6. INSTANT ADD TO CART WITH 1.5s TICK FEEDBACK & LIVE CART BADGE SYNC
  // -------------------------------------------------------------------------
  document.addEventListener('click', async function (e) {
    const cartBtn = e.target.closest('.card-cart-btn-instant');
    if (!cartBtn) return;

    e.preventDefault();
    e.stopPropagation();

    if (cartBtn.disabled || cartBtn.classList.contains('adding')) return;

    const designId = cartBtn.dataset.id;
    if (!designId) return;

    cartBtn.classList.add('adding');
    const originalHtml = cartBtn.innerHTML;

    try {
      const res = await fetch('/cart/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        body: new URLSearchParams({
          design_id: designId,
          _csrf: csrfToken
        })
      });

      const data = await res.json();

      if (data.success) {
        // Show checkmark tick feedback for 1.5 seconds
        cartBtn.innerHTML = '<i class="fa-solid fa-check" style="color: #2E7D32;"></i>';
        cartBtn.style.backgroundColor = '#E8F5E9';
        cartBtn.style.borderColor = '#A5D6A7';

        // Update all cart count badges in header and mobile drawer instantly
        if (typeof data.cartCount !== 'undefined') {
          document.querySelectorAll('.cart-badge:not(.wishlist-badge)').forEach(badge => {
            badge.textContent = data.cartCount;
            badge.style.transform = 'scale(1.25)';
            setTimeout(() => { badge.style.transform = ''; }, 300);
          });
        }

        if (typeof showToast === 'function') {
          showToast(data.message || 'Added to cart!', 'success');
        }

        setTimeout(() => {
          cartBtn.innerHTML = originalHtml;
          cartBtn.style.backgroundColor = '';
          cartBtn.style.borderColor = '';
          cartBtn.classList.remove('adding');
        }, 1500);
      } else {
        cartBtn.innerHTML = originalHtml;
        cartBtn.classList.remove('adding');
        if (typeof showToast === 'function') {
          showToast(data.message || 'Failed to add item to cart', 'error');
        }
      }
    } catch (err) {
      console.error('Cart add error:', err);
      cartBtn.innerHTML = originalHtml;
      cartBtn.classList.remove('adding');
    }
  });

  // -------------------------------------------------------------------------
  // 7. WISHLIST TOGGLE AJAX WITH HEADER BADGE SYNC
  // -------------------------------------------------------------------------
  document.addEventListener('click', async function (e) {
    const wishBtn = e.target.closest('.wishlist-round-btn');
    if (!wishBtn) return;

    e.preventDefault();
    e.stopPropagation();

    const designId = wishBtn.dataset.id;
    if (!designId) return;

    const icon = wishBtn.querySelector('i');

    try {
      const res = await fetch('/user/wishlist/toggle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({ design_id: designId })
      });

      const data = await res.json();

      if (data.success) {
        if (data.status === 'added') {
          wishBtn.classList.add('active');
          if (icon) icon.className = 'fa-solid fa-heart';
        } else {
          wishBtn.classList.remove('active');
          if (icon) icon.className = 'fa-regular fa-heart';
        }

        // Update wishlist badges in header
        if (typeof data.count !== 'undefined') {
          document.querySelectorAll('.wishlist-badge').forEach(badge => {
            badge.textContent = data.count;
          });
        }

        if (typeof showToast === 'function') {
          showToast(data.message, 'success');
        }
      } else {
        if (typeof showToast === 'function') {
          showToast(data.message || 'Please log in to save to wishlist.', 'error');
        }
      }
    } catch (err) {
      console.error('Wishlist error:', err);
    }
  });

  // -------------------------------------------------------------------------
  // 8. INFINITE SCROLL / LOAD MORE (24/page) WITH SKELETON CARDS
  // -------------------------------------------------------------------------
  let isLoadingNextPage = false;

  async function loadNextPage() {
    if (!loadMoreBtn || isLoadingNextPage) return;

    const currentPage = parseInt(loadMoreBtn.dataset.page, 10) || 1;
    const totalPages = parseInt(loadMoreBtn.dataset.totalPages, 10) || 1;

    if (currentPage >= totalPages) {
      if (loadMoreContainer) loadMoreContainer.style.display = 'none';
      return;
    }

    isLoadingNextPage = true;
    const nextPage = currentPage + 1;

    // Show loading spinner / skeleton
    if (loadMoreBtn) loadMoreBtn.style.display = 'none';
    if (loadMoreSpinner) loadMoreSpinner.style.display = 'flex';

    appendSkeletonCards(4);

    try {
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.set('page', nextPage);
      currentUrl.searchParams.set('ajax', '1');
      currentUrl.searchParams.set('limit', '24');

      const res = await fetch(currentUrl.toString(), {
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }
      });

      if (!res.ok) throw new Error('Failed to load designs');
      const data = await res.json();

      // Remove skeletons
      removeSkeletonCards();

      if (data.success && data.designs && data.designs.length > 0) {
        renderNewCards(data.designs, data.userPurchasedDesignIds || [], data.userWishlistDesignIds || []);

        // Update button dataset
        loadMoreBtn.dataset.page = data.currentPage;
        loadMoreBtn.dataset.totalPages = data.totalPages;

        const remaining = Math.max(0, data.total - (data.currentPage * 24));
        const btnText = loadMoreBtn.querySelector('span');
        if (btnText) {
          btnText.textContent = remaining > 0 ? `Load more (${remaining} remaining)` : 'All designs loaded';
        }

        if (data.currentPage >= data.totalPages) {
          if (loadMoreContainer) loadMoreContainer.style.display = 'none';
        } else {
          if (loadMoreBtn) loadMoreBtn.style.display = 'inline-flex';
        }

        // Save current page in sessionStorage for scroll restoration
        sessionStorage.setItem('aruvi_designs_page', String(data.currentPage));
      } else {
        if (loadMoreContainer) loadMoreContainer.style.display = 'none';
      }
    } catch (err) {
      console.error('Error loading more designs:', err);
      removeSkeletonCards();
      if (loadMoreBtn) loadMoreBtn.style.display = 'inline-flex';
    } finally {
      if (loadMoreSpinner) loadMoreSpinner.style.display = 'none';
      isLoadingNextPage = false;
    }
  }

  function appendSkeletonCards(count = 4) {
    if (!designsGrid) return;
    for (let i = 0; i < count; i++) {
      const skel = document.createElement('div');
      skel.className = 'listing-product-card skeleton-card';
      skel.innerHTML = `
        <div class="card-image-box skeleton-shimmer" style="aspect-ratio: 1/1; width: 100%;"></div>
        <div class="card-body-content" style="padding: 10px;">
          <div class="skeleton-shimmer" style="height: 16px; width: 80%; border-radius: 4px; margin-bottom: 6px;"></div>
          <div class="skeleton-shimmer" style="height: 12px; width: 50%; border-radius: 4px; margin-bottom: 8px;"></div>
          <div class="skeleton-shimmer" style="height: 20px; width: 60%; border-radius: 4px; margin-bottom: 8px;"></div>
          <div class="skeleton-shimmer" style="height: 44px; width: 100%; border-radius: 12px;"></div>
        </div>
      `;
      designsGrid.appendChild(skel);
    }
  }

  function removeSkeletonCards() {
    if (!designsGrid) return;
    designsGrid.querySelectorAll('.skeleton-card').forEach(el => el.remove());
  }

  function renderNewCards(designs, purchasedIds, wishlistIds) {
    if (!designsGrid) return;

    designs.forEach(design => {
      const card = document.createElement('div');
      card.className = 'listing-product-card';
      card.dataset.designId = design.id;

      const imgSrc = design.primary_image || '/public/images/cat_blouse.jpg';
      const fmtsList = design.formats ? design.formats.split(',').map(s => s.trim()).filter(Boolean) : ['DST'];
      const primaryFormatTag = fmtsList[0] || 'DST';
      const inWishlist = wishlistIds.includes(design.id);
      const isOwned = purchasedIds.includes(design.id);

      const hasTitle = design.title && design.title.trim() && design.title.trim().toUpperCase() !== (design.sku || '').toUpperCase();
      const displayTitle = hasTitle ? design.title : (design.sku || 'Embroidery Design');

      const hasRealReviews = design.real_reviews_count && parseInt(design.real_reviews_count, 10) > 0;
      const curPrice = (design.sale_price !== null && design.sale_price !== undefined && design.sale_price !== '') ? parseFloat(design.sale_price) : parseFloat(design.price);
      const origPrice = parseFloat(design.price || 0);
      const hasDisc = origPrice > curPrice && origPrice > 0;
      const discPct = hasDisc ? Math.round(((origPrice - curPrice) / origPrice) * 100) : 0;

      card.innerHTML = `
        <div class="card-image-box">
          <a href="/design/${design.slug}" class="card-img-link" aria-label="${escapeHtml(displayTitle)}">
            <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(displayTitle)}" loading="lazy" class="card-product-img" onerror="this.onerror=null; this.src='/public/images/cat_blouse.jpg';">
          </a>
          <span class="card-format-tag">${escapeHtml(primaryFormatTag)}</span>
          <button type="button" class="wishlist-round-btn wishlist-btn ${inWishlist ? 'active' : ''}" data-id="${design.id}" aria-label="Save to Wishlist" title="Wishlist">
            <i class="${inWishlist ? 'fa-solid fa-heart' : 'fa-regular fa-heart'}"></i>
          </button>
        </div>

        <div class="card-body-content">
          <h3 class="card-item-title">
            <a href="/design/${design.slug}">${escapeHtml(displayTitle)}</a>
          </h3>
          <span class="card-item-category">${escapeHtml(design.category_name || 'Blouse Designs')}</span>

          <div class="format-pill-row">
            ${fmtsList.map(fmt => `<span class="fmt-pill">${escapeHtml(fmt)}</span>`).join('')}
          </div>

          ${hasRealReviews ? `
            <div class="card-rating-row">
              <i class="fa-solid fa-star star-yellow"></i>
              <span class="rating-num">${parseFloat(design.real_avg_rating).toFixed(1)}</span>
              <span class="rating-count">(${design.real_reviews_count})</span>
            </div>
          ` : ''}

          <div class="card-price-action-row">
            <div class="card-price-group">
              ${hasDisc ? `<span class="old-price">₹${origPrice}</span>` : ''}
              <span class="current-price">₹${curPrice}</span>
              ${hasDisc ? `<span class="discount-badge">${discPct}% OFF</span>` : ''}
            </div>
            <button type="button" class="card-cart-btn-instant" data-id="${design.id}" aria-label="Add to Cart" title="Add to Cart">
              <i class="fa-solid fa-cart-shopping"></i>
            </button>
          </div>

          ${isOwned ? `
            <a href="/design/${design.slug}" class="card-btn-buynow is-owned" aria-label="Owned - View and Download" title="Owned - Download">
              <i class="fa-solid fa-circle-check"></i> Owned
            </a>
          ` : `
            <a href="/cart/buy-now?design_id=${design.id}" class="card-btn-buynow" aria-label="Buy Now" title="Buy Now">
              <i class="fa-solid fa-bag-shopping"></i> Buy Now
            </a>
          `}
        </div>
      `;

      designsGrid.appendChild(card);
    });
  }

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', loadNextPage);
  }

  // Auto-trigger load more when user scrolls near bottom on mobile
  window.addEventListener('scroll', () => {
    if (window.innerWidth >= 768) return;
    if (!loadMoreContainer || loadMoreContainer.style.display === 'none') return;
    if (isLoadingNextPage) return;

    const scrollPos = window.innerHeight + window.pageYOffset;
    const bottomThreshold = document.documentElement.offsetHeight - 500;

    if (scrollPos >= bottomThreshold) {
      loadNextPage();
    }
  }, { passive: true });

  // -------------------------------------------------------------------------
  // 9. SCROLL POSITION RESTORATION
  // -------------------------------------------------------------------------
  // When leaving page, store scroll position and current URL
  window.addEventListener('beforeunload', () => {
    sessionStorage.setItem('aruvi_designs_scrollY', String(window.pageYOffset || document.documentElement.scrollTop));
    sessionStorage.setItem('aruvi_designs_url', window.location.href);
  });

  // On page load, if returning to same URL, restore scroll position
  document.addEventListener('DOMContentLoaded', () => {
    const savedUrl = sessionStorage.getItem('aruvi_designs_url');
    const savedScrollY = sessionStorage.getItem('aruvi_designs_scrollY');

    if (savedUrl === window.location.href && savedScrollY) {
      setTimeout(() => {
        window.scrollTo({
          top: parseInt(savedScrollY, 10),
          behavior: 'instant'
        });
        sessionStorage.removeItem('aruvi_designs_scrollY');
      }, 150);
    }
  });

})();
