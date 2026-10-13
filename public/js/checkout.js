document.addEventListener('DOMContentLoaded', () => {
  const checkoutForm = document.getElementById('checkoutForm');
  const payBtn = document.getElementById('payBtn');

  if (checkoutForm && payBtn) {
    const originalBtnHtml = payBtn.innerHTML;
    let isSubmitting = false;

    // Toast helper with fallback
    function displayToast(msg, type = 'error') {
      if (typeof showToast === 'function') {
        showToast(msg, type);
      } else {
        const toast = document.createElement('div');
        toast.className = `alert alert-${type === 'success' ? 'success' : 'error'}`;
        toast.style.position = 'fixed';
        toast.style.bottom = '20px';
        toast.style.right = '20px';
        toast.style.zIndex = '99999';
        toast.style.maxWidth = '360px';
        toast.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)';
        toast.style.borderRadius = '8px';
        toast.style.padding = '12px 16px';
        toast.style.background = type === 'success' ? '#2E7D32' : '#C62828';
        toast.style.color = '#FFFFFF';
        toast.style.fontSize = '0.85rem';
        toast.innerHTML = `<i class="fa-solid fa-${type === 'success' ? 'circle-check' : 'circle-exclamation'}"></i> ${msg}`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 5000);
      }
    }

    function resetButton() {
      isSubmitting = false;
      payBtn.disabled = false;
      payBtn.innerHTML = originalBtnHtml;
    }

    checkoutForm.addEventListener('submit', async function (e) {
      e.preventDefault();

      if (isSubmitting) return; // Prevent double submission

      // Requirement: Require Login
      if (typeof window.isUserLoggedIn !== 'undefined' && !window.isUserLoggedIn) {
        if (typeof openLoginModal === 'function') {
          openLoginModal(() => checkoutForm.requestSubmit());
          return;
        }
      }

      isSubmitting = true;
      payBtn.disabled = true;
      payBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating Payment Order...';

      const formData = new FormData(checkoutForm);
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

      // 15-second timeout via AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      try {
        const response = await fetch('/api/payment/create-order', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-CSRF-Token': csrfToken
          },
          body: new URLSearchParams(formData),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        const data = await response.json();

        if (data.requireLogin) {
          resetButton();
          if (typeof openLoginModal === 'function') {
            openLoginModal(() => checkoutForm.requestSubmit());
          } else {
            window.location.href = '/auth/login';
          }
          return;
        }

        if (!data.success) {
          const errDetail = data.referenceId ? ` (${data.referenceId})` : '';
          displayToast((data.message || 'Failed to create payment order. Please try again.') + errDetail, 'error');
          resetButton();
          return;
        }

        // 100% Free Order (e.g. 100% discount coupon)
        if (data.isFreeOrder && data.redirectUrl) {
          payBtn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Order Placed! Redirecting...';
          window.location.href = data.redirectUrl;
          return;
        }

        // Launch Official Razorpay Standard Checkout Popup
        const options = {
          key: data.key,
          amount: data.amount,
          currency: data.currency || 'INR',
          name: 'Aruvi Embroidery Studio',
          description: 'Digital Embroidery Designs Instant Access',
          image: '/public/images/logo.jpg',
          order_id: data.razorpayOrderId,
          handler: function (response) {
            payBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying Payment...';
            verifyAndCompleteOrder({
              order_id: data.orderId,
              razorpay_order_id: response.razorpay_order_id || data.razorpayOrderId,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              csrfToken,
              resetBtn: resetButton
            });
          },
          prefill: {
            name: data.customerName || '',
            email: data.customerEmail || '',
            contact: data.customerPhone || ''
          },
          theme: {
            color: '#B8402A'
          },
          modal: {
            ondismiss: function () {
              resetButton();
            }
          }
        };

        if (typeof Razorpay !== 'undefined') {
          const rzpInstance = new Razorpay(options);

          rzpInstance.on('payment.failed', function (resp) {
            console.error('Razorpay payment failed callback:', resp.error);
            const errMsg = (resp.error && resp.error.description) 
              ? resp.error.description 
              : 'Payment could not be completed. Please try again.';
            displayToast(errMsg, 'error');
            resetButton();
          });

          rzpInstance.open();
        } else {
          displayToast('Razorpay Payment Gateway script could not load. Please check your network and refresh.', 'error');
          resetButton();
        }
      } catch (err) {
        clearTimeout(timeoutId);
        console.error('Razorpay checkout submission error:', err);
        if (err.name === 'AbortError') {
          displayToast('Payment order creation timed out after 15 seconds. Please check your internet connection.', 'error');
        } else {
          displayToast('An error occurred during order submission. Please refresh and try again.', 'error');
        }
        resetButton();
      }
    });
  }
});

async function verifyAndCompleteOrder({ order_id, razorpay_order_id, razorpay_payment_id, razorpay_signature, csrfToken, resetBtn }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch('/api/payment/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({
        order_id,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const data = await response.json();
    if (data.success && data.redirectUrl) {
      window.location.href = data.redirectUrl;
    } else {
      if (typeof showToast === 'function') {
        showToast(data.message || 'Payment verification failed.', 'error');
      }
      if (resetBtn) resetBtn();
      setTimeout(() => window.location.reload(), 2500);
    }
  } catch (e) {
    clearTimeout(timeoutId);
    console.error('Verification error:', e);
    if (typeof showToast === 'function') {
      showToast('Payment verification connection error. If your card was debited, your order will be activated shortly.', 'error');
    }
    if (resetBtn) resetBtn();
    setTimeout(() => window.location.reload(), 3000);
  }
}
