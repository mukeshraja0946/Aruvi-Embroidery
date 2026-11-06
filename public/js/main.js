/**
 * ARUVI EMBROIDERY STUDIO - Client Frontend Controller
 * Header Actions, Universal Wishlist (Logged-in & Guest), Cart Sync, Mobile Navigation
 */

function updateWishlistBadges(count) {
  const safeCount = Math.max(0, parseInt(count, 10) || 0);
  document.querySelectorAll('.wishlist-badge').forEach(badge => {
    badge.textContent = safeCount;
    badge.style.transform = 'scale(1.2)';
    setTimeout(() => { badge.style.transform = ''; }, 250);
  });
}

function updateCartBadges(count) {
  const safeCount = Math.max(0, parseInt(count, 10) || 0);
  document.querySelectorAll('.cart-badge:not(.wishlist-badge)').forEach(badge => {
    badge.textContent = safeCount;
    badge.style.transform = 'scale(1.2)';
    setTimeout(() => { badge.style.transform = ''; }, 250);
  });
}

// ---------------------------------------------------------------------------
// 1. UNIVERSAL WISHLIST TOGGLE (Event Delegation - Logged In & Guest)
// ---------------------------------------------------------------------------
document.addEventListener('click', async function (e) {
  const btn = e.target.closest('.wishlist-btn, .wishlist-round-btn');
  if (!btn) return;

  e.preventDefault();
  e.stopPropagation();

  if (btn.dataset.processing === '1') return;
  btn.dataset.processing = '1';

  const designId = btn.dataset.id;
  if (!designId) {
    btn.dataset.processing = '0';
    return;
  }

  const isUserLoggedIn = (typeof window.isUserLoggedIn !== 'undefined') ? Boolean(window.isUserLoggedIn) : false;

  if (isUserLoggedIn) {
    // Authenticated user: DB toggle via server API
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
    try {
      const response = await fetch('/api/wishlist/toggle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          'Accept': 'application/json'
        },
        body: JSON.stringify({ design_id: designId, _csrf: csrfToken })
      });

      const data = await response.json();

      if (data.success) {
        const isAdded = data.status === 'added';
        // Update all buttons for this design on current page
        document.querySelectorAll(`.wishlist-btn[data-id="${designId}"], .wishlist-round-btn[data-id="${designId}"]`).forEach(b => {
          if (isAdded) {
            b.classList.add('active');
            const icon = b.querySelector('i');
            if (icon) icon.className = 'fa-solid fa-heart';
          } else {
            b.classList.remove('active');
            const icon = b.querySelector('i');
            if (icon) icon.className = 'fa-regular fa-heart';
          }
        });

        if (typeof data.count !== 'undefined') {
          updateWishlistBadges(data.count);
        }

        // If on Wishlist page and removed, remove card from DOM smoothly
        if (!isAdded) {
          const card = document.getElementById(`wishCard-${designId}`) || btn.closest('.wishlist-card-item');
          if (card) {
            card.style.opacity = '0';
            card.style.transform = 'scale(0.9)';
            card.style.transition = 'all 0.3s ease';
            setTimeout(() => {
              card.remove();
              const remaining = document.querySelectorAll('.wishlist-card-item').length;
              const countHdr = document.getElementById('wishlistCountHeader');
              if (countHdr) countHdr.textContent = remaining;
              if (remaining === 0) {
                const emptyBox = document.getElementById('authEmptyWishlist') || document.getElementById('guestEmptyWishlist');
                if (emptyBox) emptyBox.style.display = 'block';
              }
            }, 300);
          }
        }

        showToast(data.message || (isAdded ? 'Saved to your wishlist!' : 'Removed from wishlist.'), 'success');
      } else {
        showToast(data.message || 'Unable to update wishlist.', 'error');
      }
    } catch (err) {
      console.error('Wishlist toggle error:', err);
      showToast('Network error updating wishlist. Please try again.', 'error');
    } finally {
      btn.dataset.processing = '0';
    }
  } else {
    // Guest user: Persist in localStorage and update UI instantly
    try {
      let guestWishlist = [];
      try {
        const raw = localStorage.getItem('aruvi_guest_wishlist');
        guestWishlist = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(guestWishlist)) guestWishlist = [];
      } catch (_) {
        guestWishlist = [];
      }

      const numId = parseInt(designId, 10);
      const strId = String(designId);
      const existingIdx = guestWishlist.findIndex(id => id == numId || String(id) === strId);

      if (existingIdx >= 0) {
        // Remove from guest wishlist
        guestWishlist.splice(existingIdx, 1);
        document.querySelectorAll(`.wishlist-btn[data-id="${designId}"], .wishlist-round-btn[data-id="${designId}"]`).forEach(b => {
          b.classList.remove('active');
          const icon = b.querySelector('i');
          if (icon) icon.className = 'fa-regular fa-heart';
        });
        showToast('Removed from wishlist.', 'info');

        // If on Wishlist page and removed, remove card
        const card = document.getElementById(`wishCard-${designId}`) || btn.closest('.wishlist-card-item');
        if (card) {
          card.style.opacity = '0';
          card.style.transform = 'scale(0.9)';
          card.style.transition = 'all 0.3s ease';
          setTimeout(() => {
            card.remove();
            const remaining = document.querySelectorAll('.wishlist-card-item').length;
            const countHdr = document.getElementById('wishlistCountHeader');
            if (countHdr) countHdr.textContent = remaining;
            if (remaining === 0) {
              const emptyBox = document.getElementById('guestEmptyWishlist');
              if (emptyBox) emptyBox.style.display = 'block';
            }
          }, 300);
        }
      } else {
        // Add to guest wishlist
        guestWishlist.push(numId);
        document.querySelectorAll(`.wishlist-btn[data-id="${designId}"], .wishlist-round-btn[data-id="${designId}"]`).forEach(b => {
          b.classList.add('active');
          const icon = b.querySelector('i');
          if (icon) icon.className = 'fa-solid fa-heart';
        });
        showToast('Saved to your wishlist!', 'success');
      }

      try {
        localStorage.setItem('aruvi_guest_wishlist', JSON.stringify(guestWishlist));
      } catch (saveErr) {
        console.warn('localStorage save warning:', saveErr);
      }

      updateWishlistBadges(guestWishlist.length);
      const countHdr = document.getElementById('wishlistCountHeader');
      if (countHdr) countHdr.textContent = guestWishlist.length;

    } catch (guestErr) {
      console.error('Guest wishlist error:', guestErr);
      showToast('Could not save to wishlist. Please check browser storage.', 'error');
    } finally {
      btn.dataset.processing = '0';
    }
  }
});

