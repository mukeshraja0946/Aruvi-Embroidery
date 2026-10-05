document.addEventListener('DOMContentLoaded', () => {
  const checkoutForm = document.getElementById('checkoutForm');
  const payBtn = document.getElementById('payBtn');

  if (checkoutForm && payBtn) {
    checkoutForm.addEventListener('submit', async function (e) {
      e.preventDefault();

      // Requirement 4: Require Login
      if (typeof window.isUserLoggedIn !== 'undefined' && !window.isUserLoggedIn) {
        if (typeof openLoginModal === 'function') {
          openLoginModal(() => {
            checkoutForm.requestSubmit();
          });
          return;
        }
      }

      payBtn.disabled = true;
      payBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating Payment Order...';

      const formData = new FormData(checkoutForm);
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

      try {
        // Step 1: Create Razorpay Order on Backend (Server-Side Price Calculation)
        const response = await fetch('/api/payment/create-order', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-CSRF-Token': csrfToken
          },
          body: new URLSearchParams(formData)
        });

        const data = await response.json();

        if (data.requireLogin) {
          payBtn.disabled = false;
          payBtn.innerHTML = '<i class="fa-solid fa-lock"></i> Pay & Download Designs <i class="fa-solid fa-arrow-right"></i>';
          if (typeof openLoginModal === 'function') {
            openLoginModal(() => checkoutForm.requestSubmit());
          } else {
            window.location.href = '/auth/login';
          }
          return;
        }

        if (!data.success) {
          alert(data.message || 'Failed to create payment order. Please try again.');
          payBtn.disabled = false;
          payBtn.innerHTML = `<i class="fa-solid fa-lock"></i> Pay ₹${data.finalTotal || ''} & Download Designs <i class="fa-solid fa-arrow-right"></i>`;
          return;
        }

        // Step 2: Launch Official Razorpay Standard Checkout Popup
        const options = {
          key: data.key,
          amount: data.amount,
          currency: data.currency || 'INR',
          name: 'Aruvi Embroidery Studio',
          description: 'Digital Embroidery Designs Instant Access',
          image: '/public/images/logo.jpg',
          // Only pass order_id if it is a real Order ID created on Razorpay servers (starts with 'order_' and NOT 'order_test_')
          ...(data.razorpayOrderId && !data.razorpayOrderId.startsWith('order_test_') ? { order_id: data.razorpayOrderId } : {}),
          handler: function (response) {
            payBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying Payment...';
            verifyAndCompleteOrder({
              order_id: data.orderId,
              razorpay_order_id: response.razorpay_order_id || data.razorpayOrderId,
              razorpay_payment_id: response.razorpay_payment_id || ('pay_captured_' + Date.now()),
              razorpay_signature: response.razorpay_signature,
              csrfToken
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
          config: {
            display: {
              blocks: {
                upi: {
                  name: 'Pay via UPI / QR',
                  instruments: [
                    {
                      method: 'upi'
                    }
                  ]
                }
              },
              sequence: ['block.upi']
            }
          },
          modal: {
            ondismiss: function() {
              payBtn.disabled = false;
              payBtn.innerHTML = `<i class="fa-solid fa-lock"></i> Pay ₹${data.finalTotal || ''} & Download Designs <i class="fa-solid fa-arrow-right"></i>`;
            }
          }
        };

        if (typeof Razorpay !== 'undefined') {
          const rzpInstance = new Razorpay(options);

          rzpInstance.on('payment.failed', function (resp) {
            console.error('Razorpay payment failed callback:', resp.error);
            const errMsg = (resp.error && resp.error.description) ? resp.error.description : 'Payment could not be completed. Please try again.';
            alert(errMsg);
            payBtn.disabled = false;
            payBtn.innerHTML = `<i class="fa-solid fa-lock"></i> Pay ₹${data.finalTotal || ''} & Download Designs <i class="fa-solid fa-arrow-right"></i>`;
          });

          rzpInstance.open();
        } else {
          alert('Razorpay Payment Gateway script not loaded. Please refresh page.');
          payBtn.disabled = false;
          payBtn.innerHTML = `<i class="fa-solid fa-lock"></i> Pay ₹${data.finalTotal || ''} & Download Designs <i class="fa-solid fa-arrow-right"></i>`;
        }
      } catch (err) {
        console.error('Razorpay checkout error:', err);
        alert('An error occurred during order submission.');
        payBtn.disabled = false;
        payBtn.innerHTML = '<i class="fa-solid fa-lock"></i> Pay & Download Designs <i class="fa-solid fa-arrow-right"></i>';
      }
    });
  }
});

async function verifyAndCompleteOrder({ order_id, razorpay_order_id, razorpay_payment_id, razorpay_signature, csrfToken }) {
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
      })
    });

    const data = await response.json();
    if (data.success && data.redirectUrl) {
      window.location.href = data.redirectUrl;
    } else {
      alert(data.message || 'Payment verification failed.');
      window.location.reload();
    }
  } catch (e) {
    console.error('Verification error:', e);
    alert('Payment verification error.');
    window.location.reload();
  }
}
