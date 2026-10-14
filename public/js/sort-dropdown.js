/**
 * ARUVI EMBROIDERY STUDIO — Standardized Reusable Sort Dropdown Engine
 * 
 * Features:
 * - Direct portal attachment to document.body: 100% UNCLIPPED by any parent overflow.
 * - Viewport-aware clamped positioning (right-aligned to trigger button).
 * - Full Keyboard & ARIA listbox accessibility (Escape, Up/Down, Enter/Space).
 * - Seamless AJAX grid update with animated skeleton loader.
 * - Browser History (pushState & popstate back/forward) sync.
 * - Multi-dropdown syncing across mobile toolbar and desktop controls.
 */

(function () {
  'use strict';

  // Ensure body-level portal container exists
  function getPortalContainer() {
    let portal = document.getElementById('aruviSortPortal');
    if (!portal) {
      portal = document.createElement('div');
      portal.id = 'aruviSortPortal';
      portal.className = 'aruvi-sort-portal-root';
      document.body.appendChild(portal);
    }
    return portal;
  }

  // Active open dropdown tracker
  let activeOpenDropdown = null;

  function positionDropdownPanel(trigger, panel) {
    if (!trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    const isMobile = window.innerWidth < 768;
    const panelWidth = Math.min(260, window.innerWidth - 32);

    panel.style.width = panelWidth + 'px';
    panel.style.top = (rect.bottom + 8) + 'px';

    // Right-align with the trigger button, clamped to screen margins
    const idealLeft = rect.right - panelWidth;
    const minLeft = 16;
    const maxLeft = window.innerWidth - panelWidth - 16;
    const clampedLeft = Math.max(minLeft, Math.min(idealLeft, maxLeft));

    panel.style.left = clampedLeft + 'px';
    panel.style.right = 'auto';
  }

  function closeOpenDropdown() {
    if (!activeOpenDropdown) return;
    const { trigger, panel } = activeOpenDropdown;
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
      trigger.classList.remove('open');
    }
    if (panel) {
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
    }
    activeOpenDropdown = null;
  }

  function openDropdown(trigger, panel, wrap) {
    if (activeOpenDropdown && activeOpenDropdown.panel === panel) {
      closeOpenDropdown();
      return;
    }

    closeOpenDropdown();

    // Portal relocation: move panel into #aruviSortPortal at document.body level so no overflow:hidden can clip it
    const portal = getPortalContainer();
    if (panel.parentElement !== portal) {
      panel.__originalParent = wrap;
      portal.appendChild(panel);
    }

    positionDropdownPanel(trigger, panel);

    trigger.setAttribute('aria-expanded', 'true');
    trigger.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    panel.classList.add('open');

    activeOpenDropdown = { trigger, panel, wrap };

    // Focus selected option or first option
    const selectedOpt = panel.querySelector('.aruvi-sort-item.selected') || panel.querySelector('.aruvi-sort-item');
    if (selectedOpt) {
      setTimeout(() => selectedOpt.focus(), 30);
    }
  }

  // Sync labels and states of all sort dropdowns on the page
  function syncAllSortDropdowns(val, optLabel) {
    document.querySelectorAll('.aruvi-sort-wrapper').forEach(wrapper => {
      const input = wrapper.querySelector('input[type="hidden"]');
      if (input) input.value = val;

      const trigger = wrapper.querySelector('.aruvi-sort-btn');
      if (trigger) {
        const valText = trigger.querySelector('.aruvi-sort-val-text');
        if (valText && optLabel) valText.textContent = optLabel;
        trigger.setAttribute('aria-label', `Sort options, current: ${optLabel}`);
      }
    });

    // Also sync options in all panels (in DOM and in portal)
    document.querySelectorAll('.aruvi-sort-panel').forEach(panel => {
      panel.querySelectorAll('.aruvi-sort-item').forEach(item => {
        const itemVal = item.getAttribute('data-value');
        const isMatch = (itemVal === val) ||
          (val === 'latest' && itemVal === 'newest') ||
          (val === 'price_asc' && itemVal === 'price_low') ||
          (val === 'price_desc' && itemVal === 'price_high') ||
          (val === 'top_rated' && itemVal === 'rating') ||
          (val === 'popular' && itemVal === 'most_popular');

        if (isMatch) {
          item.classList.add('selected');
          item.setAttribute('aria-selected', 'true');
        } else {
          item.classList.remove('selected');
          item.setAttribute('aria-selected', 'false');
        }
      });
    });
  }

  // Render pulsing skeleton cards in the product grid during AJAX sort
  function renderSkeletonGrid(gridContainer) {
    if (!gridContainer) return;
    const count = 12;
    let skeletonHtml = '';
    for (let i = 0; i < count; i++) {
      skeletonHtml += `
        <div class="card-skeleton" aria-hidden="true">
          <div class="skeleton-image skeleton-shimmer"></div>
          <div class="skeleton-body">
            <div class="skeleton-line skeleton-title skeleton-shimmer"></div>
            <div class="skeleton-line skeleton-meta skeleton-shimmer"></div>
            <div class="skeleton-line skeleton-rating skeleton-shimmer"></div>
            <div class="skeleton-line skeleton-price skeleton-shimmer"></div>
            <div class="skeleton-btn skeleton-shimmer"></div>
          </div>
        </div>
      `;
    }
    gridContainer.innerHTML = skeletonHtml;
    gridContainer.classList.add('grid-is-loading');
  }

  // Perform AJAX reload of products grid and pagination
  function reloadGridWithSort(targetUrl, val, optLabel) {
    const gridContainer = document.querySelector('.grid-4-strict') ||
                          document.querySelector('.results-container .grid-4-strict') ||
                          document.querySelector('.results-container') ||
                          document.querySelector('.shop-main-content .grid-3');

    if (gridContainer) {
      renderSkeletonGrid(gridContainer);
    }

    fetch(targetUrl.href, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      }
    })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(html => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // 1. Replace Product Grid Content
        const newGrid = doc.querySelector('.grid-4-strict') ||
                        doc.querySelector('.results-container .grid-4-strict') ||
                        doc.querySelector('.results-container') ||
                        doc.querySelector('.shop-main-content .grid-3');

        const currentGrid = document.querySelector('.grid-4-strict') ||
                            document.querySelector('.results-container .grid-4-strict') ||
                            document.querySelector('.results-container') ||
                            document.querySelector('.shop-main-content .grid-3');

        if (newGrid && currentGrid) {
          currentGrid.innerHTML = newGrid.innerHTML;
          currentGrid.className = newGrid.className;
          currentGrid.classList.remove('grid-is-loading');
        }

        // 2. Replace Mobile Results Count Pill ("100 designs")
        const newMobileCount = doc.querySelector('.mobile-results-count');
        const currentMobileCount = document.querySelector('.mobile-results-count');
        if (newMobileCount && currentMobileCount) {
          currentMobileCount.innerHTML = newMobileCount.innerHTML;
        }

        // 3. Replace Desktop Two-line Count
        const newRc = doc.querySelector('.results-count-twoline');
        const currentRc = document.querySelector('.results-count-twoline');
        if (newRc && currentRc) {
          currentRc.innerHTML = newRc.innerHTML;
        }

        // 4. Replace Category Count Badge (Category Detail page)
        const newCatBadge = doc.querySelector('.category-count-badge');
        const currentCatBadge = document.querySelector('.category-count-badge');
        if (newCatBadge && currentCatBadge) {
          currentCatBadge.innerHTML = newCatBadge.innerHTML;
        }

        // 5. Replace Category Pills Count (All Designs / Categories)
        const newPills = doc.querySelector('.category-pills-scroll-row');
        const currentPills = document.querySelector('.category-pills-scroll-row');
        if (newPills && currentPills) {
          currentPills.innerHTML = newPills.innerHTML;
        }

        // 6. Replace Pagination
        const newPagination = doc.querySelector('.pagination-wrapper');
        const currentPagination = document.querySelector('.pagination-wrapper');
        if (newPagination && currentPagination) {
          currentPagination.innerHTML = newPagination.innerHTML;
        } else if (newPagination && !currentPagination && currentGrid) {
          currentGrid.parentElement.appendChild(newPagination);
        } else if (!newPagination && currentPagination) {
          currentPagination.remove();
        }

        // 7. Replace Active Filters Bar
        const newActiveFilters = doc.querySelector('.active-filters-bar');
        const currentActiveFilters = document.querySelector('.active-filters-bar');
        if (newActiveFilters && currentActiveFilters) {
          currentActiveFilters.innerHTML = newActiveFilters.innerHTML;
        } else if (newActiveFilters && !currentActiveFilters) {
          const shopMain = document.querySelector('.shop-main-content');
          if (shopMain && currentGrid) {
            shopMain.insertBefore(newActiveFilters, currentGrid);
          }
        } else if (!newActiveFilters && currentActiveFilters) {
          currentActiveFilters.remove();
        }

        // 8. Sync all sort dropdown buttons across mobile & desktop
        syncAllSortDropdowns(val, optLabel);

        // 9. Re-bind event handlers on new cards (Cart & Wishlist)
        if (window.initCardHandlers) {
          window.initCardHandlers();
        }
      })
      .catch(err => {
        console.warn('AJAX sort failed, falling back to page reload:', err);
        window.location.href = targetUrl.href;
      });
  }

  // Initialize individual sort dropdown component
  function initSortDropdown(wrapper) {
    if (wrapper.__aruviInitialized) return;
    wrapper.__aruviInitialized = true;

    const trigger = wrapper.querySelector('.aruvi-sort-btn');
    const panel = wrapper.querySelector('.aruvi-sort-panel');
    const hiddenInput = wrapper.querySelector('input[type="hidden"]');
    const actionType = wrapper.getAttribute('data-action-type') || 'ajax';
    const paramName = wrapper.getAttribute('data-param-name') || 'sort';

    if (!trigger || !panel) return;

    // Toggle button click
    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openDropdown(trigger, panel, wrapper);
    });

    // Keyboard navigation on trigger
    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        openDropdown(trigger, panel, wrapper);
      } else if (e.key === 'Escape') {
        closeOpenDropdown();
      }
    });

    // Option item interactions
    const items = panel.querySelectorAll('.aruvi-sort-item');
    items.forEach(item => {
      function chooseOption() {
        const val = item.getAttribute('data-value');
        const titleEl = item.querySelector('.aruvi-sort-item-title');
        const labelText = titleEl ? titleEl.textContent.trim() : item.textContent.trim();

        // Update hidden input
        if (hiddenInput) {
          hiddenInput.value = val;
          hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // Close dropdown panel
        closeOpenDropdown();
        trigger.focus();

        // Handle navigation or AJAX reload
        if (actionType === 'submit') {
          const form = wrapper.closest('form');
          if (form) form.submit();
        } else {
          // Standard catalog / designs sort: update URL & reload grid
          const targetUrl = new URL(window.location.href);
          targetUrl.searchParams.set(paramName, val);
          targetUrl.searchParams.delete('page'); // Reset to page 1

          // Update URL in browser history
          if (window.history && window.history.pushState) {
            window.history.pushState({ path: targetUrl.href, sort: val, label: labelText }, '', targetUrl.href);
          }

          // Sync dropdowns & reload product grid via AJAX
          syncAllSortDropdowns(val, labelText);
          reloadGridWithSort(targetUrl, val, labelText);
        }
      }

      item.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        chooseOption();
      });

      item.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          chooseOption();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          const next = item.nextElementSibling;
          if (next && next.classList.contains('aruvi-sort-item')) {
            next.focus();
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prev = item.previousElementSibling;
          if (prev && prev.classList.contains('aruvi-sort-item')) {
            prev.focus();
          } else {
            trigger.focus();
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeOpenDropdown();
          trigger.focus();
        }
      });
    });
  }

  // Global Outside Click listener
  document.addEventListener('click', function (e) {
    if (!activeOpenDropdown) return;
    const { trigger, panel } = activeOpenDropdown;
    if (trigger.contains(e.target) || panel.contains(e.target)) {
      return;
    }
    closeOpenDropdown();
  });

  // Global Escape Key listener
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && activeOpenDropdown) {
      const { trigger } = activeOpenDropdown;
      closeOpenDropdown();
      if (trigger) trigger.focus();
    }
  });

  // Reposition on window resize or scroll
  window.addEventListener('resize', function () {
    if (activeOpenDropdown) {
      positionDropdownPanel(activeOpenDropdown.trigger, activeOpenDropdown.panel);
    }
  });

  window.addEventListener('scroll', function () {
    if (activeOpenDropdown) {
      positionDropdownPanel(activeOpenDropdown.trigger, activeOpenDropdown.panel);
    }
  }, { passive: true });

  // Browser History Back/Forward (popstate) support
  window.addEventListener('popstate', function () {
    const currentUrl = new URL(window.location.href);
    const sortVal = currentUrl.searchParams.get('sort') || 'latest';
    
    // Determine sort label from options
    let optLabel = 'Latest';
    if (sortVal === 'price_asc' || sortVal === 'price_low') optLabel = 'Price: Low to High';
    else if (sortVal === 'price_desc' || sortVal === 'price_high') optLabel = 'Price: High to Low';
    else if (sortVal === 'popular' || sortVal === 'most_popular') optLabel = 'Popular';
    else if (sortVal === 'top_rated' || sortVal === 'rating') optLabel = 'Top Rated';

    syncAllSortDropdowns(sortVal, optLabel);
    reloadGridWithSort(currentUrl, sortVal, optLabel);
  });

  // Init all instances on page
  function initAllSortDropdowns() {
    document.querySelectorAll('.aruvi-sort-wrapper').forEach(initSortDropdown);
  }

  // Auto initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAllSortDropdowns);
  } else {
    initAllSortDropdowns();
  }

  window.initAruviSortDropdowns = initAllSortDropdowns;
})();