// ---------------------------------------------------------------------------
// 1b. INSTANT ADD TO CART (Wishlist Cards, Listing Cards, Search)
// ---------------------------------------------------------------------------
document.addEventListener('click', async function (e) {
  const cartBtn = e.target.closest('.card-cart-btn-instant');
  if (!cartBtn) return;

  e.preventDefault();
  e.stopPropagation();

  if (cartBtn.disabled || cartBtn.classList.contains('adding') || cartBtn.dataset.processing === '1') return;
  cartBtn.dataset.processing = '1';
  cartBtn.classList.add('adding');

  const designId = cartBtn.dataset.id;
  if (!designId) {
    cartBtn.dataset.processing = '0';
    cartBtn.classList.remove('adding');
    return;
  }

  const originalHtml = cartBtn.innerHTML;
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';

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
      cartBtn.innerHTML = '<i class="fa-solid fa-check" style="color: #2E7D32;"></i> Added';
      if (typeof data.cartCount !== 'undefined') {
        updateCartBadges(data.cartCount);
      }
      showToast(data.message || 'Added to cart!', 'success');
      setTimeout(() => {
        cartBtn.innerHTML = originalHtml;
        cartBtn.classList.remove('adding');
        cartBtn.dataset.processing = '0';
      }, 1500);
    } else {
      cartBtn.innerHTML = originalHtml;
      cartBtn.classList.remove('adding');
      cartBtn.dataset.processing = '0';
      showToast(data.message || 'Failed to add item to cart', 'error');
    }
  } catch (err) {
    console.error('Instant cart error:', err);
    cartBtn.innerHTML = originalHtml;
    cartBtn.classList.remove('adding');
    cartBtn.dataset.processing = '0';
    showToast('Failed to add item to cart. Please try again.', 'error');
  }
});

