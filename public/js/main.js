document.addEventListener('DOMContentLoaded', () => {
  // 1. Image Thumbnail Switcher
  const mainImage = document.getElementById('mainProductImage');
  const thumbs = document.querySelectorAll('.thumb-item');

  if (mainImage && thumbs.length > 0) {
    thumbs.forEach(thumb => {
      thumb.addEventListener('click', function () {
        thumbs.forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        const newSrc = this.dataset.src || this.querySelector('img').src;
        mainImage.src = newSrc;
      });
    });
  }

  // 2. Wishlist Toggle AJAX
  const wishlistButtons = document.querySelectorAll('.wishlist-btn');
  wishlistButtons.forEach(btn => {
    btn.addEventListener('click', async function (e) {
      e.preventDefault();
      const designId = this.dataset.id;
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

      try {
        const response = await fetch('/user/wishlist/toggle', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken
          },
          body: JSON.stringify({ design_id: designId })
        });
        const data = await response.json();

        if (data.success) {
          if (data.status === 'added') {
            this.classList.add('active');
            this.querySelector('i').className = 'fa-solid fa-heart';
          } else {
            this.classList.remove('active');
            this.querySelector('i').className = 'fa-regular fa-heart';
          }
          showToast(data.message, 'success');
        } else {
          showToast(data.message || 'Please log in to use wishlist.', 'error');
        }
      } catch (err) {
        console.error('Wishlist error:', err);
      }
    });
  });

  // 3. Add to Cart AJAX
  const cartForms = document.querySelectorAll('.ajax-add-to-cart');
  cartForms.forEach(form => {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const formData = new FormData(this);
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

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
          const badge = document.querySelector('.cart-badge');
          if (badge) badge.textContent = data.cartCount;
          showToast(data.message, 'success');
        } else {
          showToast(data.message || 'Failed to add item to cart', 'error');
        }
      } catch (err) {
        console.error('Add to cart error:', err);
      }
    });
  });

  // 4. Mobile Navigation Drawer Toggle
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
});

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `alert alert-${type === 'success' ? 'success' : 'error'}`;
  toast.style.position = 'fixed';
  toast.style.bottom = '20px';
  toast.style.right = '20px';
  toast.style.zIndex = '9999';
  toast.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)';
  toast.innerHTML = `<i class="fa-solid fa-${type === 'success' ? 'circle-check' : 'circle-exclamation'}"></i> ${message}`;

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}
