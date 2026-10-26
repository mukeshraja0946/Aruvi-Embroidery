/**
 * Aruvi Embroidery — Admin Dashboard Data Reset Controller
 * Handles selective clearing of test/sample data with live counts,
 * multi-step safety confirmation, automatic pre-reset backup, and audit logging.
 */

(function () {
  'use strict';

  // State
  let liveCounts = null;
  let currentPreview = null;
  let currentStep = 1;

  // DOM Elements
  const modal = document.getElementById('resetDataModal');
  const btnOpenModal = document.getElementById('btnOpenResetModal');
  const btnCloseModal = document.getElementById('closeResetModalBtn');
  const btnCancelReset = document.getElementById('btnCancelReset');

  // Steps
  const step1 = document.getElementById('resetStep1');
  const step2 = document.getElementById('resetStep2');
  const step3 = document.getElementById('resetStep3');
  const stepResult = document.getElementById('resetStepResult');

  // Step Indicators
  const stepBadge1 = document.getElementById('stepBadge1');
  const stepBadge2 = document.getElementById('stepBadge2');
  const stepBadge3 = document.getElementById('stepBadge3');

  // Step 1 Controls
  const chkEnableOrders = document.getElementById('chkEnableOrders');
  const ordersOptionsWrapper = document.getElementById('ordersOptionsWrapper');
  const scopeRadios = document.querySelectorAll('input[name="resetOrdersScope"]');
  const ordersDateWrapper = document.getElementById('ordersDateWrapper');
  const ordersDateInput = document.getElementById('resetOrdersDateInput');
  const chkRestartOrderNumbers = document.getElementById('resetRestartOrderNumbers');

  const chkCustomers = document.getElementById('resetClearCustomers');
  const chkOperational = document.getElementById('resetClearOperational');
  const chkStats = document.getElementById('resetClearStats');
  const chkDemoDesigns = document.getElementById('resetClearDemoDesigns');

  const chkDangerAllDesigns = document.getElementById('resetClearAllDesignsDanger');
  const dangerConfirmWrapper = document.getElementById('dangerConfirmWrapper');
  const chkDangerConfirm = document.getElementById('confirmDangerDesigns');

  const btnToStep2 = document.getElementById('btnToStep2');
  const btnBackToStep1 = document.getElementById('btnBackToStep1');
  const btnToStep3 = document.getElementById('btnToStep3');
  const btnBackToStep2 = document.getElementById('btnBackToStep2');
  const btnExecuteReset = document.getElementById('btnExecuteReset');

  // Step 2 Controls
  const previewContent = document.getElementById('resetPreviewContent');
  const livePaidWarningContainer = document.getElementById('livePaidWarningContainer');
  const chkDeleteRealPaidOrders = document.getElementById('deleteRealPaidOrdersCheck');

  // Step 3 Controls
  const inputConfirmText = document.getElementById('confirmResetTextInput');
  const inputPassword = document.getElementById('adminPasswordInput');
  const chkUnderstand = document.getElementById('confirmUnderstandCheck');
  const executingSpinner = document.getElementById('resetExecutingSpinner');
  const confirmErrorMessage = document.getElementById('confirmErrorMessage');

  // Result Controls
  const resultMessage = document.getElementById('resetSuccessMessage');
  const btnDownloadSql = document.getElementById('btnDownloadBackupSql');
  const btnDownloadCsv = document.getElementById('btnDownloadBackupCsv');
  const btnReload = document.getElementById('btnReloadDashboard');

  // CSRF Token Helper
  function getCsrfToken() {
    const metaTag = document.querySelector('meta[name="csrf-token"]');
    if (metaTag) return metaTag.getAttribute('content');
    const inputToken = document.querySelector('input[name="_csrf"]');
    if (inputToken) return inputToken.value;
    const cookieMatch = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
    if (cookieMatch) return decodeURIComponent(cookieMatch[1]);
    return '';
  }

  // Toast Notification Helper
  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `admin-reset-toast toast-${type}`;
    toast.innerHTML = `
      <i class="fa-solid fa-${type === 'success' ? 'circle-check' : 'triangle-exclamation'}"></i>
      <span>${message}</span>
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('visible');
    }, 10);
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  }

  // Set Active Step
  function setStep(stepNumber) {
    currentStep = stepNumber;
    step1.style.display = stepNumber === 1 ? 'block' : 'none';
    step2.style.display = stepNumber === 2 ? 'block' : 'none';
    step3.style.display = stepNumber === 3 ? 'block' : 'none';
    stepResult.style.display = stepNumber === 4 ? 'block' : 'none';

    // Update Progress Badges
    [stepBadge1, stepBadge2, stepBadge3].forEach((badge, idx) => {
      if (!badge) return;
      badge.classList.remove('active', 'completed');
      if (idx + 1 === stepNumber) {
        badge.classList.add('active');
      } else if (idx + 1 < stepNumber) {
        badge.classList.add('completed');
      }
    });

    if (stepNumber === 1) {
      validateStep1();
    } else if (stepNumber === 2) {
      validateStep2();
    } else if (stepNumber === 3) {
      validateStep3();
    }
  }

  // Fetch Live Counts from Server
  async function loadLiveCounts() {
    try {
      const res = await fetch('/api/admin/reset/counts', {
        headers: { 'Accept': 'application/json' }
      });
      const data = await res.json();
      if (data.success && data.counts) {
        liveCounts = data.counts;
        updateLiveCountBadges(liveCounts);
      }
    } catch (err) {
      console.warn('[Dashboard Reset] Failed to fetch live counts:', err.message);
    }
  }

  // Update Badge Counts in Step 1
  function updateLiveCountBadges(counts) {
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setTxt('cntTotalOrders', counts.orders.total);
    setTxt('cntTestModeOrders', counts.orders.testMode);
    setTxt('cntUnpaidOrders', counts.orders.unpaidOrPending);
    setTxt('cntLivePaidOrders', counts.orders.livePaid);

    setTxt('cntTestCustomers', counts.customers.testCustomers);
    setTxt('cntAdminCustomers', counts.customers.adminCount);

    setTxt('cntCustomOrders', counts.operational.customOrders);
    setTxt('cntContactMessages', counts.operational.contactMessages);
    setTxt('cntReviews', counts.operational.reviews);
    setTxt('cntWishlists', counts.operational.wishlists);
    setTxt('cntCarts', counts.operational.carts);
    setTxt('cntCoupons', counts.operational.couponsUsed);
    setTxt('cntSubscribers', counts.operational.newsletterSubscribers);
    setTxt('cntEmailLogs', counts.operational.emailLogs);

    setTxt('cntDownloads', counts.statistics.totalDownloads);
    setTxt('cntActivityLogs', counts.statistics.activityLogs);
    setTxt('cntImportJobs', counts.statistics.importJobs);
    setTxt('cntStitchPriceLogs', counts.statistics.stitchPriceLogs);

    setTxt('cntDemoDesigns', counts.demoDesigns);
    setTxt('cntDangerAllDesigns', counts.dangerAllDesigns);
  }

  // Validate Step 1 Selections
  function validateStep1() {
    let hasAnySelection = false;

    if (chkEnableOrders && chkEnableOrders.checked) {
      hasAnySelection = true;
    }
    if (chkCustomers && chkCustomers.checked) hasAnySelection = true;
    if (chkOperational && chkOperational.checked) hasAnySelection = true;
    if (chkStats && chkStats.checked) hasAnySelection = true;
    if (chkDemoDesigns && chkDemoDesigns.checked) hasAnySelection = true;

    if (chkDangerAllDesigns && chkDangerAllDesigns.checked) {
      if (chkDangerConfirm && chkDangerConfirm.checked) {
        hasAnySelection = true;
      } else {
        // Danger selected but not confirmed
        btnToStep2.disabled = true;
        return;
      }
    }

    btnToStep2.disabled = !hasAnySelection;
  }

  // Gather Current Selection Payload
  function getSelectedPayload() {
    let ordersScope = 'none';
    if (chkEnableOrders && chkEnableOrders.checked) {
      const checkedRadio = document.querySelector('input[name="resetOrdersScope"]:checked');
      ordersScope = checkedRadio ? checkedRadio.value : 'test_mode';
    }

    return {
      ordersScope,
      ordersBeforeDate: ordersDateInput ? ordersDateInput.value : null,
      restartOrderNumbers: chkRestartOrderNumbers ? chkRestartOrderNumbers.checked : false,
      clearCustomers: chkCustomers ? chkCustomers.checked : false,
      clearOperational: chkOperational ? chkOperational.checked : false,
      clearStats: chkStats ? chkStats.checked : false,
      clearDemoDesigns: chkDemoDesigns ? chkDemoDesigns.checked : false,
      clearAllDesignsDanger: (chkDangerAllDesigns && chkDangerAllDesigns.checked && chkDangerConfirm && chkDangerConfirm.checked),
      deleteRealPaidOrders: chkDeleteRealPaidOrders ? chkDeleteRealPaidOrders.checked : false
    };
  }

  // Load and Render Step 2 Preview
  async function loadPreview() {
    const payload = getSelectedPayload();
    previewContent.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--admin-text-muted);"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p style="margin-top: 8px;">Calculating preview impact...</p></div>';

    try {
      const res = await fetch('/api/admin/reset/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken()
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to generate preview.');
      }

      currentPreview = data.preview;
      renderPreview(currentPreview);
      validateStep2();
    } catch (err) {
      previewContent.innerHTML = `<div class="alert alert-danger" style="margin: 1rem 0;"><i class="fa-solid fa-circle-exclamation"></i> ${err.message}</div>`;
      btnToStep3.disabled = true;
    }
  }

  // Render Preview Items
  function renderPreview(p) {
    let itemsHtml = `
      <div class="reset-preview-summary-box">
        <h4 style="margin: 0 0 10px; font-size: 0.95rem; color: var(--admin-text-dark); display: flex; align-items: center; gap: 8px;">
          <i class="fa-solid fa-clipboard-list" style="color: var(--admin-primary);"></i>
          Summary of Items to be Permanently Removed
        </h4>
        <ul class="reset-preview-list">
          <li><strong>Orders:</strong> ${p.ordersToDelete} orders (${p.paymentsToDelete} payment records)</li>
          <li><strong>Customers:</strong> ${p.customersToDelete} test customer accounts (Admins protected)</li>
          <li><strong>Operational Records:</strong> ${p.customOrdersToDelete} custom requests, ${p.contactMessagesToDelete} enquiries, ${p.reviewsToDelete} reviews, ${p.wishlistsToDelete} wishlists, ${p.cartsToDelete} cart items</li>
          <li><strong>Counters & Logs:</strong> ${p.downloadsResetCount} design download counters reset, ${p.activityLogsToDelete} audit logs, ${p.importJobsToDelete} import jobs, ${p.stitchPriceLogsToDelete} tool logs</li>
          <li><strong>Designs:</strong> ${p.demoDesignsToDelete} demo designs ${p.dangerAllDesignsToDelete > 0 ? `+ <strong>${p.dangerAllDesignsToDelete} ALL CATALOG DESIGNS</strong>` : ''}</li>
        </ul>
      </div>

      <div class="reset-preview-financial-box">
        <div style="font-size: 0.85rem; font-weight: 600; color: var(--admin-text-dark); margin-bottom: 6px;">
          Financial Revenue Impact:
        </div>
        <div style="display: flex; align-items: baseline; gap: 12px; font-size: 0.9rem;">
          <span>Current Paid Revenue: <strong>₹${p.currentRealRevenue.toLocaleString('en-IN')}</strong></span>
          <i class="fa-solid fa-arrow-right" style="color: var(--admin-text-muted); font-size: 0.75rem;"></i>
          <span style="color: ${p.newProjectedRevenue === 0 ? '#DC2626' : '#2E7D32'}; font-weight: 700;">
            Projected Revenue After Reset: ₹${p.newProjectedRevenue.toLocaleString('en-IN')}
          </span>
        </div>
      </div>
    `;

    previewContent.innerHTML = itemsHtml;

    // Show or hide the Live Paid Orders warning
    if (p.hasLivePaidOrdersInScope) {
      livePaidWarningContainer.style.display = 'block';
      const warningTextEl = document.getElementById('livePaidWarningText');
      if (warningTextEl) {
        warningTextEl.textContent = `Warning: Selected scope includes ${p.livePaidOrdersInScopeCount} REAL paid order(s) totalling ₹${p.livePaidOrdersInScopeAmount.toLocaleString('en-IN')}. This is real financial data!`;
      }
    } else {
      livePaidWarningContainer.style.display = 'none';
      if (chkDeleteRealPaidOrders) chkDeleteRealPaidOrders.checked = false;
    }
  }

  // Validate Step 2
  function validateStep2() {
    if (!currentPreview) {
      btnToStep3.disabled = true;
      return;
    }

    if (currentPreview.hasLivePaidOrdersInScope) {
      btnToStep3.disabled = !(chkDeleteRealPaidOrders && chkDeleteRealPaidOrders.checked);
    } else {
      btnToStep3.disabled = false;
    }
  }

  // Validate Step 3 Inputs
  function validateStep3() {
    const textValid = inputConfirmText && inputConfirmText.value.trim().toUpperCase() === 'RESET';
    const passValid = inputPassword && inputPassword.value.trim().length > 0;
    const understandValid = chkUnderstand && chkUnderstand.checked;

    btnExecuteReset.disabled = !(textValid && passValid && understandValid);
  }

  // Execute Reset
  async function executeReset() {
    confirmErrorMessage.style.display = 'none';
    btnExecuteReset.disabled = true;
    executingSpinner.style.display = 'flex';

    const payload = {
      ...getSelectedPayload(),
      password: inputPassword.value,
      confirmResetText: inputConfirmText.value.trim(),
      confirmUnderstand: chkUnderstand.checked
    };

    try {
      const res = await fetch('/api/admin/reset/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken()
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || 'Reset operation failed.');
      }

      // Success
      setStep(4);
      resultMessage.textContent = data.message;

      if (data.backup) {
        btnDownloadSql.href = `/admin/reset/backup/download/${data.backup.filename}`;
        btnDownloadSql.style.display = 'inline-flex';
        if (data.backup.csvFilename) {
          btnDownloadCsv.href = `/admin/reset/backup/download/${data.backup.csvFilename}`;
          btnDownloadCsv.style.display = 'inline-flex';
        }
      }

      showToast(data.message, 'success');
    } catch (err) {
      confirmErrorMessage.textContent = err.message;
      confirmErrorMessage.style.display = 'block';
      showToast(err.message, 'error');
      validateStep3();
    } finally {
      executingSpinner.style.display = 'none';
    }
  }

  // Open Modal
  function openModal() {
    if (!modal) return;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Reset controls
    if (chkEnableOrders) chkEnableOrders.checked = false;
    if (ordersOptionsWrapper) ordersOptionsWrapper.style.display = 'none';
    if (ordersDateWrapper) ordersDateWrapper.style.display = 'none';
    if (chkRestartOrderNumbers) chkRestartOrderNumbers.checked = false;

    if (chkCustomers) chkCustomers.checked = false;
    if (chkOperational) chkOperational.checked = false;
    if (chkStats) chkStats.checked = false;
    if (chkDemoDesigns) chkDemoDesigns.checked = false;

    if (chkDangerAllDesigns) chkDangerAllDesigns.checked = false;
    if (dangerConfirmWrapper) dangerConfirmWrapper.style.display = 'none';
    if (chkDangerConfirm) chkDangerConfirm.checked = false;

    if (chkDeleteRealPaidOrders) chkDeleteRealPaidOrders.checked = false;
    if (inputConfirmText) inputConfirmText.value = '';
    if (inputPassword) inputPassword.value = '';
    if (chkUnderstand) chkUnderstand.checked = false;
    if (confirmErrorMessage) confirmErrorMessage.style.display = 'none';

    setStep(1);
    loadLiveCounts();
  }

  // Close Modal
  function closeModal() {
    if (!modal) return;
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }

  // Event Listeners
  if (btnOpenModal) {
    btnOpenModal.addEventListener('click', openModal);
  }

  if (btnCloseModal) {
    btnCloseModal.addEventListener('click', closeModal);
  }

  if (btnCancelReset) {
    btnCancelReset.addEventListener('click', closeModal);
  }

  // Close on backdrop click
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal && currentStep !== 3) {
        closeModal();
      }
    });
  }

  // Close on ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && modal.style.display === 'flex' && currentStep !== 3) {
      closeModal();
    }
  });

  // Step 1 Checkbox listeners
  if (chkEnableOrders) {
    chkEnableOrders.addEventListener('change', () => {
      ordersOptionsWrapper.style.display = chkEnableOrders.checked ? 'block' : 'none';
      validateStep1();
    });
  }

  scopeRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (ordersDateWrapper) {
        ordersDateWrapper.style.display = radio.value === 'before_date' ? 'block' : 'none';
      }
    });
  });

  [chkCustomers, chkOperational, chkStats, chkDemoDesigns].forEach(chk => {
    if (chk) chk.addEventListener('change', validateStep1);
  });

  if (chkDangerAllDesigns) {
    chkDangerAllDesigns.addEventListener('change', () => {
      dangerConfirmWrapper.style.display = chkDangerAllDesigns.checked ? 'block' : 'none';
      if (!chkDangerAllDesigns.checked && chkDangerConfirm) {
        chkDangerConfirm.checked = false;
      }
      validateStep1();
    });
  }

  if (chkDangerConfirm) {
    chkDangerConfirm.addEventListener('change', validateStep1);
  }

  // Navigation Listeners
  if (btnToStep2) {
    btnToStep2.addEventListener('click', () => {
      setStep(2);
      loadPreview();
    });
  }

  if (btnBackToStep1) {
    btnBackToStep1.addEventListener('click', () => {
      setStep(1);
    });
  }

  if (chkDeleteRealPaidOrders) {
    chkDeleteRealPaidOrders.addEventListener('change', validateStep2);
  }

  if (btnToStep3) {
    btnToStep3.addEventListener('click', () => {
      setStep(3);
    });
  }

  if (btnBackToStep2) {
    btnBackToStep2.addEventListener('click', () => {
      setStep(2);
    });
  }

  // Step 3 Confirmation Listeners
  if (inputConfirmText) {
    inputConfirmText.addEventListener('input', validateStep3);
  }

  if (inputPassword) {
    inputPassword.addEventListener('input', validateStep3);
  }

  if (chkUnderstand) {
    chkUnderstand.addEventListener('change', validateStep3);
  }

  if (btnExecuteReset) {
    btnExecuteReset.addEventListener('click', executeReset);
  }

  if (btnReload) {
    btnReload.addEventListener('click', () => {
      window.location.reload();
    });
  }

  // Toggle Include Test Data in Header
  const toggleTestData = document.getElementById('toggleIncludeTestData');
  if (toggleTestData) {
    toggleTestData.addEventListener('change', () => {
      const isChecked = toggleTestData.checked;
      const url = new URL(window.location.href);
      url.searchParams.set('includeTestData', isChecked ? '1' : '0');
      window.location.href = url.toString();
    });
  }

  // Initial live counts trigger if modal opens
  document.addEventListener('DOMContentLoaded', () => {
    // If URL has openReset=1, automatically trigger modal
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('openReset') === '1') {
      openModal();
    }
  });

})();