// ---------------------------------------------------------------------------
// 2. PAGE INITIALIZATION (Each block wrapped in try/catch for rock-solid safety)
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {

  // Safety: Preloader check - ensure preloader is never stuck blocking clicks
  try {
    const pl = document.getElementById('aruvi-preloader');
    if (pl) {
      setTimeout(() => {
        if (pl && pl.parentNode && (pl.classList.contains('aruvi-pl-exit-fade') || pl.getAttribute('aria-hidden') === 'true')) {
          pl.style.pointerEvents = 'none';
          pl.style.display = 'none';
          if (pl.parentNode) pl.parentNode.removeChild(pl);
        }
      }, 3500);
    }
  } catch (_) {}

  // 1. Wishlist Sync on Page Load (Guest state hydration & Logged-in merge)
  try {
    const isUserLoggedIn = (typeof window.isUserLoggedIn !== 'undefined') ? Boolean(window.isUserLoggedIn) : false;
    let guestWishlist = [];
    try {
      const raw = localStorage.getItem('aruvi_guest_wishlist');
      guestWishlist = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(guestWishlist)) guestWishlist = [];
    } catch (_) {
      guestWishlist = [];
    }

    if (isUserLoggedIn) {
      // If user is logged in and has pending guest wishlist items, auto-merge to DB
      if (guestWishlist.length > 0) {
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
        fetch('/api/wishlist/merge', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
            'Accept': 'application/json'
          },
          body: JSON.stringify({ design_ids: guestWishlist, _csrf: csrfToken })
        })
          .then(res => res.json())
          .then(data => {
            if (data.success) {
              try { localStorage.removeItem('aruvi_guest_wishlist'); } catch (_) {}
              if (typeof data.count !== 'undefined') {
                updateWishlistBadges(data.count);
              }
            }
          })
          .catch(err => console.warn('Wishlist merge warning:', err));
      }
    } else {
      // Guest user: Hydrate wishlist badge and card heart states on page load
      if (guestWishlist.length > 0) {
        updateWishlistBadges(guestWishlist.length);
        guestWishlist.forEach(id => {
          document.querySelectorAll(`.wishlist-btn[data-id="${id}"], .wishlist-round-btn[data-id="${id}"]`).forEach(btn => {
            btn.classList.add('active');
            const icon = btn.querySelector('i');
            if (icon) icon.className = 'fa-solid fa-heart';
          });
        });
      }
    }
  } catch (wishInitErr) {
    console.warn('Wishlist init notice:', wishInitErr);
  }

  // 2. Image Thumbnail Switcher
  try {
    const mainImage = document.getElementById('mainProductImage') || document.getElementById('mainDisplayImg');
    const thumbs = document.querySelectorAll('.thumb-item');

    if (mainImage && thumbs.length > 0) {
      thumbs.forEach(thumb => {
        thumb.addEventListener('click', function () {
          thumbs.forEach(t => t.classList.remove('active'));
          this.classList.add('active');
          const newSrc = this.dataset.src || this.querySelector('img')?.src;
          if (newSrc && mainImage) mainImage.src = newSrc;
        });
      });
    }
  } catch (thumbErr) {
    console.warn('Thumbnail switcher notice:', thumbErr);
  }

  // 3. Add to Cart AJAX (Forms with .ajax-add-to-cart)
  try {
    const cartForms = document.querySelectorAll('.ajax-add-to-cart');
    cartForms.forEach(form => {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        const formData = new FormData(this);
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';

        try {
          const response = await fetch('/cart/add', {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'X-CSRF-Token': csrfToken
            },
            body: new URLSearchParams(formData)
          });
          const data = await response.json();

          if (data.success) {
            if (typeof data.cartCount !== 'undefined') {
              updateCartBadges(data.cartCount);
            }
            showToast(data.message || 'Added to cart!', 'success');
          } else {
            showToast(data.message || 'Failed to add item to cart', 'error');
          }
        } catch (err) {
          console.error('Add to cart error:', err);
          showToast('Failed to add item to cart. Please try again.', 'error');
        }
      });
    });
  } catch (cartFormErr) {
    console.warn('Cart forms init notice:', cartFormErr);
  }

  // 4. Mobile Navigation Drawer Toggle
  try {
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const closeMobileMenu = document.getElementById('closeMobileMenu');
    const mobileNavDrawer = document.getElementById('mobileNavDrawer');
    const mobileDrawerOverlay = document.getElementById('mobileDrawerOverlay');

    function openDrawer() {
      if (mobileNavDrawer && mobileDrawerOverlay) {
        mobileNavDrawer.classList.add('open');
        mobileDrawerOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
      }
    }

    function closeDrawer() {
      if (mobileNavDrawer && mobileDrawerOverlay) {
        mobileNavDrawer.classList.remove('open');
        mobileDrawerOverlay.classList.remove('active');
        document.body.style.overflow = '';
      }
    }

    if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', openDrawer);
    if (closeMobileMenu) closeMobileMenu.addEventListener('click', closeDrawer);
    if (mobileDrawerOverlay) mobileDrawerOverlay.addEventListener('click', closeDrawer);
  } catch (drawerErr) {
    console.warn('Mobile drawer init notice:', drawerErr);
  }

  // 5. Grid / List View Toggle Controller (Task 2)
  try {
    const gridEl = document.getElementById('designsGrid') || document.querySelector('.grid-4-strict');
    const toggleBtns = document.querySelectorAll('.view-btn');

    // Determine initial view: URL param ?view=list > localStorage > default 'grid'
    const urlParams = new URLSearchParams(window.location.search);
    let viewMode = urlParams.get('view');
    if (!viewMode || (viewMode !== 'list' && viewMode !== 'grid')) {
      try {
        viewMode = localStorage.getItem('aruvi_view_mode');
      } catch (_) {}
    }
    if (viewMode !== 'list' && viewMode !== 'grid') {
      viewMode = 'grid';
    }

    function applyViewMode(mode, updateUrl = false) {
      const activeGrid = document.getElementById('designsGrid') || document.querySelector('.grid-4-strict');
      if (activeGrid) {
        if (mode === 'list') {
          activeGrid.classList.add('list-view-active');
        } else {
          activeGrid.classList.remove('list-view-active');
        }
      }

      // Update all toggle buttons (mobile and desktop)
      document.querySelectorAll('.view-btn').forEach(btn => {
        const btnView = btn.getAttribute('data-view') || (btn.title && btn.title.toLowerCase().includes('list') ? 'list' : 'grid');
        const isActive = (btnView === mode);
        if (isActive) {
          btn.classList.add('active');
          btn.setAttribute('aria-pressed', 'true');
        } else {
          btn.classList.remove('active');
          btn.setAttribute('aria-pressed', 'false');
        }
      });

      // Save to localStorage
      try {
        localStorage.setItem('aruvi_view_mode', mode);
      } catch (_) {}

      // Update URL query param ?view= without reload or scroll loss
      if (updateUrl && window.history && window.history.replaceState) {
        try {
          const currentUrl = new URL(window.location.href);
          if (mode === 'list') {
            currentUrl.searchParams.set('view', 'list');
          } else {
            currentUrl.searchParams.delete('view');
          }
          window.history.replaceState(null, '', currentUrl.toString());
        } catch (_) {}
      }
    }

    // Apply initial view mode
    applyViewMode(viewMode, false);

    // Attach click listeners to all view buttons
    toggleBtns.forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        const targetView = this.getAttribute('data-view') || (this.title && this.title.toLowerCase().includes('list') ? 'list' : 'grid');
        applyViewMode(targetView, true);
      });
    });

    // Expose helpers globally
    window.aruviApplyViewMode = applyViewMode;
    window.aruviGetCurrentViewMode = () => {
      try {
        return localStorage.getItem('aruvi_view_mode') || 'grid';
      } catch (_) {
        return 'grid';
      }
    };
  } catch (viewToggleErr) {
    console.warn('View toggle init notice:', viewToggleErr);
  }
});

// ---------------------------------------------------------------------------
// 3. GLOBAL TOAST NOTIFICATION HELPER
// ---------------------------------------------------------------------------
function showToast(message, type = 'success') {
  try {
    // Dismiss any existing toast with same text to prevent stacking
    const existing = document.querySelectorAll('.aruvi-toast-notification');
    existing.forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = `alert alert-${type === 'success' ? 'success' : (type === 'info' ? 'info' : 'error')} aruvi-toast-notification`;
    toast.style.position = 'fixed';
    toast.style.bottom = '24px';
    toast.style.right = '24px';
    toast.style.zIndex = '999999';
    toast.style.boxShadow = '0 10px 28px rgba(35, 24, 21, 0.22)';
    toast.style.borderRadius = '12px';
    toast.style.padding = '0.85rem 1.3rem';
    toast.style.fontSize = '0.92rem';
    toast.style.fontWeight = '500';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '10px';
    toast.style.maxWidth = '90vw';
    toast.style.cursor = 'pointer';
    toast.style.animation = 'fadeInUp 0.3s ease';

    const iconCls = type === 'success' 
      ? 'fa-circle-check' 
      : (type === 'info' ? 'fa-circle-info' : 'fa-circle-exclamation');

    toast.innerHTML = `<i class="fa-solid ${iconCls}" style="font-size: 1.1rem; flex-shrink: 0;"></i> <span>${message}</span>`;
    toast.addEventListener('click', () => toast.remove());

    document.body.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }
    }, 3800);
  } catch (e) {
    console.warn('Toast notice:', e);
  }
}
