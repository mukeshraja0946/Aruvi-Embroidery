/**
 * Aruvi Embroidery — Admin Designs Management JavaScript
 * Controls: Bulk operations, delete modals, image replacement, bulk upload, and 3-step bulk import.
 */

// Global CSRF helper
function getCsrfToken() {
  if (window.CSRF_TOKEN) return window.CSRF_TOKEN;
  const meta = document.querySelector('meta[name="csrf-token"]');
  if (meta) return meta.getAttribute('content');
  return '';
}

// Global Toast Popup
function showAdminToast(msg) {
  let toast = document.getElementById('adminToastPopup');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'adminToastPopup';
    toast.style.cssText = 'position: fixed; top: 25px; right: 25px; background: #1B5E20; color: white; padding: 1.1rem 1.8rem; border-radius: 14px; box-shadow: 0 12px 30px rgba(0,0,0,0.25); z-index: 999999; display: flex; align-items: center; gap: 12px; font-weight: 600; font-size: 1rem; border: 2px solid #81C784;';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<i class="fa-solid fa-circle-check" style="font-size: 1.5rem; color: #66BB6A;"></i><span>${msg}</span><button type="button" onclick="this.parentElement.style.display='none'" style="background: none; border: none; color: white; margin-left: 15px; cursor: pointer; font-size: 1.3rem;">&times;</button>`;
  toast.style.display = 'flex';
  setTimeout(() => { if (toast) toast.style.display = 'none'; }, 4000);
}

// -----------------------------------------------------------------------------
// Selection & Bulk Actions
// -----------------------------------------------------------------------------
let pendingDeleteId = null;

function toggleSelectAllDesigns(master) {
  const checkboxes = document.querySelectorAll('.design-checkbox');
  checkboxes.forEach(cb => cb.checked = master.checked);
  updateSelectedCount();
}

function updateSelectedCount() {
  const checked = document.querySelectorAll('.design-checkbox:checked');
  const count = checked.length;
  const btn = document.getElementById('deleteSelectedBtn');
  const numEl = document.getElementById('selectedCountNum');
  if (numEl) numEl.textContent = count;
  if (btn) {
    btn.style.display = count > 0 ? 'inline-flex' : 'none';
  }

  const priceBtn = document.getElementById('updateSelectedPriceBtn');
  const priceNumEl = document.getElementById('updateSelectedPriceCountNum');
  if (priceNumEl) priceNumEl.textContent = count;
  if (priceBtn) {
    priceBtn.style.display = count > 0 ? 'inline-flex' : 'none';
  }

  const modalSelectedCountEl = document.getElementById('modalSelectedCount');
  if (modalSelectedCountEl) modalSelectedCountEl.textContent = count;

  const master = document.getElementById('selectAllCheckbox');
  const all = document.querySelectorAll('.design-checkbox');
  if (master && all.length > 0) {
    master.checked = checked.length === all.length;
  }
}

function confirmDeleteDesign(id, title) {
  pendingDeleteId = id;
  const msgEl = document.getElementById('deleteModalMessage');
  if (msgEl) {
    msgEl.textContent = title ? `Are you sure you want to permanently delete design "${title}"?` : 'Are you sure you want to permanently delete this design?';
  }
  const modal = document.getElementById('deleteDesignModal');
  if (modal) modal.style.display = 'flex';
}

function closeDeleteModal() {
  pendingDeleteId = null;
  const modal = document.getElementById('deleteDesignModal');
  if (modal) modal.style.display = 'none';
}

function executeDeleteDesign() {
  if (!pendingDeleteId) return;
  const id = pendingDeleteId;
  const btn = document.getElementById('confirmDeleteBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting...'; }

  const csrf = getCsrfToken();

  fetch('/admin/designs/delete/' + id + '?format=json', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-Token': csrf
    },
    body: JSON.stringify({ _csrf: csrf })
  })
  .then(res => res.json())
  .then(data => {
    closeDeleteModal();
    if (btn) { btn.disabled = false; btn.textContent = 'Delete Design'; }
    if (data.success) {
      const row = document.getElementById('designRow-' + id);
      if (row) {
        row.style.opacity = '0';
        row.style.transition = 'opacity 0.3s ease';
        setTimeout(() => row.remove(), 300);
      }
      showAdminToast(data.message || 'Design deleted successfully.');
    } else {
      alert(data.message || 'Unable to delete design. Please try again.');
    }
  })
  .catch(err => {
    console.error(err);
    closeDeleteModal();
    if (btn) { btn.disabled = false; btn.textContent = 'Delete Design'; }
    alert('Unable to delete design. Please try again.');
  });
}

function checkDeleteAllSafety() {
  const confirmInput = document.getElementById('deleteAllConfirmInput');
  const passwordInput = document.getElementById('deleteAllPasswordInput');
  const btn = document.getElementById('confirmDeleteAllBtn');
  if (!confirmInput || !passwordInput || !btn) return;

  const textMatch = (confirmInput.value || '').trim() === 'DELETE ALL';
  const hasPass = (passwordInput.value || '').trim().length > 0;

  if (textMatch && hasPass) {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
  } else {
    btn.disabled = true;
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
  }
}

function confirmDeleteAllDesigns() {
  const confirmInput = document.getElementById('deleteAllConfirmInput');
  const passwordInput = document.getElementById('deleteAllPasswordInput');
  if (confirmInput) confirmInput.value = '';
  if (passwordInput) passwordInput.value = '';
  checkDeleteAllSafety();

  const modal = document.getElementById('deleteAllDesignsModal');
  if (modal) modal.style.display = 'flex';
}

function closeDeleteAllModal() {
  const modal = document.getElementById('deleteAllDesignsModal');
  if (modal) modal.style.display = 'none';
}

function executeDeleteAllDesigns() {
  const confirmInput = document.getElementById('deleteAllConfirmInput');
  const passwordInput = document.getElementById('deleteAllPasswordInput');
  const btn = document.getElementById('confirmDeleteAllBtn');

  const confirmationText = confirmInput ? confirmInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value.trim() : '';

  if (confirmationText !== 'DELETE ALL' || !password) {
    alert('Please type "DELETE ALL" and enter your admin password.');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Archiving & Backing up...'; }

  const csrf = getCsrfToken();

  fetch('/admin/designs/delete-all', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-Token': csrf
    },
    body: JSON.stringify({ confirmationText, password, _csrf: csrf })
  })
  .then(res => res.json())
  .then(data => {
    closeDeleteAllModal();
    if (btn) { btn.disabled = false; btn.textContent = 'Delete All Designs'; }
    if (data.success) {
      showAdminToast(data.message || 'All designs safely moved to trash (recoverable for 30 days).');
      setTimeout(() => window.location.reload(), 1000);
    } else {
      alert(data.message || 'Unable to delete all designs. Please try again.');
    }
  })
  .catch(err => {
    console.error(err);
    closeDeleteAllModal();
    if (btn) { btn.disabled = false; btn.textContent = 'Delete All Designs'; }
    alert('Unable to delete all designs. Please try again.');
  });
}

function confirmDeleteSelectedDesigns() {
  const checked = document.querySelectorAll('.design-checkbox:checked');
  if (checked.length === 0) return;
  if (confirm(`Are you sure you want to permanently delete the ${checked.length} selected design(s)?`)) {
    executeDeleteSelectedDesigns();
  }
}

function executeDeleteSelectedDesigns() {
  const checked = document.querySelectorAll('.design-checkbox:checked');
  const ids = Array.from(checked).map(cb => cb.value);
  if (ids.length === 0) return;

  const csrf = getCsrfToken();

  fetch('/admin/designs/delete-bulk', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-Token': csrf
    },
    body: JSON.stringify({ ids, _csrf: csrf })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      showAdminToast(data.message || 'Selected designs deleted successfully.');
      setTimeout(() => window.location.reload(), 600);
    } else {
      alert(data.message || 'Unable to delete selected designs.');
    }
  })
  .catch(err => {
    console.error(err);
    alert('Error deleting selected designs.');
  });
}

function toggleDesignStatus(id, checkbox) {
  const csrf = getCsrfToken();
  fetch('/admin/designs/toggle-status/' + id, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf
    },
    body: JSON.stringify({ _csrf: csrf })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      const label = document.getElementById('statusLabel-' + id);
      if (label) {
        label.textContent = data.is_active ? 'Active' : 'Inactive';
        label.style.color = data.is_active ? '#2E7D32' : 'var(--admin-text-muted)';
      }
    } else {
      alert(data.message || 'Unable to update status');
      checkbox.checked = !checkbox.checked;
    }
  })
  .catch(err => {
    console.error(err);
    checkbox.checked = !checkbox.checked;
  });
}

async function duplicateDesign(id, title) {
  if (!confirm(`Duplicate design "${title}"? A new draft copy will be created with the next SKU.`)) return;
  try {
    const res = await fetch(`/admin/designs/duplicate/${id}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'X-CSRF-Token': getCsrfToken()
      }
    });
    const data = await res.json();
    if (data.success) {
      showAdminToast(data.message || 'Design duplicated successfully!');
      setTimeout(() => { window.location.reload(); }, 900);
    } else {
      alert(data.message || 'Error duplicating design');
    }
  } catch (e) {
    alert('Network error duplicating design.');
  }
}

// -----------------------------------------------------------------------------
// Replace Single Product Image Modal
// -----------------------------------------------------------------------------
function openReplaceImageModal(id, title) {
  document.getElementById('replaceImageDesignId').value = id;
  document.getElementById('replaceImageTitle').textContent = `Product: ${title} (#${id})`;
  document.getElementById('replaceImageFileInput').value = '';
  document.getElementById('replaceImagePreviewContainer').style.display = 'none';
  document.getElementById('replaceImageModal').style.display = 'flex';
}

function closeReplaceImageModal() {
  document.getElementById('replaceImageModal').style.display = 'none';
}

function previewSelectedReplaceImage(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('replaceImagePreviewImg').src = e.target.result;
      document.getElementById('replaceImagePreviewContainer').style.display = 'block';
    };
    reader.readAsDataURL(input.files[0]);
  }
}

async function submitReplaceImage(event) {
  event.preventDefault();
  const id = document.getElementById('replaceImageDesignId').value;
  const fileInput = document.getElementById('replaceImageFileInput');
  if (!fileInput.files || fileInput.files.length === 0) {
    alert('Please select an image file to upload.');
    return;
  }

  const btn = document.getElementById('replaceImageSubmitBtn');
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading...';

  const formData = new FormData();
  formData.append('_csrf', getCsrfToken());
  formData.append('image', fileInput.files[0]);

  try {
    const res = await fetch(`/admin/designs/replace-image/${id}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: formData
    });
    const data = await res.json();
    btn.disabled = false;
    btn.innerHTML = origHtml;

    if (data.success) {
      closeReplaceImageModal();
      showAdminToast(data.message || 'Image replaced successfully!');
      setTimeout(() => { window.location.reload(); }, 900);
    } else {
      alert(data.message || 'Failed to replace image.');
    }
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = origHtml;
    alert('Network error while replacing image: ' + e.message);
  }
}

// -----------------------------------------------------------------------------
// Bulk Image Upload Modal (Reliable Chunked Upload Pipeline)
// -----------------------------------------------------------------------------
let bulkUploadState = {
  items: [],              // Array of { id, file, originalName, size, formattedSize, isValid, validationError, status, details, retryCount }
  batches: [],            // Array of item arrays (5 items per batch)
  activeControllers: new Set(),
  activeStreams: 0,
  maxConcurrency: 3,
  batchSize: 5,
  batchTimeoutMs: 60000,
  isUploading: false,
  isCancelled: false,
  catalogDesigns: [],     // Cached designs for manual link dropdown
  stats: {
    total: 0,
    processed: 0,
    linked: 0,
    unmatched: 0,
    ambiguous: 0,
    failed: 0
  }
};

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

async function openBulkImageUploadModal() {
  const modal = document.getElementById('bulkImageUploadModal');
  if (!modal) return;

  // Reset state
  bulkUploadState = {
    items: [],
    batches: [],
    activeControllers: new Set(),
    activeStreams: 0,
    maxConcurrency: 3,
    batchSize: 5,
    batchTimeoutMs: 60000,
    isUploading: false,
    isCancelled: false,
    catalogDesigns: bulkUploadState.catalogDesigns || [],
    stats: { total: 0, processed: 0, linked: 0, unmatched: 0, ambiguous: 0, failed: 0 }
  };

  // Reset DOM inputs
  const fileInput = document.getElementById('bulkImageFilesInput');
  if (fileInput) fileInput.value = '';

  const preSummary = document.getElementById('bulkImagePreUploadSummary');
  if (preSummary) preSummary.style.display = 'none';

  const progressSection = document.getElementById('bulkImageProgressSection');
  if (progressSection) progressSection.style.display = 'none';

  const reportCard = document.getElementById('bulkImageReportCard');
  if (reportCard) reportCard.style.display = 'none';

  const emptyWarn = document.getElementById('bulkImageEmptyDbWarning');
  if (emptyWarn) emptyWarn.style.display = 'none';

  const selectSection = document.getElementById('bulkImageFileSelectSection');
  if (selectSection) selectSection.style.display = 'block';

  // Reset counters
  const linkedEl = document.getElementById('bulkLinkedCount');
  if (linkedEl) linkedEl.textContent = '0';
  const unmatchedEl = document.getElementById('bulkUnmatchedCount');
  if (unmatchedEl) unmatchedEl.textContent = '0';
  const ambiguousEl = document.getElementById('bulkAmbiguousCount');
  if (ambiguousEl) ambiguousEl.textContent = '0';
  const failedEl = document.getElementById('bulkFailedCount');
  if (failedEl) failedEl.textContent = '0';

  // Reset buttons
  const submitBtn = document.getElementById('bulkImageSubmitBtn');
  if (submitBtn) {
    submitBtn.style.display = 'inline-flex';
    submitBtn.disabled = true;
  }

  const cancelCloseBtn = document.getElementById('bulkImageCancelCloseBtn');
  if (cancelCloseBtn) cancelCloseBtn.style.display = 'inline-flex';

  const abortBtn = document.getElementById('bulkImageAbortBtn');
  if (abortBtn) abortBtn.style.display = 'none';

  const finishBtn = document.getElementById('bulkImageFinishRefreshBtn');
  if (finishBtn) finishBtn.style.display = 'none';

  modal.style.display = 'flex';

  // Check if database has zero designs before allowing uploads
  try {
    const res = await fetch('/admin/designs/bulk-upload-check', {
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    if (res.ok) {
      const checkData = await res.json();
      if (checkData.success) {
        bulkUploadState.catalogDesigns = checkData.designs || [];
        if (checkData.isEmpty) {
          if (emptyWarn) emptyWarn.style.display = 'block';
          if (selectSection) selectSection.style.display = 'none';
          if (submitBtn) submitBtn.disabled = true;
        } else {
          if (emptyWarn) emptyWarn.style.display = 'none';
          if (selectSection) selectSection.style.display = 'block';
        }
      }
    }
  } catch (checkErr) {
    console.warn('[Bulk Upload Check Notice]:', checkErr.message);
  }
}

function closeBulkImageUploadModal(force = false) {
  if (bulkUploadState.isUploading && !force) {
    if (!confirm('Upload is currently in progress. Do you want to cancel and close?')) {
      return;
    }
    abortBulkImageUpload();
  }
  const modal = document.getElementById('bulkImageUploadModal');
  if (modal) modal.style.display = 'none';
}

function handleBulkImageFilesSelected(input) {
  const files = input ? Array.from(input.files || []) : [];
  if (files.length === 0) return;

  const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];
  const maxBytes = 10 * 1024 * 1024; // 10 MB per file limit

  const items = [];
  let totalBytes = 0;
  let invalidCount = 0;
  const warnings = [];

  files.forEach((file, idx) => {
    totalBytes += file.size;
    const ext = (file.name.slice((file.name.lastIndexOf('.') - 1 >>> 0) + 2) || '').toLowerCase();
    const hasAllowedExt = allowedExts.some(a => a.replace('.', '') === ext);
    let isValid = true;
    let validationError = '';

    if (!hasAllowedExt) {
      isValid = false;
      validationError = `Unsupported extension (.${ext}). Only JPG, PNG, WEBP, AVIF allowed.`;
      invalidCount++;
      warnings.push(`"${file.name}": Unsupported format (.${ext})`);
    } else if (file.size > maxBytes) {
      isValid = false;
      validationError = `File exceeds 10 MB limit (${formatBytes(file.size)}).`;
      invalidCount++;
      warnings.push(`"${file.name}": Exceeds 10MB limit (${formatBytes(file.size)})`);
    }

    items.push({
      id: idx + 1,
      file,
      originalName: file.name,
      size: file.size,
      formattedSize: formatBytes(file.size),
      isValid,
      validationError,
      status: isValid ? 'pending' : 'failed',
      details: isValid ? 'Ready to upload' : validationError,
      retryCount: 0
    });
  });

  bulkUploadState.items = items;
  const validItems = items.filter(it => it.isValid);

  // Update Pre-upload UI
  const preSummary = document.getElementById('bulkImagePreUploadSummary');
  const preCount = document.getElementById('bulkPreSelectedCount');
  const preSize = document.getElementById('bulkPreSelectedSize');
  const preBatches = document.getElementById('bulkPreBatchesCount');
  const preWarnings = document.getElementById('bulkPreValidationWarnings');
  const submitBtn = document.getElementById('bulkImageSubmitBtn');

  if (preCount) preCount.textContent = validItems.length + (invalidCount > 0 ? ` (and ${invalidCount} invalid)` : '');
  if (preSize) preSize.textContent = formatBytes(totalBytes);
  if (preBatches) preBatches.textContent = `${Math.ceil(validItems.length / bulkUploadState.batchSize)} batches planned (5 files/request)`;

  if (warnings.length > 0 && preWarnings) {
    preWarnings.innerHTML = `<strong><i class="fa-solid fa-triangle-exclamation"></i> Warnings:</strong><ul style="margin: 4px 0 0 16px; padding: 0;">` +
      warnings.slice(0, 5).map(w => `<li>${w}</li>`).join('') +
      (warnings.length > 5 ? `<li>...and ${warnings.length - 5} more</li>` : '') +
      `</ul><div style="margin-top: 4px;">These invalid files will be flagged as failed and not uploaded.</div>`;
    preWarnings.style.display = 'block';
  } else if (preWarnings) {
    preWarnings.style.display = 'none';
  }

  if (preSummary) preSummary.style.display = 'block';
  if (submitBtn) submitBtn.disabled = validItems.length === 0;
}

/**
 * Optional browser-side compression using HTML5 Canvas.
 * Resizes images over 1600px and converts to WebP/JPEG quality 0.85.
 */
async function compressImageForUpload(file, maxDimension = 1600, quality = 0.85) {
  const shouldOptimize = document.getElementById('bulkImageOptimizeToggle')?.checked ?? true;
  if (!shouldOptimize) return file;
  if (!file.type || !file.type.startsWith('image/')) return file;

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let width = img.width;
      let height = img.height;

      // If dimensions are within limit and file is small, skip compression
      if (width <= maxDimension && height <= maxDimension && file.size < 1024 * 1024) {
        return resolve(file);
      }

      if (width > height) {
        if (width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        }
      } else {
        if (height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (blob && blob.size < file.size) {
            const compressedFile = new File([blob], file.name, {
              type: blob.type || 'image/webp',
              lastModified: Date.now()
            });
            resolve(compressedFile);
          } else {
            resolve(file);
          }
        },
        'image/webp',
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

function renderLiveFileList() {
  const listContainer = document.getElementById('bulkImageLiveList');
  if (!listContainer) return;

  const html = bulkUploadState.items.map(item => {
    let icon = '<i class="fa-regular fa-clock" style="color: #8C7F79;"></i>';
    let badgeColor = '#FAF9F6';
    let borderColor = 'var(--admin-border)';
    let statusText = item.details || 'Pending';

    if (item.status === 'uploading') {
      icon = '<i class="fa-solid fa-spinner fa-spin" style="color: var(--admin-primary);"></i>';
      badgeColor = '#FFF8E1';
      borderColor = '#FFE082';
      statusText = 'Uploading...';
    } else if (item.status === 'linked') {
      icon = '<i class="fa-solid fa-circle-check" style="color: #2E7D32;"></i>';
      badgeColor = '#E8F5E9';
      borderColor = '#C8E6C9';
    } else if (item.status === 'ambiguous') {
      icon = '<i class="fa-solid fa-code-compare" style="color: #BF360C;"></i>';
      badgeColor = '#FFF3E0';
      borderColor = '#FFCCBC';
      statusText = 'Ambiguous match';
    } else if (item.status === 'unmatched') {
      icon = '<i class="fa-solid fa-circle-question" style="color: #E65100;"></i>';
      badgeColor = '#FFF8E1';
      borderColor = '#FFE082';
    } else if (item.status === 'failed') {
      icon = '<i class="fa-solid fa-circle-xmark" style="color: #C62828;"></i>';
      badgeColor = '#FFEBEE';
      borderColor = '#FFCDD2';
    }

    return `
      <div id="bulk-file-item-${item.id}" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; background: ${badgeColor}; border: 1px solid ${borderColor}; border-radius: 6px; font-size: 0.78rem;">
        <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65%;">
          ${icon}
          <strong style="color: var(--admin-text-dark); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(item.originalName)}</strong>
          <span style="color: var(--admin-text-muted); font-size: 0.72rem;">(${item.formattedSize})</span>
        </div>
        <div style="font-size: 0.75rem; text-align: right; max-width: 35%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <span>${escapeHtml(statusText)}</span>
        </div>
      </div>
    `;
  }).join('');

  listContainer.innerHTML = html;
}

function updateLiveItemRow(item) {
  const el = document.getElementById(`bulk-file-item-${item.id}`);
  if (!el) {
    renderLiveFileList();
    return;
  }

  let icon = '<i class="fa-regular fa-clock" style="color: #8C7F79;"></i>';
  let badgeColor = '#FAF9F6';
  let borderColor = 'var(--admin-border)';
  let statusText = item.details || 'Pending';

  if (item.status === 'uploading') {
    icon = '<i class="fa-solid fa-spinner fa-spin" style="color: var(--admin-primary);"></i>';
    badgeColor = '#FFF8E1';
    borderColor = '#FFE082';
    statusText = 'Uploading...';
  } else if (item.status === 'linked') {
    icon = '<i class="fa-solid fa-circle-check" style="color: #2E7D32;"></i>';
    badgeColor = '#E8F5E9';
    borderColor = '#C8E6C9';
  } else if (item.status === 'ambiguous') {
    icon = '<i class="fa-solid fa-code-compare" style="color: #BF360C;"></i>';
    badgeColor = '#FFF3E0';
    borderColor = '#FFCCBC';
    statusText = 'Ambiguous match';
  } else if (item.status === 'unmatched') {
    icon = '<i class="fa-solid fa-circle-question" style="color: #E65100;"></i>';
    badgeColor = '#FFF8E1';
    borderColor = '#FFE082';
  } else if (item.status === 'failed') {
    icon = '<i class="fa-solid fa-circle-xmark" style="color: #C62828;"></i>';
    badgeColor = '#FFEBEE';
    borderColor = '#FFCDD2';
  }

  el.style.background = badgeColor;
  el.style.border = `1px solid ${borderColor}`;
  el.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65%;">
      ${icon}
      <strong style="color: var(--admin-text-dark); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(item.originalName)}</strong>
      <span style="color: var(--admin-text-muted); font-size: 0.72rem;">(${item.formattedSize})</span>
    </div>
    <div style="font-size: 0.75rem; text-align: right; max-width: 35%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
      <span>${escapeHtml(statusText)}</span>
    </div>
  `;
}

function updateProgressCounters() {
  const { total, processed, linked, unmatched, ambiguous, failed } = bulkUploadState.stats;
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  const bar = document.getElementById('bulkImageProgressBar');
  if (bar) bar.style.width = `${pct}%`;

  const counterText = document.getElementById('bulkImageProgressCounter');
  if (counterText) counterText.textContent = `${processed} / ${total} uploaded (${pct}%)`;

  const linkedEl = document.getElementById('bulkLinkedCount');
  if (linkedEl) linkedEl.textContent = linked;

  const unmatchedEl = document.getElementById('bulkUnmatchedCount');
  if (unmatchedEl) unmatchedEl.textContent = unmatched;

  const ambiguousEl = document.getElementById('bulkAmbiguousCount');
  if (ambiguousEl) ambiguousEl.textContent = ambiguous || 0;

  const failedEl = document.getElementById('bulkFailedCount');
  if (failedEl) failedEl.textContent = failed;

  const workersEl = document.getElementById('bulkActiveWorkersText');
  if (workersEl) workersEl.textContent = `Active streams: ${bulkUploadState.activeStreams} / ${bulkUploadState.maxConcurrency}`;
}

async function startChunkedBulkImageUpload() {
  if (bulkUploadState.items.length === 0) {
    alert('Please select images first.');
    return;
  }

  // Guard against uploading if database has zero designs
  const emptyWarn = document.getElementById('bulkImageEmptyDbWarning');
  if (emptyWarn && emptyWarn.style.display !== 'none') {
    alert('No designs found. Import your spreadsheet first (Bulk Import), then re-upload images.');
    return;
  }

  // Filter valid files that are not already linked or processed
  const pendingItems = bulkUploadState.items.filter(it => it.isValid && it.status !== 'linked');
  if (pendingItems.length === 0) {
    alert('No pending valid images to upload.');
    return;
  }

  bulkUploadState.isUploading = true;
  bulkUploadState.isCancelled = false;
  bulkUploadState.stats = {
    total: bulkUploadState.items.length,
    processed: bulkUploadState.items.filter(it => it.status === 'linked' || it.status === 'ambiguous' || it.status === 'unmatched' || (!it.isValid && it.status === 'failed')).length,
    linked: bulkUploadState.items.filter(it => it.status === 'linked').length,
    unmatched: bulkUploadState.items.filter(it => it.status === 'unmatched').length,
    ambiguous: bulkUploadState.items.filter(it => it.status === 'ambiguous').length,
    failed: bulkUploadState.items.filter(it => it.status === 'failed').length
  };

  // Build batch queue (5 items per batch)
  const batches = [];
  for (let i = 0; i < pendingItems.length; i += bulkUploadState.batchSize) {
    batches.push({
      id: Math.floor(i / bulkUploadState.batchSize) + 1,
      items: pendingItems.slice(i, i + bulkUploadState.batchSize),
      retries: 0
    });
  }
  bulkUploadState.batches = batches;

  // Toggle UI visibility
  document.getElementById('bulkImageFileSelectSection').style.display = 'none';
  document.getElementById('bulkImagePreUploadSummary').style.display = 'none';
  document.getElementById('bulkImageReportCard').style.display = 'none';
  document.getElementById('bulkImageProgressSection').style.display = 'block';

  document.getElementById('bulkImageSubmitBtn').style.display = 'none';
  document.getElementById('bulkImageCancelCloseBtn').style.display = 'none';
  document.getElementById('bulkImageAbortBtn').style.display = 'inline-flex';

  const statusBadge = document.getElementById('bulkImageStatusBadge');
  if (statusBadge) {
    statusBadge.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading batches...';
    statusBadge.style.color = 'var(--admin-primary)';
  }

  renderLiveFileList();
  updateProgressCounters();

  // Launch worker pool with max 3 concurrent streams
  const workerCount = Math.min(bulkUploadState.maxConcurrency, batches.length);
  const workerPromises = [];
  for (let w = 0; w < workerCount; w++) {
    workerPromises.push(runBatchWorker());
  }

  await Promise.all(workerPromises);
  onBulkUploadFinished();
}

async function runBatchWorker() {
  while (bulkUploadState.batches.length > 0 && !bulkUploadState.isCancelled) {
    const batch = bulkUploadState.batches.shift();
    if (!batch) break;

    bulkUploadState.activeStreams++;
    updateProgressCounters();

    await processSingleBatch(batch);

    bulkUploadState.activeStreams--;
    updateProgressCounters();
  }
}

async function processSingleBatch(batch) {
  if (bulkUploadState.isCancelled) return;

  // Mark all items in this batch as uploading
  batch.items.forEach(it => {
    it.status = 'uploading';
    it.details = `Uploading in batch #${batch.id}...`;
    updateLiveItemRow(it);
  });

  const controller = new AbortController();
  bulkUploadState.activeControllers.add(controller);

  // 60-second request timeout per batch
  const timeoutId = setTimeout(() => {
    controller.abort(new Error('Batch request timed out after 60 seconds'));
  }, bulkUploadState.batchTimeoutMs);

  try {
    const formData = new FormData();
    formData.append('_csrf', getCsrfToken());

    // Process files through browser compressor before attaching to FormData
    for (const item of batch.items) {
      const fileToUpload = await compressImageForUpload(item.file);
      formData.append('images', fileToUpload, item.originalName);
    }

    const res = await fetch('/admin/designs/bulk-upload-images', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': getCsrfToken()
      },
      body: formData,
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    bulkUploadState.activeControllers.delete(controller);

    if (!res.ok) {
      let errBody = {};
      try { errBody = await res.json(); } catch (e) {}
      throw new Error(errBody.message || `Server returned HTTP ${res.status}`);
    }

    const data = await res.json();

    // Map response to batch items
    const matchedList = data.matched || [];
    const ambiguousList = data.ambiguous || [];
    const unmatchedList = data.unmatched || [];
    const failedList = data.failed || [];

    batch.items.forEach(item => {
      const matched = matchedList.find(m => m.filename.toLowerCase() === item.originalName.toLowerCase());
      const ambiguous = ambiguousList.find(a => a.filename.toLowerCase() === item.originalName.toLowerCase());
      const unmatched = unmatchedList.find(u => u.filename.toLowerCase() === item.originalName.toLowerCase());
      const failed = failedList.find(f => f.filename.toLowerCase() === item.originalName.toLowerCase());

      if (matched) {
        item.status = 'linked';
        item.details = `Linked to #${matched.designId} (${matched.sku || matched.title})`;
        item.matchedDesign = matched;
        bulkUploadState.stats.linked++;
      } else if (ambiguous) {
        item.status = 'ambiguous';
        item.tempToken = ambiguous.tempToken;
        item.candidates = ambiguous.candidates || [];
        item.details = ambiguous.reason || 'Multiple candidate designs found';
        bulkUploadState.stats.ambiguous++;
      } else if (unmatched) {
        item.status = 'unmatched';
        item.tempToken = unmatched.tempToken;
        item.suggestions = unmatched.suggestions || [];
        item.details = unmatched.reason || 'No matching product found';
        bulkUploadState.stats.unmatched++;
      } else if (failed) {
        item.status = 'failed';
        item.details = failed.error || 'Upload error';
        item.referenceId = failed.referenceId;
        bulkUploadState.stats.failed++;
      } else {
        item.status = 'unmatched';
        item.details = 'No product matched';
        bulkUploadState.stats.unmatched++;
      }

      bulkUploadState.stats.processed++;
      updateLiveItemRow(item);
    });

  } catch (err) {
    clearTimeout(timeoutId);
    bulkUploadState.activeControllers.delete(controller);

    if (bulkUploadState.isCancelled) {
      batch.items.forEach(item => {
        item.status = 'failed';
        item.details = 'Cancelled by user';
        updateLiveItemRow(item);
      });
      return;
    }

    console.warn(`[Bulk Upload Batch #${batch.id} Failed]:`, err.message);

    // Auto-retry up to 3 times with progressive delay
    if (batch.retries < 3) {
      batch.retries++;
      const delayMs = batch.retries * 1200;
      batch.items.forEach(item => {
        item.details = `Retry ${batch.retries}/3 in ${Math.round(delayMs / 1000)}s (${err.message})...`;
        updateLiveItemRow(item);
      });
      await new Promise(r => setTimeout(r, delayMs));
      bulkUploadState.batches.unshift(batch); // Put back to front of queue
      return;
    }

    // Retries exhausted: mark items as failed
    batch.items.forEach(item => {
      item.status = 'failed';
      item.details = `Failed after 3 retries: ${err.message}`;
      bulkUploadState.stats.failed++;
      bulkUploadState.stats.processed++;
      updateLiveItemRow(item);
    });
  }

  updateProgressCounters();
}

function abortBulkImageUpload() {
  bulkUploadState.isCancelled = true;
  bulkUploadState.isUploading = false;

  // Active cancellation via AbortControllers
  bulkUploadState.activeControllers.forEach(ctrl => {
    try { ctrl.abort(); } catch (e) {}
  });
  bulkUploadState.activeControllers.clear();
  bulkUploadState.batches = [];

  const statusBadge = document.getElementById('bulkImageStatusBadge');
  if (statusBadge) {
    statusBadge.innerHTML = '<i class="fa-solid fa-circle-stop"></i> Upload Cancelled';
    statusBadge.style.color = '#C62828';
  }

  // Update in-progress items
  bulkUploadState.items.forEach(it => {
    if (it.status === 'uploading' || it.status === 'pending') {
      it.status = 'failed';
      it.details = 'Cancelled by user';
      bulkUploadState.stats.failed++;
      bulkUploadState.stats.processed++;
      updateLiveItemRow(it);
    }
  });

  updateProgressCounters();
  onBulkUploadFinished();
}

function onBulkUploadFinished() {
  bulkUploadState.isUploading = false;

  // Update header badge
  const statusBadge = document.getElementById('bulkImageStatusBadge');
  if (statusBadge) {
    if (bulkUploadState.isCancelled) {
      statusBadge.innerHTML = '<i class="fa-solid fa-ban"></i> Cancelled';
      statusBadge.style.color = '#C62828';
    } else {
      statusBadge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Finished';
      statusBadge.style.color = '#2E7D32';
    }
  }

  // Configure action buttons
  const abortBtn = document.getElementById('bulkImageAbortBtn');
  if (abortBtn) abortBtn.style.display = 'none';

  const finishBtn = document.getElementById('bulkImageFinishRefreshBtn');
  if (finishBtn) finishBtn.style.display = 'inline-flex';

  const cancelCloseBtn = document.getElementById('bulkImageCancelCloseBtn');
  if (cancelCloseBtn) cancelCloseBtn.style.display = 'inline-flex';

  // Build Report Card
  const reportCard = document.getElementById('bulkImageReportCard');
  const reportHeader = document.getElementById('bulkImageReportHeader');
  const reportSummaryText = document.getElementById('bulkImageReportSummaryText');

  const linkedCount = bulkUploadState.items.filter(it => it.status === 'linked').length;
  const ambiguousCount = bulkUploadState.items.filter(it => it.status === 'ambiguous').length;
  const unmatchedCount = bulkUploadState.items.filter(it => it.status === 'unmatched').length;
  const failedCount = bulkUploadState.items.filter(it => it.status === 'failed').length;

  if (reportSummaryText) {
    reportSummaryText.innerHTML = `
      <strong>Processed ${bulkUploadState.items.length} images:</strong>
      <span style="color: #2E7D32; font-weight: 600;">${linkedCount} successfully linked</span>,
      <span style="color: #BF360C; font-weight: 600;">${ambiguousCount} ambiguous</span>,
      <span style="color: #E65100; font-weight: 600;">${unmatchedCount} unmatched</span>,
      <span style="color: #C62828; font-weight: 600;">${failedCount} failed</span>.
    `;
  }

  // Ambiguous candidates list
  const ambiguousBox = document.getElementById('bulkAmbiguousDetailsBox');
  const ambiguousList = document.getElementById('bulkAmbiguousList');
  const ambiguousItems = bulkUploadState.items.filter(it => it.status === 'ambiguous');

  if (ambiguousItems.length > 0 && ambiguousBox && ambiguousList) {
    ambiguousList.innerHTML = ambiguousItems.map(it => {
      const candidates = it.candidates || [];
      const candidatesHtml = candidates.map(cand => `
        <button type="button" 
          onclick="linkSingleBulkImage('${it.tempToken}', ${cand.id}, '${escapeHtml(it.originalName)}', '${it.id}', this)"
          style="padding: 4px 10px; background: #FFF; border: 1px solid #BF360C; color: #BF360C; border-radius: 6px; font-size: 0.76rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
          <i class="fa-solid fa-link"></i> Link to #${cand.id} ${escapeHtml(cand.sku || '')} (${escapeHtml(cand.title)})
        </button>
      `).join(' ');

      return `
        <div id="ambiguous-item-box-${it.id}" style="background: #FFF; border: 1px solid #FFE0B2; border-radius: 6px; padding: 8px 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <strong style="color: var(--admin-text-dark);">${escapeHtml(it.originalName)}</strong>
            <span style="color: #BF360C; font-size: 0.74rem;">${escapeHtml(it.details)}</span>
          </div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            ${candidatesHtml || '<em>No candidate details available</em>'}
          </div>
        </div>
      `;
    }).join('');
    ambiguousBox.style.display = 'block';
  } else if (ambiguousBox) {
    ambiguousBox.style.display = 'none';
  }

  // Unmatched names & suggestions list with manual dropdown
  const unmatchedBox = document.getElementById('bulkUnmatchedDetailsBox');
  const unmatchedList = document.getElementById('bulkUnmatchedNamesList');
  const unmatchedItems = bulkUploadState.items.filter(it => it.status === 'unmatched');

  if (unmatchedItems.length > 0 && unmatchedBox && unmatchedList) {
    const catalogDesigns = bulkUploadState.catalogDesigns || [];
    const optionsHtml = catalogDesigns.map(d => `<option value="${d.id}">#${d.id} - ${escapeHtml(d.sku || '')} (${escapeHtml(d.title)})</option>`).join('');

    unmatchedList.innerHTML = unmatchedItems.map(it => {
      const suggestions = it.suggestions || [];
      const suggestionsHtml = suggestions.length > 0 ? `
        <div style="margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center;">
          <span style="font-size: 0.74rem; font-weight: 600; color: #E65100;">Suggestions:</span>
          ${suggestions.map(s => `
            <button type="button" 
              onclick="linkSingleBulkImage('${it.tempToken}', ${s.id}, '${escapeHtml(it.originalName)}', '${it.id}', this)"
              style="padding: 3px 8px; background: #FFF; border: 1px solid #E65100; color: #E65100; border-radius: 6px; font-size: 0.74rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
              <i class="fa-solid fa-link"></i> #${s.id} ${escapeHtml(s.sku || '')} (${escapeHtml(s.title)}) [${Math.round((s.similarity || 0) * 100)}%]
            </button>
          `).join('')}
        </div>
      ` : '';

      return `
        <div id="unmatched-item-box-${it.id}" style="background: #FFF; border: 1px solid #FFE082; border-radius: 6px; padding: 8px 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <strong style="color: var(--admin-text-dark);">${escapeHtml(it.originalName)}</strong>
            <span style="color: #E65100; font-size: 0.74rem;">${escapeHtml(it.details)}</span>
          </div>
          ${suggestionsHtml}
          <div style="display: flex; gap: 8px; align-items: center; margin-top: 8px;">
            <select id="manual-select-${it.id}" style="flex: 1; padding: 5px 8px; font-size: 0.78rem; border: 1px solid var(--admin-border); border-radius: 6px; background: #FAFAFA;">
              <option value="">-- Manually select design to link --</option>
              ${optionsHtml}
            </select>
            <button type="button" onclick="handleManualLinkDropdown('${it.id}', '${it.tempToken}', '${escapeHtml(it.originalName)}', this)" style="padding: 5px 12px; background: var(--admin-primary); color: #FFF; border: none; border-radius: 6px; font-size: 0.78rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
              <i class="fa-solid fa-link"></i> Link
            </button>
          </div>
        </div>
      `;
    }).join('');
    unmatchedBox.style.display = 'block';
  } else if (unmatchedBox) {
    unmatchedBox.style.display = 'none';
  }

  // Failed reasons list
  const failedBox = document.getElementById('bulkFailedDetailsBox');
  const failedList = document.getElementById('bulkFailedReasonsList');
  const failedItems = bulkUploadState.items.filter(it => it.status === 'failed');
  if (failedItems.length > 0 && failedBox && failedList) {
    failedList.innerHTML = failedItems.map(it => `<div>• ${escapeHtml(it.originalName)}: ${escapeHtml(it.details)}${it.referenceId ? ` [Ref: ${escapeHtml(it.referenceId)}]` : ''}</div>`).join('');
    failedBox.style.display = 'block';
  } else if (failedBox) {
    failedBox.style.display = 'none';
  }

  // Retry Failed Button
  const retryBtn = document.getElementById('bulkRetryFailedBtn');
  const retryCountSpan = document.getElementById('bulkRetryBtnCount');
  if (failedItems.length > 0 && retryBtn) {
    if (retryCountSpan) retryCountSpan.textContent = failedItems.length;
    retryBtn.style.display = 'inline-flex';
  } else if (retryBtn) {
    retryBtn.style.display = 'none';
  }

  if (reportCard) reportCard.style.display = 'block';
}

/**
 * Manually link an unmatched or ambiguous image to a selected product design
 */
async function linkSingleBulkImage(tempToken, designId, originalName, itemId, triggerBtn) {
  if (!designId || !tempToken) {
    alert('Please select a valid design and image token.');
    return;
  }

  const prevBtnHtml = triggerBtn ? triggerBtn.innerHTML : '';
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Linking...';
  }

  try {
    const res = await fetch('/admin/designs/bulk-link-single-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': getCsrfToken()
      },
      body: JSON.stringify({ designId, tempToken, originalName })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to link image');
    }

    // Update item in state
    const item = bulkUploadState.items.find(it => String(it.id) === String(itemId));
    if (item) {
      const prevStatus = item.status;
      item.status = 'linked';
      item.details = `Linked to #${data.designId} (${data.sku || data.title})`;
      item.matchedDesign = { designId: data.designId, sku: data.sku, title: data.title, imageUrl: data.imageUrl };

      if (prevStatus === 'unmatched') {
        bulkUploadState.stats.unmatched = Math.max(0, bulkUploadState.stats.unmatched - 1);
      } else if (prevStatus === 'ambiguous') {
        bulkUploadState.stats.ambiguous = Math.max(0, bulkUploadState.stats.ambiguous - 1);
      }
      bulkUploadState.stats.linked++;

      updateLiveItemRow(item);
      updateProgressCounters();
    }

    // Replace the box with a success badge
    const unmatchedBox = document.getElementById(`unmatched-item-box-${itemId}`);
    if (unmatchedBox) {
      unmatchedBox.style.background = '#E8F5E9';
      unmatchedBox.style.border = '1px solid #C8E6C9';
      unmatchedBox.innerHTML = `
        <div style="color: #2E7D32; font-weight: 600; display: flex; align-items: center; gap: 6px;">
          <i class="fa-solid fa-circle-check"></i> Linked "${escapeHtml(originalName)}" to #${data.designId} (${escapeHtml(data.sku || data.title)})!
        </div>
      `;
    }

    const ambiguousBox = document.getElementById(`ambiguous-item-box-${itemId}`);
    if (ambiguousBox) {
      ambiguousBox.style.background = '#E8F5E9';
      ambiguousBox.style.border = '1px solid #C8E6C9';
      ambiguousBox.innerHTML = `
        <div style="color: #2E7D32; font-weight: 600; display: flex; align-items: center; gap: 6px;">
          <i class="fa-solid fa-circle-check"></i> Linked "${escapeHtml(originalName)}" to #${data.designId} (${escapeHtml(data.sku || data.title)})!
        </div>
      `;
    }

    // Update Report Summary Text counts
    const linkedCount = bulkUploadState.items.filter(it => it.status === 'linked').length;
    const ambiguousCount = bulkUploadState.items.filter(it => it.status === 'ambiguous').length;
    const unmatchedCount = bulkUploadState.items.filter(it => it.status === 'unmatched').length;
    const failedCount = bulkUploadState.items.filter(it => it.status === 'failed').length;

    const reportSummaryText = document.getElementById('bulkImageReportSummaryText');
    if (reportSummaryText) {
      reportSummaryText.innerHTML = `
        <strong>Processed ${bulkUploadState.items.length} images:</strong>
        <span style="color: #2E7D32; font-weight: 600;">${linkedCount} successfully linked</span>,
        <span style="color: #BF360C; font-weight: 600;">${ambiguousCount} ambiguous</span>,
        <span style="color: #E65100; font-weight: 600;">${unmatchedCount} unmatched</span>,
        <span style="color: #C62828; font-weight: 600;">${failedCount} failed</span>.
      `;
    }

  } catch (err) {
    alert(`Could not link image: ${err.message}`);
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.innerHTML = prevBtnHtml;
    }
  }
}

function handleManualLinkDropdown(itemId, tempToken, originalName, triggerBtn) {
  const sel = document.getElementById(`manual-select-${itemId}`);
  if (!sel || !sel.value) {
    alert('Please select a product design from the dropdown first.');
    return;
  }
  linkSingleBulkImage(tempToken, sel.value, originalName, itemId, triggerBtn);
}

function retryFailedBulkImages() {
  const failedItems = bulkUploadState.items.filter(it => it.status === 'failed');
  if (failedItems.length === 0) return;

  failedItems.forEach(it => {
    it.status = 'pending';
    it.details = 'Retrying upload...';
    it.retryCount = 0;
  });

  const reportCard = document.getElementById('bulkImageReportCard');
  if (reportCard) reportCard.style.display = 'none';

  startChunkedBulkImageUpload();
}

function downloadBulkUploadReportCsv() {
  if (bulkUploadState.items.length === 0) {
    alert('No upload data available to export.');
    return;
  }

  const timestamp = new Date().toISOString();
  const rows = [
    ['Filename', 'Status', 'Matched SKU', 'Matched Product ID', 'Matched Title', 'Details / Error', 'Timestamp']
  ];

  bulkUploadState.items.forEach(item => {
    const matched = item.matchedDesign || {};
    rows.push([
      item.originalName,
      item.status.toUpperCase(),
      matched.sku || '',
      matched.designId || '',
      matched.title || '',
      item.details || '',
      timestamp
    ]);
  });

  const csvContent = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `bulk_image_upload_report_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function finishBulkUploadAndRefresh() {
  closeBulkImageUploadModal(true);
  window.location.reload();
}

// -----------------------------------------------------------------------------
// 3-Step Bulk Importer Wizard
// -----------------------------------------------------------------------------
let currentImportBatchId = null;
let importJobPollingTimer = null;
let assetUploadAbortController = null;
let isAssetUploading = false;

function showImportError(msg, refId) {
  const alertEl = document.getElementById('importErrorAlert');
  const msgEl = document.getElementById('importErrorMessage');
  let displayMsg = msg || 'An unexpected error occurred.';
  if (refId && !displayMsg.includes(refId)) {
    displayMsg += ` (Reference ID: ${refId})`;
  }
  if (msgEl) msgEl.textContent = displayMsg;
  if (alertEl) alertEl.style.display = 'block';
}

function clearImportError() {
  const alertEl = document.getElementById('importErrorAlert');
  if (alertEl) alertEl.style.display = 'none';
}

function openBulkImportModal() {
  clearImportError();
  currentImportBatchId = null;
  if (importJobPollingTimer) clearInterval(importJobPollingTimer);
  if (assetUploadAbortController) assetUploadAbortController.abort();

  // Reset views
  document.getElementById('step1View').style.display = 'block';
  document.getElementById('step2View').style.display = 'none';
  document.getElementById('step3View').style.display = 'none';

  document.getElementById('stepTab1').style.background = 'var(--admin-primary)';
  document.getElementById('stepTab1').style.color = '#FFF';
  document.getElementById('stepTab2').style.background = '#ECEFF1';
  document.getElementById('stepTab2').style.color = '#546E7A';
  document.getElementById('stepTab3').style.background = '#ECEFF1';
  document.getElementById('stepTab3').style.color = '#546E7A';

  document.getElementById('step1NextBtn').style.display = 'inline-flex';
  document.getElementById('step2NextBtn').style.display = 'none';
  document.getElementById('step3StartBtn').style.display = 'none';
  document.getElementById('finishRefreshBtn').style.display = 'none';

  document.getElementById('bulkImportModal').style.display = 'flex';
}

function closeBulkImportModal() {
  if (importJobPollingTimer) clearInterval(importJobPollingTimer);
  if (assetUploadAbortController) assetUploadAbortController.abort();
  const modal = document.getElementById('bulkImportModal');
  if (modal) modal.style.display = 'none';
}

async function submitStep1Spreadsheet() {
  clearImportError();
  const input = document.getElementById('step1SpreadsheetInput');
  if (!input.files || input.files.length === 0) {
    showImportError('Please select a spreadsheet file (.xlsx, .xls, .csv).');
    return;
  }

  const file = input.files[0];
  const btn = document.getElementById('step1NextBtn');
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Parsing Spreadsheet...';

  const formData = new FormData();
  formData.append('spreadsheet', file);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch('/admin/designs/import-preview', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': getCsrfToken()
      },
      body: formData,
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const data = await res.json();
    btn.disabled = false;
    btn.innerHTML = origHtml;

    if (!res.ok || !data.success) {
      showImportError(data.message || 'Failed to parse spreadsheet file.', data.referenceId);
      return;
    }

    currentImportBatchId = data.batchId;
    setupStep2(data);
  } catch (err) {
    clearTimeout(timeoutId);
    btn.disabled = false;
    btn.innerHTML = origHtml;
    if (err.name === 'AbortError') {
      showImportError('Request timed out. Please verify spreadsheet size or check connection.');
    } else {
      showImportError('Network error parsing spreadsheet: ' + err.message);
    }
  }
}

function setupStep2(data) {
  document.getElementById('step1View').style.display = 'none';
  document.getElementById('step2View').style.display = 'block';
  document.getElementById('step3View').style.display = 'none';

  document.getElementById('stepTab1').style.background = '#ECEFF1';
  document.getElementById('stepTab1').style.color = '#546E7A';
  document.getElementById('stepTab2').style.background = 'var(--admin-primary)';
  document.getElementById('stepTab2').style.color = '#FFF';

  document.getElementById('step1NextBtn').style.display = 'none';
  document.getElementById('step2NextBtn').style.display = 'inline-flex';

  const pillsEl = document.getElementById('step2SummaryPills');
  pillsEl.innerHTML = `
    <div style="background:#E3F2FD; color:#0D47A1; padding:6px 12px; border-radius:8px; font-size:0.78rem; font-weight:700;">
      Total Rows: ${data.totalRows}
    </div>
    <div style="background:#E8F5E9; color:#2E7D32; padding:6px 12px; border-radius:8px; font-size:0.78rem; font-weight:700;">
      Valid Rows: ${data.validRows !== undefined ? data.validRows : data.validCount}
    </div>
    <div style="background:#FFF3E0; color:#E65100; padding:6px 12px; border-radius:8px; font-size:0.78rem; font-weight:700;">
      Duplicates in Catalog: ${data.duplicateRows !== undefined ? data.duplicateRows : data.duplicateCount}
    </div>
    <div style="background:#FFEBEE; color:#C62828; padding:6px 12px; border-radius:8px; font-size:0.78rem; font-weight:700;">
      Errors: ${data.errorRows !== undefined ? data.errorRows : data.errorCount}
    </div>
  `;

  // Render Category Mapping & Ratings Note Container
  let customSection = document.getElementById('step2CustomMappingSection');
  if (!customSection) {
    customSection = document.createElement('div');
    customSection.id = 'step2CustomMappingSection';
    pillsEl.parentNode.insertBefore(customSection, pillsEl.nextSibling);
  }

  let ratingsNoteHtml = '';
  if (data.ratingsIgnored) {
    ratingsNoteHtml = `
      <div style="background: #FFF8E1; border: 1px solid #FFE082; color: #B78103; padding: 10px 14px; border-radius: 10px; font-size: 0.8rem; font-weight: 600; margin-bottom: 1rem; display: flex; align-items: center; gap: 8px;">
        <i class="fa-solid fa-circle-info" style="font-size: 1.1rem; color: #F57F17;"></i>
        <span>${data.ratingsIgnoredNote || 'Rating and Review Count columns were ignored. Real customer reviews are calculated strictly from verified buyer feedback.'}</span>
      </div>
    `;
  }

  let categoryMappingHtml = '';
  if (data.categoriesFound && data.categoriesFound.length > 0) {
    const existingCats = data.existingCategories || [];
    categoryMappingHtml = `
      <div style="background: #FFF; border: 1px solid var(--admin-border); border-radius: 12px; padding: 1.1rem; margin-bottom: 1.2rem; box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <strong style="font-size: 0.88rem; color: var(--admin-text-dark); display: flex; align-items: center; gap: 6px;">
            <i class="fa-solid fa-tags" style="color: var(--admin-primary);"></i> Category Mapping & Resolution
          </strong>
          <span style="font-size: 0.74rem; color: var(--admin-text-muted);">Confirm or re-map spreadsheet categories</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${data.categoriesFound.map(cf => {
            const isMatched = cf.isMatched;
            const badge = isMatched 
              ? `<span style="background: #E8F5E9; color: #2E7D32; padding: 2px 8px; border-radius: 6px; font-weight: 700; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-circle-check"></i> Matched to "${cf.matchedCategoryName}"</span>`
              : `<span style="background: #FFF3E0; color: #E65100; padding: 2px 8px; border-radius: 6px; font-weight: 700; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-triangle-exclamation"></i> Unmatched</span>`;

            return `
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; background: #FAF6F0; border-radius: 8px; font-size: 0.8rem; flex-wrap: wrap;">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <strong style="color: var(--admin-text-dark);">${cf.spreadsheetCategory}</strong>
                  ${badge}
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <label style="font-size: 0.74rem; color: var(--admin-text-muted);">Assign to:</label>
                  <select class="category-map-select" data-raw-category="${cf.spreadsheetCategory}" style="font-size: 0.78rem; padding: 4px 8px; border: 1px solid var(--admin-border); border-radius: 6px; background: #FFF; font-weight: 600;">
                    ${cf.isMatched ? `<option value="${cf.matchedCategoryId}" selected>Keep Matched: ${cf.matchedCategoryName}</option>` : ''}
                    <optgroup label="Existing Store Categories">
                      ${existingCats.map(ec => `<option value="${ec.id}" ${(!cf.isMatched && ec.id === cf.matchedCategoryId) ? 'selected' : ''}>${ec.name}</option>`).join('')}
                    </optgroup>
                    <option value="__NEW__" ${!cf.isMatched ? 'selected' : ''}>+ Create New Category "${cf.spreadsheetCategory}"</option>
                  </select>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  customSection.innerHTML = ratingsNoteHtml + categoryMappingHtml;

  const previewList = data.preview || data.previewRows || [];
  document.getElementById('previewRowsCountBadge').textContent = `Showing ${previewList.length} of ${data.totalRows} rows`;

  const tbody = document.getElementById('step2PreviewTbody');
  tbody.innerHTML = '';

  previewList.forEach(r => {
    const tr = document.createElement('tr');
    if (r.validationStatus === 'error' || r.error) tr.style.background = '#FFEBEE';
    else if (r.validationStatus === 'duplicate' || r.isDuplicate) tr.style.background = '#FFF8E1';

    let statusBadge = '<span style="background:#E8F5E9; color:#2E7D32; padding:2px 6px; border-radius:4px; font-weight:700; font-size:0.7rem;"><i class="fa-solid fa-circle-check"></i> VALID</span>';
    if (r.validationStatus === 'error' || r.error) {
      statusBadge = '<span style="background:#FFEBEE; color:#C62828; padding:2px 6px; border-radius:4px; font-weight:700; font-size:0.7rem;"><i class="fa-solid fa-circle-xmark"></i> ERROR</span>';
    } else if (r.validationStatus === 'duplicate' || r.isDuplicate) {
      statusBadge = '<span style="background:#FFF3E0; color:#E65100; padding:2px 6px; border-radius:4px; font-weight:700; font-size:0.7rem;"><i class="fa-solid fa-triangle-exclamation"></i> DUPLICATE</span>';
    }

    tr.innerHTML = `
      <td style="font-weight:700;">#${r.rowNo || r.rowNumber}</td>
      <td>${statusBadge}</td>
      <td><code>${r.sku || '-'}</code></td>
      <td><strong>${r.title}</strong></td>
      <td>${r.categoryName || '-'}</td>
      <td>₹${r.price} ${r.salePrice ? '/ ₹' + r.salePrice : ''}</td>
      <td style="color:${(r.error || r.validationError) ? '#C62828' : '#2E7D32'}; font-size:0.72rem;">${r.error || r.validationError || 'Ready'}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function startChunkedAssetUpload() {
  clearImportError();
  const input = document.getElementById('step2AssetFilesInput');
  if (!input.files || input.files.length === 0) {
    showImportError('Please select preview images or machine ZIP files to upload.');
    return;
  }

  const allFiles = Array.from(input.files);
  const totalFiles = allFiles.length;
  const batchSize = 8;
  const batches = [];

  for (let i = 0; i < totalFiles; i += batchSize) {
    batches.push(allFiles.slice(i, i + batchSize));
  }

  const startBtn = document.getElementById('startAssetUploadBtn');
  const cancelBtn = document.getElementById('cancelAssetUploadBtn');
  const progressContainer = document.getElementById('assetUploadProgressContainer');
  const statusText = document.getElementById('assetUploadStatusText');
  const percentText = document.getElementById('assetUploadPercentText');
  const progressBar = document.getElementById('assetProgressBar');

  startBtn.disabled = true;
  cancelBtn.style.display = 'inline-flex';
  progressContainer.style.display = 'block';

  isAssetUploading = true;
  assetUploadAbortController = new AbortController();

  let uploadedFilesCount = 0;
  let totalMatchedImgs = 0;
  let totalMatchedZIPs = 0;
  let totalUnmatched = 0;

  const concurrency = 3;
  let currentBatchIndex = 0;

  async function uploadSingleBatch(batch, batchIdx) {
    if (!isAssetUploading) return;
    const formData = new FormData();
    formData.append('batchId', currentImportBatchId);
    batch.forEach(f => formData.append('assets', f));

    let attempts = 0;
    let success = false;
    let resultData = null;

    while (attempts < 3 && !success && isAssetUploading) {
      attempts++;
      try {
        const res = await fetch('/admin/designs/import-upload-assets', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'X-CSRF-Token': getCsrfToken()
          },
          body: formData,
          signal: assetUploadAbortController.signal
        });
        const data = await res.json();
        if (res.ok && data.success) {
          success = true;
          resultData = data;
        } else {
          console.warn(`Batch ${batchIdx + 1} attempt ${attempts} failed:`, data.message);
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.warn(`Batch ${batchIdx + 1} attempt ${attempts} error:`, err);
      }
    }

    if (success && resultData) {
      uploadedFilesCount += batch.length;
      totalMatchedImgs = resultData.totalMatchedImages || totalMatchedImgs;
      totalMatchedZIPs = resultData.totalMatchedFiles || totalMatchedZIPs;
      if (resultData.results) {
        totalUnmatched += resultData.results.filter(r => r.status === 'unmatched').length;
      }

      const pct = Math.min(100, Math.round((uploadedFilesCount / totalFiles) * 100));
      progressBar.style.width = pct + '%';
      percentText.textContent = pct + '%';
      statusText.textContent = `Uploaded ${uploadedFilesCount} / ${totalFiles} asset files...`;
    }
  }

  async function worker() {
    while (currentBatchIndex < batches.length && isAssetUploading) {
      const idx = currentBatchIndex++;
      await uploadSingleBatch(batches[idx], idx);
    }
  }

  const workers = [];
  for (let w = 0; w < Math.min(concurrency, batches.length); w++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  isAssetUploading = false;
  startBtn.disabled = false;
  cancelBtn.style.display = 'none';

  document.getElementById('matchedImagesCount').textContent = totalMatchedImgs;
  document.getElementById('matchedFilesCount').textContent = totalMatchedZIPs;
  document.getElementById('unmatchedCount').textContent = totalUnmatched;
  document.getElementById('assetMatchReportCard').style.display = 'block';
  statusText.textContent = `Asset upload finished: ${uploadedFilesCount} files processed.`;
}

function cancelAssetUpload() {
  isAssetUploading = false;
  if (assetUploadAbortController) assetUploadAbortController.abort();
  document.getElementById('cancelAssetUploadBtn').style.display = 'none';
  document.getElementById('startAssetUploadBtn').disabled = false;
  document.getElementById('assetUploadStatusText').textContent = 'Upload cancelled by user.';
}

function goToStep3() {
  clearImportError();
  document.getElementById('step2View').style.display = 'none';
  document.getElementById('step3View').style.display = 'block';

  document.getElementById('stepTab2').style.background = '#ECEFF1';
  document.getElementById('stepTab2').style.color = '#546E7A';
  document.getElementById('stepTab3').style.background = 'var(--admin-primary)';
  document.getElementById('stepTab3').style.color = '#FFF';

  document.getElementById('step2NextBtn').style.display = 'none';
  document.getElementById('step3StartBtn').style.display = 'inline-flex';

  const preConfirmEl = document.getElementById('step3AssetPreConfirmContent');
  if (preConfirmEl) {
    const matchedImgs = parseInt(document.getElementById('matchedImagesCount')?.textContent || '0', 10);
    const matchedZips = parseInt(document.getElementById('matchedFilesCount')?.textContent || '0', 10);
    const unmatched = parseInt(document.getElementById('unmatchedCount')?.textContent || '0', 10);
    if (matchedImgs > 0 || matchedZips > 0 || unmatched > 0) {
      preConfirmEl.innerHTML = `
        <span style="color:#2E7D32; font-weight:700;"><i class="fa-solid fa-circle-check"></i> Matched Preview Images: <strong>${matchedImgs}</strong></span>
        <span style="color:#1565C0; font-weight:700;"><i class="fa-solid fa-file-zipper"></i> Matched Machine Files / ZIPs: <strong>${matchedZips}</strong></span>
        ${unmatched > 0 ? `<span style="color:#E65100; font-weight:700;"><i class="fa-solid fa-triangle-exclamation"></i> Unmatched Files: <strong>${unmatched}</strong></span>` : ''}
      `;
    } else {
      preConfirmEl.innerHTML = `<span style="color: var(--admin-text-muted);">No assets uploaded in Step 2. Designs will be imported and you can upload preview images and machine ZIP files later via "Bulk Image Upload" or "Bulk Upload ZIP Files".</span>`;
    }
  }
}

async function submitStep3StartJob() {
  clearImportError();
  const btn = document.getElementById('step3StartBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Starting Import...';

  const updateExisting = document.getElementById('updateExistingCheckbox').checked;
  const skipErrors = document.getElementById('skipErrorsCheckbox').checked;

  const categoryMappings = {};
  document.querySelectorAll('.category-map-select').forEach(sel => {
    if (sel.dataset && sel.dataset.rawCategory) {
      categoryMappings[sel.dataset.rawCategory] = sel.value;
    }
  });

  try {
    const res = await fetch('/admin/designs/import-start-job', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': getCsrfToken()
      },
      body: JSON.stringify({
        batchId: currentImportBatchId,
        updateExisting,
        skipErrors,
        categoryMappings
      })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-rocket"></i> Start Background Import';
      showImportError(data.message || 'Failed to start import job.', data.referenceId);
      return;
    }

    btn.style.display = 'none';
    document.getElementById('step3ConfirmBox').style.display = 'none';
    document.getElementById('step3ProgressBox').style.display = 'block';

    startLivePolling(currentImportBatchId);

  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-rocket"></i> Start Background Import';
    showImportError('Error starting import: ' + err.message);
  }
}

function startLivePolling(batchId) {
  if (importJobPollingTimer) clearInterval(importJobPollingTimer);

  importJobPollingTimer = setInterval(async () => {
    try {
      const res = await fetch(`/admin/designs/import-job-status/${batchId}`, {
        headers: { 'Accept': 'application/json' }
      });
      const status = await res.json();

      if (!res.ok || !status.success) return;

      const total = status.totalRows || 1;
      const processed = (status.importedCount || 0) + (status.skippedCount || 0) + (status.failedCount || 0);
      const pct = status.progressPercent || 0;

      document.getElementById('importLiveStatusSub').textContent = `${processed} / ${total} designs processed (${pct}%)`;
      document.getElementById('importLiveProgressBar').style.width = pct + '%';
      document.getElementById('liveImportedCount').textContent = status.importedCount || 0;
      document.getElementById('liveSkippedCount').textContent = status.skippedCount || 0;
      document.getElementById('liveFailedCount').textContent = status.failedCount || 0;

      if (status.status === 'completed' || status.status === 'failed') {
        clearInterval(importJobPollingTimer);
        onImportJobCompleted(status);
      }
    } catch (pollErr) {
      console.warn('Job polling warn:', pollErr);
    }
  }, 1000);
}

function onImportJobCompleted(status) {
  document.getElementById('importLiveStatusTitle').innerHTML = '<i class="fa-solid fa-circle-check" style="color:#2E7D32;"></i> Import Completed!';
  document.getElementById('finishRefreshBtn').style.display = 'inline-flex';

  const resultCard = document.getElementById('step3ResultCard');
  resultCard.style.display = 'block';

  document.getElementById('step3ResultSummaryText').innerHTML = `
    Successfully imported <strong>${status.importedCount || 0}</strong> design(s). 
    ${status.skippedCount > 0 ? `<strong>${status.skippedCount}</strong> row(s) skipped. ` : ''}
    ${status.failedCount > 0 ? `<span style="color:#C62828;"><strong>${status.failedCount}</strong> row(s) failed.</span>` : ''}
  `;

  document.getElementById('downloadErrorReportBtn').href = `/admin/designs/import-error-report/${currentImportBatchId}`;
}

async function rollbackCurrentImport() {
  if (!confirm('Are you sure you want to rollback this import? All designs created by this import session will be permanently deleted from catalog.')) {
    return;
  }

  const btn = document.getElementById('rollbackJobBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Rolling back...';

  try {
    const res = await fetch(`/admin/designs/import-rollback/${currentImportBatchId}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': getCsrfToken()
      }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      alert(data.message || 'Import rolled back successfully.');
      window.location.reload();
    } else {
      alert(data.message || 'Rollback failed.');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Rollback this Import';
    }
  } catch (e) {
    alert('Error rolling back: ' + e.message);
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Rollback this Import';
  }
}

function finishAndReload() {
  window.location.reload();
}

// -----------------------------------------------------------------------------
// Duplicate Design Handler
// -----------------------------------------------------------------------------
async function duplicateDesign(id, title) {
  if (!confirm(`Duplicate design "${title}"? A new draft copy will be created with the next SKU.`)) return;
  try {
    const res = await fetch(`/admin/designs/duplicate/${id}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': getCsrfToken()
      },
      body: JSON.stringify({ _csrf: getCsrfToken() })
    });
    const data = await res.json();
    if (data.success) {
      if (typeof showToast === 'function') showToast(data.message || 'Design duplicated successfully!');
      else if (typeof showAdminToast === 'function') showAdminToast(data.message || 'Design duplicated successfully!');
      else alert(data.message || 'Design duplicated successfully!');
      setTimeout(() => { window.location.reload(); }, 900);
    } else {
      alert(data.message || 'Error duplicating design');
    }
  } catch (e) {
    alert('Network error duplicating design.');
  }
}

// -----------------------------------------------------------------------------
// Replace Single Product Image Modal Handlers
// -----------------------------------------------------------------------------
function openReplaceImageModal(id, title) {
  const designIdInput = document.getElementById('replaceImageDesignId');
  if (designIdInput) designIdInput.value = id;
  const titleEl = document.getElementById('replaceImageTitle');
  if (titleEl) titleEl.textContent = `Product: ${title} (#${id})`;
  const fileInput = document.getElementById('replaceImageFileInput');
  if (fileInput) fileInput.value = '';
  const previewContainer = document.getElementById('replaceImagePreviewContainer');
  if (previewContainer) previewContainer.style.display = 'none';
  const modal = document.getElementById('replaceImageModal');
  if (modal) modal.style.display = 'flex';
}

function closeReplaceImageModal() {
  const modal = document.getElementById('replaceImageModal');
  if (modal) modal.style.display = 'none';
}

function previewSelectedReplaceImage(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const previewImg = document.getElementById('replaceImagePreviewImg');
      if (previewImg) previewImg.src = e.target.result;
      const previewContainer = document.getElementById('replaceImagePreviewContainer');
      if (previewContainer) previewContainer.style.display = 'block';
    };
    reader.readAsDataURL(input.files[0]);
  }
}

async function submitReplaceImage(event) {
  if (event) event.preventDefault();
  const id = document.getElementById('replaceImageDesignId').value;
  const fileInput = document.getElementById('replaceImageFileInput');
  if (!fileInput.files || fileInput.files.length === 0) {
    alert('Please select an image file to upload.');
    return;
  }

  const btn = document.getElementById('replaceImageSubmitBtn');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading...';
  }

  const formData = new FormData();
  formData.append('_csrf', getCsrfToken());
  formData.append('image', fileInput.files[0]);

  try {
    const res = await fetch(`/admin/designs/replace-image/${id}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': getCsrfToken()
      },
      body: formData
    });
    const data = await res.json();
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }

    if (data.success) {
      closeReplaceImageModal();
      if (typeof showToast === 'function') showToast(data.message || 'Image replaced successfully!');
      else if (typeof showAdminToast === 'function') showAdminToast(data.message || 'Image replaced successfully!');
      else alert(data.message || 'Image replaced successfully!');
      setTimeout(() => { window.location.reload(); }, 900);
    } else {
      alert(data.message || 'Failed to replace image.');
    }
  } catch (e) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
    alert('Network error while replacing image: ' + e.message);
  }
}

/**
 * ============================================================================
 * BULK MACHINE FILES (ZIP) UPLOAD & RELIABLE CHUNKED ENGINE
 * ============================================================================
 */

const bulkZipUploadState = {
  isUploading: false,
  isCancelled: false,
  chunkSize: 2 * 1024 * 1024, // 2MB chunk size for reliable upload on Hostinger
  chunkThreshold: 5 * 1024 * 1024, // Files > 5MB use chunked upload
  maxConcurrency: 2, // Max 2 parallel file streams
  activeStreams: 0,
  maxUploadSizeMb: 100, // Dynamically loaded from Settings
  items: [],
  activeControllers: new Set(),
  stats: {
    total: 0,
    processed: 0,
    linked: 0,
    unmatched: 0,
    ambiguous: 0,
    failed: 0,
    totalBytes: 0,
    uploadedBytes: 0
  },
  catalogDesigns: [],
  startTime: null,
  speedInterval: null
};

// Open the Bulk ZIP Upload Modal
async function openBulkZipUploadModal() {
  const modal = document.getElementById('bulkZipUploadModal');
  if (!modal) return;

  // Reset UI components
  resetBulkZipModalUI();

  modal.style.display = 'flex';

  try {
    const res = await fetch('/admin/designs/bulk-zip-check');
    const data = await res.json();

    if (data.success) {
      bulkZipUploadState.catalogDesigns = data.designs || [];
      if (data.maxUploadSizeMb) {
        bulkZipUploadState.maxUploadSizeMb = data.maxUploadSizeMb;
        const lbl = document.getElementById('bulkZipMaxSizeLabel');
        if (lbl) lbl.textContent = `${data.maxUploadSizeMb} MB`;
      }

      const emptyWarning = document.getElementById('bulkZipEmptyDbWarning');
      const fileSection = document.getElementById('bulkZipFileSelectSection');
      const submitBtn = document.getElementById('bulkZipSubmitBtn');

      if (data.isEmpty) {
        if (emptyWarning) emptyWarning.style.display = 'block';
        if (fileSection) fileSection.style.display = 'none';
        if (submitBtn) submitBtn.disabled = true;
      } else {
        if (emptyWarning) emptyWarning.style.display = 'none';
        if (fileSection) fileSection.style.display = 'block';
        if (submitBtn) submitBtn.disabled = false;
      }
    }
  } catch (err) {
    console.warn('[Bulk ZIP Pre-check Error]:', err);
  }
}

function closeBulkZipUploadModal() {
  const modal = document.getElementById('bulkZipUploadModal');
  if (!modal) return;

  if (bulkZipUploadState.isUploading) {
    if (!confirm('An upload is currently in progress. Do you really want to close and cancel the upload?')) {
      return;
    }
    abortBulkZipUpload();
  }

  modal.style.display = 'none';
}

function resetBulkZipModalUI() {
  bulkZipUploadState.isUploading = false;
  bulkZipUploadState.isCancelled = false;
  bulkZipUploadState.items = [];
  bulkZipUploadState.activeControllers.clear();
  bulkZipUploadState.stats = { total: 0, processed: 0, linked: 0, unmatched: 0, ambiguous: 0, failed: 0, totalBytes: 0, uploadedBytes: 0 };
  bulkZipUploadState.startTime = null;
  if (bulkZipUploadState.speedInterval) {
    clearInterval(bulkZipUploadState.speedInterval);
    bulkZipUploadState.speedInterval = null;
  }

  const fileInput = document.getElementById('bulkZipFilesInput');
  if (fileInput) fileInput.value = '';

  const preSummary = document.getElementById('bulkZipPreUploadSummary');
  if (preSummary) preSummary.style.display = 'none';

  const progressSection = document.getElementById('bulkZipProgressSection');
  if (progressSection) progressSection.style.display = 'none';

  const reportCard = document.getElementById('bulkZipReportCard');
  if (reportCard) reportCard.style.display = 'none';

  const abortBtn = document.getElementById('bulkZipAbortBtn');
  if (abortBtn) abortBtn.style.display = 'none';

  const cancelCloseBtn = document.getElementById('bulkZipCancelCloseBtn');
  if (cancelCloseBtn) cancelCloseBtn.style.display = 'inline-block';

  const submitBtn = document.getElementById('bulkZipSubmitBtn');
  if (submitBtn) {
    submitBtn.style.display = 'inline-flex';
    submitBtn.disabled = true;
  }

  const finishRefreshBtn = document.getElementById('bulkZipFinishRefreshBtn');
  if (finishRefreshBtn) finishRefreshBtn.style.display = 'none';

  const fileSection = document.getElementById('bulkZipFileSelectSection');
  if (fileSection) fileSection.style.display = 'block';

  const liveList = document.getElementById('bulkZipLiveList');
  if (liveList) liveList.innerHTML = '';
}

// Handle file selection and perform pre-upload Dry-Run matching
async function handleBulkZipFilesSelected(input) {
  const files = input.files ? Array.from(input.files) : [];
  if (files.length === 0) return;

  const allowedExts = ['.zip', '.rar', '.dst', '.pes', '.jef', '.exp'];
  const maxBytes = bulkZipUploadState.maxUploadSizeMb * 1024 * 1024;

  let totalBytes = 0;
  const warnings = [];
  const items = [];

  files.forEach((file, idx) => {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    const isValidExt = allowedExts.includes(ext);
    const isOversized = file.size > maxBytes;

    if (!isValidExt) {
      warnings.push(`"${file.name}": Unsupported format. Allowed: .zip, .rar, .dst, .pes, .jef, .exp`);
    } else if (isOversized) {
      warnings.push(`"${file.name}" exceeds ${bulkZipUploadState.maxUploadSizeMb} MB limit (${formatBytes(file.size)}).`);
    }

    const isValid = isValidExt && !isOversized;
    if (isValid) totalBytes += file.size;

    items.push({
      id: idx + 1,
      file,
      originalName: file.name,
      size: file.size,
      formattedSize: formatBytes(file.size),
      isValid,
      isChunked: file.size > bulkZipUploadState.chunkThreshold,
      status: isValid ? 'pending' : 'failed',
      details: isValid ? 'Pending upload' : (isOversized ? 'File oversized' : 'Unsupported format'),
      error: isValid ? null : 'Validation failed'
    });
  });

  bulkZipUploadState.items = items;
  bulkZipUploadState.stats.total = items.filter(it => it.isValid).length;
  bulkZipUploadState.stats.totalBytes = totalBytes;

  const preSummary = document.getElementById('bulkZipPreUploadSummary');
  const preCount = document.getElementById('bulkZipPreSelectedCount');
  const preSize = document.getElementById('bulkZipPreSelectedSize');
  const preChunkPlan = document.getElementById('bulkZipPreChunkingPlan');
  const preWarnings = document.getElementById('bulkZipPreValidationWarnings');
  const submitBtn = document.getElementById('bulkZipSubmitBtn');

  const validCount = items.filter(it => it.isValid).length;
  const chunkedCount = items.filter(it => it.isValid && it.isChunked).length;

  if (preCount) preCount.textContent = `${validCount} / ${files.length}`;
  if (preSize) preSize.textContent = formatBytes(totalBytes);
  if (preChunkPlan) preChunkPlan.textContent = `${chunkedCount} large files (> 5MB) will be chunked in 2MB slices`;

  if (warnings.length > 0 && preWarnings) {
    preWarnings.innerHTML = `<strong><i class="fa-solid fa-triangle-exclamation"></i> Warnings:</strong><ul style="margin: 4px 0 0 16px; padding: 0;">` +
      warnings.slice(0, 5).map(w => `<li>${w}</li>`).join('') +
      (warnings.length > 5 ? `<li>...and ${warnings.length - 5} more</li>` : '') +
      `</ul>`;
    preWarnings.style.display = 'block';
  } else if (preWarnings) {
    preWarnings.style.display = 'none';
  }

  if (preSummary) preSummary.style.display = 'block';
  if (submitBtn) submitBtn.disabled = validCount === 0;

  // Run Dry-Run Match on Server
  await runBulkZipDryRun(items.filter(it => it.isValid).map(it => it.originalName));
}

// Dry-run match call
async function runBulkZipDryRun(filenames) {
  const dryCard = document.getElementById('bulkZipDryRunCard');
  const statusText = document.getElementById('bulkZipDryRunStatusText');
  const matchedBadge = document.getElementById('bulkZipDryMatchedCount');
  const unmatchedBadge = document.getElementById('bulkZipDryUnmatchedCount');
  const ambiguousBadge = document.getElementById('bulkZipDryAmbiguousCount');
  const dryWarn = document.getElementById('bulkZipDryRunWarning');

  if (!dryCard || filenames.length === 0) return;

  if (statusText) statusText.textContent = 'Running dry-run match...';

  try {
    const res = await fetch('/admin/designs/bulk-zip-dry-run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-CSRF-Token': getCsrfToken()
      },
      body: JSON.stringify({ filenames, _csrf: getCsrfToken() })
    });
    const data = await res.json();

    if (data.success) {
      if (statusText) statusText.textContent = 'Dry-run check complete';
      if (matchedBadge) matchedBadge.textContent = data.matchedCount;
      if (unmatchedBadge) unmatchedBadge.textContent = data.unmatchedCount;
      if (ambiguousBadge) ambiguousBadge.textContent = data.ambiguousCount;

      if (dryWarn) {
        dryWarn.style.display = (data.unmatchedCount > 0 || data.ambiguousCount > 0) ? 'block' : 'none';
      }
    } else {
      if (statusText) statusText.textContent = data.message || 'Check failed';
    }
  } catch (err) {
    console.warn('[Dry-Run Match Network Error]:', err);
    if (statusText) statusText.textContent = 'Network check skipped';
  }
}

// Initialize and start parallel stream workers
async function startChunkedBulkZipUpload() {
  const pendingItems = bulkZipUploadState.items.filter(it => it.isValid && it.status === 'pending');
  if (pendingItems.length === 0) {
    alert('No valid files selected for upload.');
    return;
  }

  bulkZipUploadState.isUploading = true;
  bulkZipUploadState.isCancelled = false;
  bulkZipUploadState.startTime = Date.now();

  // Switch UI to Progress Mode
  const fileSection = document.getElementById('bulkZipFileSelectSection');
  const preSummary = document.getElementById('bulkZipPreUploadSummary');
  const progressSection = document.getElementById('bulkZipProgressSection');
  const abortBtn = document.getElementById('bulkZipAbortBtn');
  const submitBtn = document.getElementById('bulkZipSubmitBtn');
  const cancelCloseBtn = document.getElementById('bulkZipCancelCloseBtn');

  if (fileSection) fileSection.style.display = 'none';
  if (preSummary) preSummary.style.display = 'none';
  if (progressSection) progressSection.style.display = 'block';
  if (abortBtn) abortBtn.style.display = 'inline-flex';
  if (submitBtn) submitBtn.style.display = 'none';
  if (cancelCloseBtn) cancelCloseBtn.style.display = 'none';

  renderBulkZipLiveList();
  updateBulkZipProgressCounters();

  // Speed and ETA calculation timer
  bulkZipUploadState.speedInterval = setInterval(updateBulkZipSpeedAndEta, 1000);

  // Worker Queue
  const queue = [...pendingItems];
  const workers = [];

  for (let i = 0; i < bulkZipUploadState.maxConcurrency; i++) {
    workers.push(runBulkZipWorker(queue));
  }

  await Promise.all(workers);

  if (bulkZipUploadState.speedInterval) {
    clearInterval(bulkZipUploadState.speedInterval);
    bulkZipUploadState.speedInterval = null;
  }

  onBulkZipUploadFinished();
}

async function runBulkZipWorker(queue) {
  while (queue.length > 0 && !bulkZipUploadState.isCancelled) {
    const item = queue.shift();
    if (!item) break;

    bulkZipUploadState.activeStreams++;
    updateBulkZipProgressCounters();

    try {
      if (item.isChunked) {
        await processSingleZipItemChunked(item);
      } else {
        await processSingleZipItemDirect(item);
      }
    } catch (err) {
      item.status = 'failed';
      item.details = err.message || 'Upload error';
      bulkZipUploadState.stats.failed++;
      bulkZipUploadState.stats.processed++;
      updateBulkZipLiveItemRow(item);
    } finally {
      bulkZipUploadState.activeStreams--;
      updateBulkZipProgressCounters();
    }
  }
}

// Upload file using chunked slices
async function processSingleZipItemChunked(item) {
  const file = item.file;
  const totalChunks = Math.ceil(file.size / bulkZipUploadState.chunkSize);
  const uploadId = `zip_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

  item.status = 'uploading';
  item.details = `Starting chunked upload (${totalChunks} chunks)...`;
  updateBulkZipLiveItemRow(item);

  for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
    if (bulkZipUploadState.isCancelled) {
      item.status = 'failed';
      item.details = 'Cancelled by user';
      bulkZipUploadState.stats.failed++;
      bulkZipUploadState.stats.processed++;
      updateBulkZipLiveItemRow(item);
      return;
    }

    const start = chunkIdx * bulkZipUploadState.chunkSize;
    const end = Math.min(file.size, start + bulkZipUploadState.chunkSize);
    const chunkBlob = file.slice(start, end);

    let success = false;
    let attempt = 0;
    let lastErr = null;

    while (attempt < 3 && !success && !bulkZipUploadState.isCancelled) {
      attempt++;
      try {
        item.details = `Chunk ${chunkIdx + 1}/${totalChunks} (attempt ${attempt})...`;
        updateBulkZipLiveItemRow(item);

        await uploadChunkWithTimeout(chunkBlob, uploadId, chunkIdx, totalChunks, file.name);
        success = true;
        bulkZipUploadState.stats.uploadedBytes += chunkBlob.size;
      } catch (err) {
        lastErr = err;
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
        }
      }
    }

    if (!success) {
      throw new Error(`Chunk ${chunkIdx + 1}/${totalChunks} failed: ${lastErr ? lastErr.message : 'Timeout'}`);
    }
  }

  if (bulkZipUploadState.isCancelled) return;

  // Complete & Assemble on server
  item.details = 'Assembling chunks and validating archive...';
  updateBulkZipLiveItemRow(item);

  const controller = new AbortController();
  bulkZipUploadState.activeControllers.add(controller);

  try {
    const res = await fetch('/admin/designs/bulk-zip-complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-CSRF-Token': getCsrfToken()
      },
      signal: controller.signal,
      body: JSON.stringify({
        uploadId,
        totalChunks,
        originalName: file.name,
        fileSize: file.size,
        _csrf: getCsrfToken()
      })
    });
    const result = await res.json();
    bulkZipUploadState.activeControllers.delete(controller);

    handleZipItemResult(item, result);
  } catch (err) {
    bulkZipUploadState.activeControllers.delete(controller);
    throw err;
  }
}

function uploadChunkWithTimeout(chunkBlob, uploadId, chunkIndex, totalChunks, originalName) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    bulkZipUploadState.activeControllers.add(controller);

    const timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('Chunk upload timed out (60s).'));
    }, 60000);

    const formData = new FormData();
    formData.append('chunk', chunkBlob, `chunk_${chunkIndex}`);
    formData.append('uploadId', uploadId);
    formData.append('chunkIndex', String(chunkIndex));
    formData.append('totalChunks', String(totalChunks));
    formData.append('originalName', originalName);
    formData.append('_csrf', getCsrfToken());

    fetch('/admin/designs/bulk-zip-chunk', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'X-CSRF-Token': getCsrfToken()
      },
      signal: controller.signal,
      body: formData
    })
      .then(res => res.json())
      .then(data => {
        clearTimeout(timeout);
        bulkZipUploadState.activeControllers.delete(controller);
        if (data.success) resolve(data);
        else reject(new Error(data.message || 'Chunk failed'));
      })
      .catch(err => {
        clearTimeout(timeout);
        bulkZipUploadState.activeControllers.delete(controller);
        reject(err);
      });
  });
}

// Upload small file directly
async function processSingleZipItemDirect(item) {
  item.status = 'uploading';
  item.details = 'Uploading...';
  updateBulkZipLiveItemRow(item);

  const controller = new AbortController();
  bulkZipUploadState.activeControllers.add(controller);

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 60000);

  const formData = new FormData();
  formData.append('files', item.file);
  formData.append('_csrf', getCsrfToken());

  try {
    const res = await fetch('/admin/designs/bulk-upload-zips', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'X-CSRF-Token': getCsrfToken()
      },
      signal: controller.signal,
      body: formData
    });
    clearTimeout(timeoutId);
    bulkZipUploadState.activeControllers.delete(controller);

    const data = await res.json();
    bulkZipUploadState.stats.uploadedBytes += item.file.size;

    if (!res.ok) throw new Error(data.message || `Server error ${res.status}`);

    const matched = (data.matched || []).find(m => m.filename === item.originalName);
    const ambiguous = (data.ambiguous || []).find(a => a.filename === item.originalName);
    const unmatched = (data.unmatched || []).find(u => u.filename === item.originalName);
    const failed = (data.failed || []).find(f => f.filename === item.originalName);

    if (matched) {
      handleZipItemResult(item, { status: 'matched', ...matched });
    } else if (ambiguous) {
      handleZipItemResult(item, { status: 'ambiguous', ...ambiguous });
    } else if (unmatched) {
      handleZipItemResult(item, { status: 'unmatched', ...unmatched });
    } else if (failed) {
      handleZipItemResult(item, { status: 'failed', error: failed.error });
    } else {
      handleZipItemResult(item, { status: 'unmatched', reason: 'No product matched' });
    }
  } catch (err) {
    clearTimeout(timeoutId);
    bulkZipUploadState.activeControllers.delete(controller);
    throw err;
  }
}

function handleZipItemResult(item, result) {
  if (result.status === 'matched') {
    item.status = 'linked';
    item.matchedDesignId = result.designId;
    item.matchedSku = result.sku;
    item.matchedTitle = result.title;
    item.formats = result.formats || [];
    item.checksum = result.checksum;
    item.details = `Linked to #${result.designId} (${result.sku || result.title})`;
    bulkZipUploadState.stats.linked++;
  } else if (result.status === 'ambiguous') {
    item.status = 'ambiguous';
    item.tempToken = result.tempToken;
    item.candidates = result.candidates || [];
    item.checksum = result.checksum;
    item.formats = result.detectedFormats || [];
    item.details = `Ambiguous (${item.candidates.length} candidates)`;
    bulkZipUploadState.stats.ambiguous++;
  } else if (result.status === 'unmatched') {
    item.status = 'unmatched';
    item.tempToken = result.tempToken;
    item.suggestions = result.suggestions || [];
    item.checksum = result.checksum;
    item.formats = result.detectedFormats || [];
    item.details = 'No matching product';
    bulkZipUploadState.stats.unmatched++;
  } else {
    item.status = 'failed';
    item.details = result.error || 'Failed';
    bulkZipUploadState.stats.failed++;
  }

  bulkZipUploadState.stats.processed++;
  updateBulkZipLiveItemRow(item);
  updateBulkZipProgressCounters();
}

function updateBulkZipProgressCounters() {
  const { total, processed, linked, unmatched, ambiguous, failed } = bulkZipUploadState.stats;
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  const bar = document.getElementById('bulkZipProgressBar');
  if (bar) bar.style.width = `${pct}%`;

  const counterText = document.getElementById('bulkZipOverallProgressCounter');
  if (counterText) counterText.textContent = `${processed} / ${total} uploaded (${pct}%)`;

  const linkedEl = document.getElementById('bulkZipLinkedCount');
  if (linkedEl) linkedEl.textContent = linked;

  const unmatchedEl = document.getElementById('bulkZipUnmatchedCount');
  if (unmatchedEl) unmatchedEl.textContent = unmatched;

  const ambiguousEl = document.getElementById('bulkZipAmbiguousCount');
  if (ambiguousEl) ambiguousEl.textContent = ambiguous;

  const failedEl = document.getElementById('bulkZipFailedCount');
  if (failedEl) failedEl.textContent = failed;

  const streamsEl = document.getElementById('bulkZipActiveStreamsText');
  if (streamsEl) streamsEl.textContent = `Streams: ${bulkZipUploadState.activeStreams} / ${bulkZipUploadState.maxConcurrency}`;
}

function updateBulkZipSpeedAndEta() {
  if (!bulkZipUploadState.startTime || bulkZipUploadState.stats.totalBytes === 0) return;

  const elapsedSeconds = Math.max(1, (Date.now() - bulkZipUploadState.startTime) / 1000);
  const bytesPerSec = bulkZipUploadState.stats.uploadedBytes / elapsedSeconds;
  const remainingBytes = Math.max(0, bulkZipUploadState.stats.totalBytes - bulkZipUploadState.stats.uploadedBytes);

  let etaText = 'Estimating...';
  if (bytesPerSec > 1024 && remainingBytes > 0) {
    const remainingSecs = Math.round(remainingBytes / bytesPerSec);
    if (remainingSecs < 60) etaText = `~${remainingSecs}s remaining`;
    else etaText = `~${Math.round(remainingSecs / 60)}m remaining`;
  } else if (remainingBytes === 0) {
    etaText = 'Finishing...';
  }

  const speedStr = `${formatBytes(bytesPerSec)}/s`;
  const speedEtaEl = document.getElementById('bulkZipSpeedEtaText');
  if (speedEtaEl) {
    speedEtaEl.textContent = `Speed: ${speedStr} | ${etaText}`;
  }
}

function renderBulkZipLiveList() {
  const listContainer = document.getElementById('bulkZipLiveList');
  if (!listContainer) return;

  const html = bulkZipUploadState.items.map(item => {
    let icon = '<i class="fa-regular fa-clock" style="color: #8C7F79;"></i>';
    let badgeColor = '#FAF9F6';
    let borderColor = 'var(--admin-border)';
    let statusText = item.details || 'Pending';

    if (item.status === 'uploading') {
      icon = '<i class="fa-solid fa-spinner fa-spin" style="color: #2E7D32;"></i>';
      badgeColor = '#E8F5E9';
      borderColor = '#C8E6C9';
    } else if (item.status === 'linked') {
      icon = '<i class="fa-solid fa-circle-check" style="color: #2E7D32;"></i>';
      badgeColor = '#E8F5E9';
      borderColor = '#C8E6C9';
    } else if (item.status === 'ambiguous') {
      icon = '<i class="fa-solid fa-code-compare" style="color: #BF360C;"></i>';
      badgeColor = '#FFF3E0';
      borderColor = '#FFCCBC';
    } else if (item.status === 'unmatched') {
      icon = '<i class="fa-solid fa-circle-question" style="color: #E65100;"></i>';
      badgeColor = '#FFF8E1';
      borderColor = '#FFE082';
    } else if (item.status === 'failed') {
      icon = '<i class="fa-solid fa-circle-xmark" style="color: #C62828;"></i>';
      badgeColor = '#FFEBEE';
      borderColor = '#FFCDD2';
    }

    return `
      <div id="bulk-zip-item-${item.id}" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; background: ${badgeColor}; border: 1px solid ${borderColor}; border-radius: 6px; font-size: 0.78rem;">
        <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65%;">
          ${icon}
          <strong style="color: var(--admin-text-dark); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(item.originalName)}</strong>
          <span style="color: var(--admin-text-muted); font-size: 0.72rem;">(${item.formattedSize})</span>
        </div>
        <div style="font-size: 0.75rem; text-align: right; max-width: 35%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <span>${escapeHtml(statusText)}</span>
        </div>
      </div>
    `;
  }).join('');

  listContainer.innerHTML = html;
}

function updateBulkZipLiveItemRow(item) {
  const el = document.getElementById(`bulk-zip-item-${item.id}`);
  if (!el) {
    renderBulkZipLiveList();
    return;
  }

  let icon = '<i class="fa-regular fa-clock" style="color: #8C7F79;"></i>';
  let badgeColor = '#FAF9F6';
  let borderColor = 'var(--admin-border)';
  let statusText = item.details || 'Pending';

  if (item.status === 'uploading') {
    icon = '<i class="fa-solid fa-spinner fa-spin" style="color: #2E7D32;"></i>';
    badgeColor = '#E8F5E9';
    borderColor = '#C8E6C9';
  } else if (item.status === 'linked') {
    icon = '<i class="fa-solid fa-circle-check" style="color: #2E7D32;"></i>';
    badgeColor = '#E8F5E9';
    borderColor = '#C8E6C9';
  } else if (item.status === 'ambiguous') {
    icon = '<i class="fa-solid fa-code-compare" style="color: #BF360C;"></i>';
    badgeColor = '#FFF3E0';
    borderColor = '#FFCCBC';
  } else if (item.status === 'unmatched') {
    icon = '<i class="fa-solid fa-circle-question" style="color: #E65100;"></i>';
    badgeColor = '#FFF8E1';
    borderColor = '#FFE082';
  } else if (item.status === 'failed') {
    icon = '<i class="fa-solid fa-circle-xmark" style="color: #C62828;"></i>';
    badgeColor = '#FFEBEE';
    borderColor = '#FFCDD2';
  }

  el.style.background = badgeColor;
  el.style.border = `1px solid ${borderColor}`;
  el.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65%;">
      ${icon}
      <strong style="color: var(--admin-text-dark); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(item.originalName)}</strong>
      <span style="color: var(--admin-text-muted); font-size: 0.72rem;">(${item.formattedSize})</span>
    </div>
    <div style="font-size: 0.75rem; text-align: right; max-width: 35%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
      <span>${escapeHtml(statusText)}</span>
    </div>
  `;
}

function abortBulkZipUpload() {
  bulkZipUploadState.isCancelled = true;
  bulkZipUploadState.isUploading = false;

  bulkZipUploadState.activeControllers.forEach(ctrl => {
    try { ctrl.abort(); } catch (_) {}
  });
  bulkZipUploadState.activeControllers.clear();

  const statusBadge = document.getElementById('bulkZipStatusBadge');
  if (statusBadge) {
    statusBadge.innerHTML = '<i class="fa-solid fa-circle-stop"></i> Upload Cancelled';
    statusBadge.style.color = '#C62828';
  }

  bulkZipUploadState.items.forEach(it => {
    if (it.status === 'uploading' || it.status === 'pending') {
      it.status = 'failed';
      it.details = 'Cancelled by user';
      bulkZipUploadState.stats.failed++;
      bulkZipUploadState.stats.processed++;
      updateBulkZipLiveItemRow(it);
    }
  });

  updateBulkZipProgressCounters();
  onBulkZipUploadFinished();
}

function onBulkZipUploadFinished() {
  bulkZipUploadState.isUploading = false;

  const statusBadge = document.getElementById('bulkZipStatusBadge');
  if (statusBadge) {
    if (bulkZipUploadState.isCancelled) {
      statusBadge.innerHTML = '<i class="fa-solid fa-ban"></i> Cancelled';
      statusBadge.style.color = '#C62828';
    } else {
      statusBadge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Complete';
      statusBadge.style.color = '#2E7D32';
    }
  }

  const abortBtn = document.getElementById('bulkZipAbortBtn');
  if (abortBtn) abortBtn.style.display = 'none';

  const finishRefreshBtn = document.getElementById('bulkZipFinishRefreshBtn');
  if (finishRefreshBtn) finishRefreshBtn.style.display = 'inline-flex';

  renderBulkZipCompletionReport();
}

function renderBulkZipCompletionReport() {
  const reportCard = document.getElementById('bulkZipReportCard');
  if (!reportCard) return;

  reportCard.style.display = 'block';

  const { linked, unmatched, ambiguous, failed } = bulkZipUploadState.stats;
  const summaryText = document.getElementById('bulkZipReportSummaryText');
  if (summaryText) {
    summaryText.innerHTML = `Process completed: <strong>${linked}</strong> linked, <strong>${unmatched}</strong> unmatched, <strong>${ambiguous}</strong> ambiguous, <strong>${failed}</strong> failed.`;
  }

  // 1. Ambiguous list
  const ambiguousBox = document.getElementById('bulkZipAmbiguousDetailsBox');
  const ambiguousList = document.getElementById('bulkZipAmbiguousList');
  const ambiguousItems = bulkZipUploadState.items.filter(it => it.status === 'ambiguous');

  if (ambiguousBox && ambiguousList) {
    if (ambiguousItems.length > 0) {
      ambiguousBox.style.display = 'block';
      ambiguousList.innerHTML = ambiguousItems.map(item => `
        <div style="background: #FFFFFF; border: 1px solid #FFE0B2; border-radius: 6px; padding: 8px 10px;">
          <div style="font-weight: 700; color: #BF360C; margin-bottom: 4px;">
            <i class="fa-solid fa-file-zipper"></i> ${escapeHtml(item.originalName)}
          </div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center;">
            <span style="color: var(--admin-text-muted);">Pick matching product:</span>
            ${(item.candidates || []).map(c => `
              <button type="button" onclick="linkSingleBulkZip(${item.id}, ${c.id}, '${item.tempToken}', '${escapeHtml(item.originalName)}', '${item.checksum || ''}')" style="background: #E8F5E9; border: 1px solid #81C784; color: #1B5E20; padding: 2px 8px; border-radius: 4px; font-size: 0.74rem; cursor: pointer; font-weight: 600;">
                #${c.id} ${escapeHtml(c.sku || c.title)}
              </button>
            `).join('')}
          </div>
        </div>
      `).join('');
    } else {
      ambiguousBox.style.display = 'none';
    }
  }

  // 2. Unmatched list with top 3 suggestions & manual dropdown
  const unmatchedBox = document.getElementById('bulkZipUnmatchedDetailsBox');
  const unmatchedList = document.getElementById('bulkZipUnmatchedNamesList');
  const unmatchedItems = bulkZipUploadState.items.filter(it => it.status === 'unmatched');

  if (unmatchedBox && unmatchedList) {
    if (unmatchedItems.length > 0) {
      unmatchedBox.style.display = 'block';

      // Build options from cached designs
      const optionsHtml = (bulkZipUploadState.catalogDesigns || []).slice(0, 500).map(d =>
        `<option value="${d.id}">#${d.id} - ${escapeHtml(d.sku || '')} (${escapeHtml(d.title || '')})</option>`
      ).join('');

      unmatchedList.innerHTML = unmatchedItems.map(item => `
        <div style="background: #FFFFFF; border: 1px solid #FFE082; border-radius: 6px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong style="color: #E65100;">${escapeHtml(item.originalName)}</strong>
            <span style="font-size: 0.7rem; color: var(--admin-text-muted);">${item.formattedSize}</span>
          </div>

          <!-- Suggestions -->
          ${(item.suggestions && item.suggestions.length > 0) ? `
            <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
              <span style="font-size: 0.72rem; color: var(--admin-text-muted); font-weight: 600;">Top Suggestions:</span>
              ${item.suggestions.map(s => `
                <button type="button" onclick="linkSingleBulkZip(${item.id}, ${s.id}, '${item.tempToken}', '${escapeHtml(item.originalName)}', '${item.checksum || ''}')" style="background: #E8F5E9; border: 1px solid #A5D6A7; color: #2E7D32; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; cursor: pointer; font-weight: 600;" title="Link to this design">
                  ${escapeHtml(s.sku || s.title)} (${Math.round(s.similarity * 100)}%)
                </button>
              `).join('')}
            </div>
          ` : ''}

          <!-- Manual searchable dropdown selector -->
          <div style="display: flex; gap: 6px; align-items: center; margin-top: 2px;">
            <select id="manualLinkSelect-${item.id}" style="flex: 1; height: 30px; font-size: 0.76rem; border: 1px solid var(--admin-border); border-radius: 6px; padding: 0 6px;">
              <option value="">-- Choose design to link --</option>
              ${optionsHtml}
            </select>
            <button type="button" onclick="linkFromDropdown(${item.id}, '${item.tempToken}', '${escapeHtml(item.originalName)}', '${item.checksum || ''}')" style="background: var(--admin-primary); color: #FFF; border: none; padding: 5px 12px; border-radius: 6px; font-size: 0.74rem; font-weight: 600; cursor: pointer; white-space: nowrap;">
              <i class="fa-solid fa-link"></i> Link
            </button>
          </div>
        </div>
      `).join('');
    } else {
      unmatchedBox.style.display = 'none';
    }
  }

  // 3. Failed details box
  const failedBox = document.getElementById('bulkZipFailedDetailsBox');
  const failedList = document.getElementById('bulkZipFailedReasonsList');
  const failedItems = bulkZipUploadState.items.filter(it => it.status === 'failed');

  if (failedBox && failedList) {
    if (failedItems.length > 0) {
      failedBox.style.display = 'block';
      failedList.innerHTML = failedItems.map(it => `
        <div style="padding: 2px 0;">• ${escapeHtml(it.originalName)}: ${escapeHtml(it.details || it.error || 'Unknown failure')}</div>
      `).join('');
    } else {
      failedBox.style.display = 'none';
    }
  }

  // Retry failed button visibility
  const retryBtn = document.getElementById('bulkZipRetryFailedBtn');
  const retryCount = document.getElementById('bulkZipRetryBtnCount');
  if (retryBtn) {
    if (failedItems.length > 0) {
      retryBtn.style.display = 'inline-flex';
      if (retryCount) retryCount.textContent = failedItems.length;
    } else {
      retryBtn.style.display = 'none';
    }
  }
}

// Link unmatched item from dropdown
function linkFromDropdown(itemId, tempToken, originalName, checksum) {
  const select = document.getElementById(`manualLinkSelect-${itemId}`);
  if (!select || !select.value) {
    alert('Please select a design from the list.');
    return;
  }
  linkSingleBulkZip(itemId, parseInt(select.value, 10), tempToken, originalName, checksum);
}

// Link single unmatched or ambiguous ZIP manually
async function linkSingleBulkZip(itemId, designId, tempToken, originalName, checksum) {
  const item = bulkZipUploadState.items.find(it => it.id === itemId);

  try {
    const res = await fetch('/admin/designs/bulk-link-single-zip', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-CSRF-Token': getCsrfToken()
      },
      body: JSON.stringify({
        designId,
        tempToken,
        originalName,
        checksum,
        detectedFormats: item ? item.formats : [],
        _csrf: getCsrfToken()
      })
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to link file.');
    }

    if (item) {
      const prevStatus = item.status;
      item.status = 'linked';
      item.matchedDesignId = designId;
      item.details = `Manually linked to #${designId} (${data.sku || data.title})`;

      if (prevStatus === 'unmatched') bulkZipUploadState.stats.unmatched = Math.max(0, bulkZipUploadState.stats.unmatched - 1);
      if (prevStatus === 'ambiguous') bulkZipUploadState.stats.ambiguous = Math.max(0, bulkZipUploadState.stats.ambiguous - 1);
      bulkZipUploadState.stats.linked++;

      updateBulkZipLiveItemRow(item);
      updateBulkZipProgressCounters();
      renderBulkZipCompletionReport();
    }

    alert(data.message || 'Successfully linked!');
  } catch (err) {
    alert(`Link Error: ${err.message}`);
  }
}

// Retry failed ZIP uploads
function retryFailedBulkZips() {
  const failedItems = bulkZipUploadState.items.filter(it => it.status === 'failed');
  if (failedItems.length === 0) return;

  failedItems.forEach(it => {
    it.status = 'pending';
    it.details = 'Pending retry...';
    bulkZipUploadState.stats.failed--;
    bulkZipUploadState.stats.processed--;
  });

  updateBulkZipProgressCounters();

  const reportCard = document.getElementById('bulkZipReportCard');
  if (reportCard) reportCard.style.display = 'none';

  startChunkedBulkZipUpload();
}

// Download report CSV
function downloadBulkZipUploadReportCsv() {
  const rows = [
    ['Filename', 'Status', 'Matched Design ID', 'SKU', 'Title', 'File Size', 'Formats', 'Checksum', 'Details / Error']
  ];

  bulkZipUploadState.items.forEach(it => {
    rows.push([
      `"${(it.originalName || '').replace(/"/g, '""')}"`,
      `"${it.status}"`,
      `"${it.matchedDesignId || ''}"`,
      `"${(it.matchedSku || '').replace(/"/g, '""')}"`,
      `"${(it.matchedTitle || '').replace(/"/g, '""')}"`,
      `"${it.formattedSize || ''}"`,
      `"${(it.formats || []).join(', ')}"`,
      `"${it.checksum || ''}"`,
      `"${(it.details || it.error || '').replace(/"/g, '""')}"`
    ]);
  });

  const csvContent = 'data:text/csv;charset=utf-8,' + rows.map(r => r.join(',')).join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `bulk_zip_upload_report_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function finishBulkZipUploadAndRefresh() {
  closeBulkZipUploadModal();
  window.location.reload();
}

/**
 * Single Replace ZIP Modal functions (For Manage Designs Table & Form Page)
 */
function openReplaceZipModal(designId, designTitle) {
  const modal = document.getElementById('replaceZipModal');
  const idInput = document.getElementById('replaceZipDesignId');
  const titleP = document.getElementById('replaceZipTitle');
  const fileInput = document.getElementById('replaceZipFileInput');
  if (!modal) return;
  if (idInput) idInput.value = designId || '';
  if (titleP) titleP.textContent = designTitle ? `Replace machine file for: "${designTitle}"` : `Replace machine file for Design #${designId}`;
  if (fileInput) fileInput.value = '';
  modal.style.display = 'flex';
}

function closeReplaceZipModal() {
  const modal = document.getElementById('replaceZipModal');
  if (modal) modal.style.display = 'none';
}

async function submitReplaceZip(e) {
  e.preventDefault();
  const idInput = document.getElementById('replaceZipDesignId');
  const fileInput = document.getElementById('replaceZipFileInput');
  const submitBtn = document.getElementById('replaceZipSubmitBtn');
  if (!idInput || !fileInput || !fileInput.files || fileInput.files.length === 0) return;

  const file = fileInput.files[0];
  const designId = idInput.value;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('designId', designId);
  formData.append('_csrf', getCsrfToken());

  const origBtnHtml = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading...';
  }

  try {
    const res = await fetch(`/admin/designs/replace-zip/${designId}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'X-CSRF-Token': getCsrfToken()
      },
      body: formData
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to replace machine file.');
    }
    closeReplaceZipModal();
    if (typeof showToast === 'function') showToast(data.message || 'Machine file replaced successfully!');
    else if (typeof showAdminToast === 'function') showAdminToast(data.message || 'Machine file replaced successfully!');
    else alert(data.message || 'Machine file replaced successfully!');
    setTimeout(() => { window.location.reload(); }, 800);
  } catch (err) {
    alert(`Replace ZIP Error: ${err.message}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = origBtnHtml;
    }
  }
}

// Drag & drop event listeners for bulk ZIP modal
document.addEventListener('DOMContentLoaded', () => {
  const dropArea = document.getElementById('bulkZipDropArea');
  const fileInput = document.getElementById('bulkZipFilesInput');

  if (dropArea && fileInput) {
    ['dragenter', 'dragover'].forEach(evt => {
      dropArea.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropArea.style.borderColor = '#2E7D32';
        dropArea.style.background = '#E8F5E9';
      });
    });

    ['dragleave', 'drop'].forEach(evt => {
      dropArea.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropArea.style.borderColor = '#81C784';
        dropArea.style.background = '#F1F8E9';
      });
    });

    dropArea.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        fileInput.files = e.dataTransfer.files;
        handleBulkZipFilesSelected(fileInput);
      }
    });

    dropArea.addEventListener('click', (e) => {
      if (e.target !== fileInput) {
        fileInput.click();
      }
    });
  }
});

// =============================================================================
// INLINE PRICE EDITING IN DESIGNS TABLE
// =============================================================================

function startInlinePriceEdit(id) {
  const cell = document.getElementById(`priceCell-${id}`);
  if (!cell) return;

  const displayWrapper = cell.querySelector('.price-display-wrapper');
  const editWrapper = document.getElementById(`priceEditBox-${id}`);
  const input = document.getElementById(`priceInput-${id}`);

  if (displayWrapper) displayWrapper.style.display = 'none';
  if (editWrapper) editWrapper.style.display = 'inline-flex';
  if (input) {
    input.focus();
    input.select();
  }
}

function cancelInlinePriceEdit(id) {
  const cell = document.getElementById(`priceCell-${id}`);
  if (!cell) return;

  const currentPrice = cell.dataset.price || '0';
  const displayWrapper = cell.querySelector('.price-display-wrapper');
  const editWrapper = document.getElementById(`priceEditBox-${id}`);
  const input = document.getElementById(`priceInput-${id}`);

  if (input) input.value = currentPrice;
  if (editWrapper) editWrapper.style.display = 'none';
  if (displayWrapper) displayWrapper.style.display = 'inline-flex';
}

function handleInlinePriceKey(event, id) {
  if (event.key === 'Enter') {
    event.preventDefault();
    saveInlinePrice(id);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    cancelInlinePriceEdit(id);
  }
}

function saveInlinePrice(id) {
  const cell = document.getElementById(`priceCell-${id}`);
  const input = document.getElementById(`priceInput-${id}`);
  if (!cell || !input) return;

  const val = parseFloat(input.value);
  if (isNaN(val) || val <= 0) {
    alert('Please enter a valid price greater than 0.');
    input.focus();
    return;
  }

  const currentPrice = parseFloat(cell.dataset.price || '0');
  if (val === currentPrice) {
    cancelInlinePriceEdit(id);
    return;
  }

  const csrf = getCsrfToken();
  input.disabled = true;

  fetch(`/admin/api/designs/${id}/inline-price`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-CSRF-Token': csrf
    },
    body: JSON.stringify({ sale_price: val, _csrf: csrf })
  })
  .then(res => res.json())
  .then(data => {
    input.disabled = false;
    if (data.success) {
      // Update cell DOM
      cell.dataset.price = data.new_price;
      cell.dataset.mrp = data.new_mrp;

      const priceValEl = document.getElementById(`priceVal-${id}`);
      if (priceValEl) priceValEl.textContent = data.new_price;

      const mrpLineEl = document.getElementById(`mrpLine-${id}`);
      const discountBadgeEl = document.getElementById(`discountBadge-${id}`);

      if (data.new_mrp > data.new_price) {
        if (mrpLineEl) {
          mrpLineEl.textContent = `₹${data.new_mrp}`;
          mrpLineEl.style.display = 'inline';
        }
        if (discountBadgeEl) {
          discountBadgeEl.textContent = `${data.discount_percent}% OFF`;
          discountBadgeEl.style.color = '#C62828';
          discountBadgeEl.style.fontWeight = '600';
        }
      } else {
        if (mrpLineEl) mrpLineEl.style.display = 'none';
        if (discountBadgeEl) {
          discountBadgeEl.textContent = 'Regular';
          discountBadgeEl.style.color = 'var(--admin-text-muted)';
          discountBadgeEl.style.fontWeight = '500';
        }
      }

      cancelInlinePriceEdit(id);
      showAdminToast(data.message || `Price updated to ₹${data.new_price}`);
    } else {
      alert(data.message || 'Unable to update price.');
      input.focus();
    }
  })
  .catch(err => {
    input.disabled = false;
    alert('Network error while saving price.');
  });
}

// =============================================================================
// BULK UPDATE PRICE MULTI-STEP ENGINE
// =============================================================================

let bulkPriceCurrentStep = 1;
let bulkPriceLiveDebounceTimer = null;
let bulkPricePreviewData = null;
let bulkPricePreviewItems = [];
let bulkPriceExcludedIds = new Set();
let bulkPriceFilterSummary = '';
let bulkPriceMethodSummary = '';

function openBulkPriceModal() {
  const modal = document.getElementById('bulkPriceModal');
  if (!modal) return;

  bulkPriceCurrentStep = 1;
  bulkPriceExcludedIds.clear();
  setBulkPriceStep(1);

  // Update selected count
  const checkedRows = document.querySelectorAll('.design-checkbox:checked');
  const countEl = document.getElementById('modalSelectedCount');
  if (countEl) countEl.textContent = checkedRows.length;

  fetchLiveTargetCount();
  modal.style.display = 'flex';
}

function openBulkPriceModalForSelected() {
  openBulkPriceModal();
  const selectedRadio = document.querySelector('input[name="priceScope"][value="selected"]');
  if (selectedRadio) {
    selectedRadio.checked = true;
    handlePriceScopeChange();
  }
}

function closeBulkPriceModal() {
  const modal = document.getElementById('bulkPriceModal');
  if (modal) modal.style.display = 'none';
}

function setBulkPriceStep(step) {
  bulkPriceCurrentStep = step;

  // Tabs
  const tab1 = document.getElementById('stepPriceTab1');
  const tab2 = document.getElementById('stepPriceTab2');
  const tab3 = document.getElementById('stepPriceTab3');

  const step1 = document.getElementById('bulkPriceStep1');
  const step2 = document.getElementById('bulkPriceStep2');
  const step3 = document.getElementById('bulkPriceStep3');
  const step4 = document.getElementById('bulkPriceStep4');

  const backBtn = document.getElementById('bulkPriceBackBtn');
  const nextBtn = document.getElementById('bulkPriceNextBtn');
  const applyBtn = document.getElementById('bulkPriceApplyBtn');
  const footer = document.getElementById('bulkPriceFooter');

  [tab1, tab2, tab3].forEach(t => {
    if (t) {
      t.style.background = '#ECEFF1';
      t.style.color = '#546E7A';
    }
  });

  if (step === 1) {
    if (tab1) { tab1.style.background = '#D97706'; tab1.style.color = '#FFF'; }
    if (step1) step1.style.display = 'block';
    if (step2) step2.style.display = 'none';
    if (step3) step3.style.display = 'none';
    if (step4) step4.style.display = 'none';

    if (backBtn) backBtn.style.display = 'none';
    if (nextBtn) {
      nextBtn.style.display = 'inline-flex';
      nextBtn.innerHTML = 'Next: Choose Update Rule <i class="fa-solid fa-arrow-right"></i>';
    }
    if (applyBtn) applyBtn.style.display = 'none';
    if (footer) footer.style.display = 'flex';
  } else if (step === 2) {
    if (tab2) { tab2.style.background = '#D97706'; tab2.style.color = '#FFF'; }
    if (step1) step1.style.display = 'none';
    if (step2) step2.style.display = 'block';
    if (step3) step3.style.display = 'none';
    if (step4) step4.style.display = 'none';

    if (backBtn) backBtn.style.display = 'inline-flex';
    if (nextBtn) {
      nextBtn.style.display = 'inline-flex';
      nextBtn.innerHTML = 'Next: Preview Changes <i class="fa-solid fa-arrow-right"></i>';
    }
    if (applyBtn) applyBtn.style.display = 'none';
    if (footer) footer.style.display = 'flex';
  } else if (step === 3) {
    if (tab3) { tab3.style.background = '#D97706'; tab3.style.color = '#FFF'; }
    if (step1) step1.style.display = 'none';
    if (step2) step2.style.display = 'none';
    if (step3) step3.style.display = 'block';
    if (step4) step4.style.display = 'none';

    if (backBtn) backBtn.style.display = 'inline-flex';
    if (nextBtn) nextBtn.style.display = 'none';
    if (applyBtn) applyBtn.style.display = 'inline-flex';
    if (footer) footer.style.display = 'flex';
  } else if (step === 4) {
    if (step1) step1.style.display = 'none';
    if (step2) step2.style.display = 'none';
    if (step3) step3.style.display = 'none';
    if (step4) step4.style.display = 'block';
    if (footer) footer.style.display = 'none';
  }
}

function nextBulkPriceStep() {
  if (bulkPriceCurrentStep === 1) {
    setBulkPriceStep(2);
  } else if (bulkPriceCurrentStep === 2) {
    generatePricePreview();
  }
}

function prevBulkPriceStep() {
  if (bulkPriceCurrentStep === 3) {
    setBulkPriceStep(2);
  } else if (bulkPriceCurrentStep === 2) {
    setBulkPriceStep(1);
  }
}

function handlePriceScopeChange() {
  const scope = document.querySelector('input[name="priceScope"]:checked')?.value || 'all';
  const customBox = document.getElementById('priceCustomFiltersBox');
  if (customBox) {
    customBox.style.display = scope === 'custom' ? 'block' : 'none';
  }
  fetchLiveTargetCount();
}

function toggleAllCategoryCheckboxes(checked) {
  const cbs = document.querySelectorAll('.price-cat-check');
  cbs.forEach(cb => cb.checked = checked);
  debouncedFetchLiveCount();
}

function debouncedFetchLiveCount() {
  if (bulkPriceLiveDebounceTimer) clearTimeout(bulkPriceLiveDebounceTimer);
  bulkPriceLiveDebounceTimer = setTimeout(fetchLiveTargetCount, 250);
}

function getSelectedTableDesignIds() {
  const checked = document.querySelectorAll('.design-checkbox:checked');
  return Array.from(checked).map(cb => parseInt(cb.value, 10)).filter(id => !isNaN(id));
}

function collectStep1Filters() {
  const scope = document.querySelector('input[name="priceScope"]:checked')?.value || 'all';
  const selectedIds = getSelectedTableDesignIds();

  const categoryIds = Array.from(document.querySelectorAll('.price-cat-check:checked'))
    .map(cb => parseInt(cb.value, 10))
    .filter(id => !isNaN(id));

  const status = document.getElementById('priceFilterStatus')?.value || 'all';

  const formats = Array.from(document.querySelectorAll('.price-fmt-check:checked'))
    .map(cb => cb.value.trim());

  const minPrice = document.getElementById('priceFilterMin')?.value || '';
  const maxPrice = document.getElementById('priceFilterMax')?.value || '';
  const skuRange = document.getElementById('priceFilterSkuText')?.value || '';

  return {
    scope,
    selectedIds,
    categoryIds,
    status,
    formats,
    minPrice,
    maxPrice,
    skuRange
  };
}

function fetchLiveTargetCount() {
  const filters = collectStep1Filters();
  const label = document.getElementById('bulkPriceLiveCountLabel');
  const numEl = document.getElementById('bulkPriceLiveCountNum');

  if (filters.scope === 'selected' && filters.selectedIds.length === 0) {
    if (label) label.innerHTML = '<span style="color: #C62828;">No rows selected in table yet. Tick rows or choose "All Designs".</span>';
    return;
  }

  fetch('/admin/api/bulk-price/count', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': getCsrfToken()
    },
    body: JSON.stringify({ filters, selectedIds: filters.selectedIds, _csrf: getCsrfToken() })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      if (label) label.innerHTML = `This will update <strong>${data.count}</strong> designs.`;
    }
  })
  .catch(() => {
    if (label) label.innerHTML = 'This will update <strong>...</strong> designs.';
  });
}

function handleTargetFieldChange() {
  const targetField = document.querySelector('input[name="priceTargetField"]:checked')?.value || 'sale_price';
  const discountLabel = document.getElementById('methodDiscountLabel');
  if (discountLabel) {
    // Discount off MRP only applies to selling price
    if (targetField === 'price') {
      discountLabel.style.opacity = '0.5';
      discountLabel.style.pointerEvents = 'none';
      const discRadio = document.querySelector('input[name="priceMethod"][value="discount_off_mrp"]');
      if (discRadio && discRadio.checked) {
        document.querySelector('input[name="priceMethod"][value="percentage"]').checked = true;
        handlePriceMethodChange();
      }
    } else {
      discountLabel.style.opacity = '1';
      discountLabel.style.pointerEvents = 'auto';
    }
  }
}

function handlePriceMethodChange() {
  const method = document.querySelector('input[name="priceMethod"]:checked')?.value || 'fixed';

  const fixedBox = document.getElementById('methodInputBoxFixed');
  const pctBox = document.getElementById('methodInputBoxPercentage');
  const amtBox = document.getElementById('methodInputBoxAmount');
  const discBox = document.getElementById('methodInputBoxDiscount');
  const fileBox = document.getElementById('methodInputBoxFile');

  if (fixedBox) fixedBox.style.display = method === 'fixed' ? 'flex' : 'none';
  if (pctBox) pctBox.style.display = method === 'percentage' ? 'flex' : 'none';
  if (amtBox) amtBox.style.display = method === 'amount' ? 'flex' : 'none';
  if (discBox) discBox.style.display = method === 'discount_off_mrp' ? 'flex' : 'none';
  if (fileBox) fileBox.style.display = method === 'file' ? 'flex' : 'none';
}

function togglePriceGuardInputs() {
  const enabled = document.getElementById('enablePriceGuardOption')?.checked;
  const row = document.getElementById('priceGuardInputsRow');
  if (row) row.style.display = enabled ? 'flex' : 'none';
}

function generatePricePreview() {
  const nextBtn = document.getElementById('bulkPriceNextBtn');
  if (nextBtn) {
    nextBtn.disabled = true;
    nextBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Calculating Preview...';
  }

  const filters = collectStep1Filters();
  const targetField = document.querySelector('input[name="priceTargetField"]:checked')?.value || 'sale_price';
  const method = document.querySelector('input[name="priceMethod"]:checked')?.value || 'fixed';
  const rounding = document.getElementById('priceRoundingOption')?.value || 'none';
  const autoCapMrp = document.getElementById('autoCapMrpOption')?.checked;

  let value = 0;
  if (method === 'fixed') {
    value = parseFloat(document.getElementById('fixedValInput')?.value || 0);
  } else if (method === 'percentage') {
    value = parseFloat(document.getElementById('percentageValInput')?.value || 0);
  } else if (method === 'amount') {
    value = parseFloat(document.getElementById('amountValInput')?.value || 0);
  } else if (method === 'discount_off_mrp') {
    value = parseFloat(document.getElementById('discountValInput')?.value || 0);
  }

  const enableGuard = document.getElementById('enablePriceGuardOption')?.checked;
  const minGuard = enableGuard ? document.getElementById('guardMinVal')?.value : null;
  const maxGuard = enableGuard ? document.getElementById('guardMaxVal')?.value : null;

  // Summaries
  let fSum = filters.scope === 'all' ? 'All designs' : (filters.scope === 'selected' ? `${filters.selectedIds.length} selected row(s)` : 'Filtered designs');
  let mSum = '';
  if (method === 'fixed') mSum = `Fixed ₹${value} on ${targetField}`;
  else if (method === 'percentage') mSum = `${value >= 0 ? '+' : ''}${value}% on ${targetField}`;
  else if (method === 'amount') mSum = `${value >= 0 ? '+₹' : '-₹'}${Math.abs(value)} on ${targetField}`;
  else if (method === 'discount_off_mrp') mSum = `${value}% off MRP`;
  else if (method === 'file') mSum = 'Spreadsheet per-SKU pricing';

  bulkPriceFilterSummary = fSum;
  bulkPriceMethodSummary = mSum;

  const csrf = getCsrfToken();

  let fetchPromise;
  if (method === 'file') {
    const fileInput = document.getElementById('priceSpreadsheetFile');
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
      alert('Please choose a CSV or XLSX file to upload.');
      if (nextBtn) { nextBtn.disabled = false; nextBtn.innerHTML = 'Next: Preview Changes <i class="fa-solid fa-arrow-right"></i>'; }
      return;
    }
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('method', 'file');
    formData.append('targetField', targetField);
    formData.append('rounding', rounding);
    formData.append('autoCapMrp', autoCapMrp);
    formData.append('_csrf', csrf);

    fetchPromise = fetch('/admin/api/bulk-price/preview', {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrf },
      body: formData
    });
  } else {
    fetchPromise = fetch('/admin/api/bulk-price/preview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf
      },
      body: JSON.stringify({
        ...filters,
        targetField,
        method,
        value,
        rounding,
        autoCapMrp,
        minGuard,
        maxGuard,
        _csrf: csrf
      })
    });
  }

  fetchPromise
    .then(res => res.json())
    .then(data => {
      if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.innerHTML = 'Next: Preview Changes <i class="fa-solid fa-arrow-right"></i>';
      }

      if (!data.success) {
        alert(data.message || 'Unable to generate preview.');
        return;
      }

      bulkPricePreviewData = data;
      bulkPricePreviewItems = data.items || [];
      bulkPriceExcludedIds.clear();

      renderPreviewUI(data);
      setBulkPriceStep(3);
    })
    .catch(err => {
      if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.innerHTML = 'Next: Preview Changes <i class="fa-solid fa-arrow-right"></i>';
      }
      alert('Error calculating price preview.');
    });
}

function renderPreviewUI(data) {
  const sum = data.summary || {};
  document.getElementById('previewTotalCount').textContent = sum.totalDesigns || 0;
  document.getElementById('previewOldAvgPrice').textContent = `₹${sum.avgOldPrice || 0}`;
  document.getElementById('previewNewAvgPrice').textContent = `₹${sum.avgNewPrice || 0}`;

  const pctBadge = document.getElementById('previewPctChangeBadge');
  if (pctBadge) {
    const pct = sum.priceChangePct || 0;
    pctBadge.textContent = `${pct >= 0 ? '+' : ''}${pct}%`;
    pctBadge.style.background = pct >= 0 ? '#E8F5E9' : '#FFEBEE';
    pctBadge.style.color = pct >= 0 ? '#2E7D32' : '#C62828';
  }

  document.getElementById('previewValidCount').textContent = sum.validCount || 0;

  const errCard = document.getElementById('previewErrorCard');
  const errBtn = document.getElementById('excludeErrorsBtn');
  if (sum.errorCount > 0) {
    if (errCard) { errCard.style.display = 'block'; document.getElementById('previewErrorCount').textContent = sum.errorCount; }
    if (errBtn) errBtn.style.display = 'inline-flex';
  } else {
    if (errCard) errCard.style.display = 'none';
    if (errBtn) errBtn.style.display = 'none';
  }

  renderPreviewRows(bulkPricePreviewItems);
  updatePreviewIncludedCount();
}

function renderPreviewRows(items) {
  const tbody = document.getElementById('previewTableBody');
  if (!tbody) return;

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="padding: 2rem; text-align: center; color: var(--admin-text-muted);">No design records found.</td></tr>';
    return;
  }

  let html = '';
  items.forEach(it => {
    const isExcluded = bulkPriceExcludedIds.has(it.design_id);
    const checked = !isExcluded && it.status !== 'error';

    let badgeClass = 'background: #E8F5E9; color: #2E7D32;';
    let badgeText = 'Valid';
    if (it.status === 'warning') {
      badgeClass = 'background: #FEF3C7; color: #B45309;';
      badgeText = 'Capped to MRP';
    } else if (it.status === 'error') {
      badgeClass = 'background: #FFEBEE; color: #C62828;';
      badgeText = it.error_message || 'Invalid';
    } else if (it.status === 'unchanged') {
      badgeClass = 'background: #F1F5F9; color: #64748B;';
      badgeText = 'Unchanged';
    }

    const priceDiff = it.price_change_diff || 0;
    const isPos = priceDiff > 0;
    const diffColor = isPos ? '#2E7D32' : (priceDiff < 0 ? '#C62828' : '#64748B');
    const diffSign = isPos ? '+' : '';

    const rowBg = it.status === 'error' ? 'background: #FFF5F5;' : (it.is_changed ? 'background: #FEFCE8;' : '');

    html += `
      <tr style="border-bottom: 1px solid var(--admin-border); ${rowBg}">
        <td style="padding: 8px 10px; text-align: center;">
          <input type="checkbox" class="preview-item-check" data-id="${it.design_id}" ${checked ? 'checked' : ''} onchange="togglePreviewRow(this, ${it.design_id})">
        </td>
        <td style="padding: 8px 10px; font-weight: 600; color: var(--admin-text-muted); font-size: 0.78rem;">${it.sku}</td>
        <td style="padding: 8px 10px; font-weight: 600; color: var(--admin-text-dark);">${it.title}</td>
        <td style="padding: 8px 10px; color: var(--admin-text-muted); font-size: 0.76rem;">${it.category_name}</td>
        <td style="padding: 8px 10px; text-align: right; color: var(--admin-text-muted);">₹${it.old_mrp !== null ? it.old_mrp : '-'}</td>
        <td style="padding: 8px 10px; text-align: right; color: var(--admin-text-muted);">₹${it.old_price !== null ? it.old_price : '-'}</td>
        <td style="padding: 8px 10px; text-align: right; font-weight: 600; color: var(--admin-text-dark);">₹${it.new_mrp !== null ? it.new_mrp : '-'}</td>
        <td style="padding: 8px 10px; text-align: right; font-weight: 700; color: var(--admin-primary);">₹${it.new_price !== null ? it.new_price : '-'}</td>
        <td style="padding: 8px 10px; text-align: right; font-weight: 700; color: ${diffColor};">
          ${diffSign}₹${priceDiff} (${it.price_change_pct}%)
        </td>
        <td style="padding: 8px 10px; text-align: center;">
          <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 700; ${badgeClass}">
            ${badgeText}
          </span>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

function togglePreviewRow(checkbox, designId) {
  if (checkbox.checked) {
    bulkPriceExcludedIds.delete(designId);
  } else {
    bulkPriceExcludedIds.add(designId);
  }
  updatePreviewIncludedCount();
}

function toggleSelectAllPreviewRows(masterCheckbox) {
  const cbs = document.querySelectorAll('.preview-item-check');
  cbs.forEach(cb => {
    cb.checked = masterCheckbox.checked;
    const dId = parseInt(cb.dataset.id, 10);
    if (masterCheckbox.checked) {
      bulkPriceExcludedIds.delete(dId);
    } else {
      bulkPriceExcludedIds.add(dId);
    }
  });
  updatePreviewIncludedCount();
}

function excludeAllErrors() {
  if (!bulkPricePreviewItems) return;
  bulkPricePreviewItems.forEach(it => {
    if (it.status === 'error') {
      bulkPriceExcludedIds.add(it.design_id);
    }
  });
  renderPreviewRows(bulkPricePreviewItems);
  updatePreviewIncludedCount();
}

function handlePreviewFilter(query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) {
    renderPreviewRows(bulkPricePreviewItems);
    return;
  }
  const filtered = bulkPricePreviewItems.filter(it =>
    (it.sku && it.sku.toLowerCase().includes(q)) ||
    (it.title && it.title.toLowerCase().includes(q))
  );
  renderPreviewRows(filtered);
}

function updatePreviewIncludedCount() {
  const includedCount = bulkPricePreviewItems.filter(it =>
    it.design_id &&
    !bulkPriceExcludedIds.has(it.design_id) &&
    it.status !== 'error' &&
    it.is_changed
  ).length;

  const countEl = document.getElementById('previewSelectedCount');
  if (countEl) countEl.textContent = includedCount;

  const applyBtn = document.getElementById('bulkPriceApplyBtn');
  if (applyBtn) {
    applyBtn.disabled = includedCount === 0;
    applyBtn.style.opacity = includedCount === 0 ? '0.5' : '1';
  }
}

function executeApplyPriceUpdate() {
  if (!bulkPricePreviewItems || bulkPricePreviewItems.length === 0) return;

  const includedItems = bulkPricePreviewItems.filter(it =>
    it.design_id &&
    !bulkPriceExcludedIds.has(it.design_id) &&
    it.status !== 'error' &&
    it.is_changed
  );

  if (includedItems.length === 0) {
    alert('No changed designs to update. Please select at least one design.');
    return;
  }

  const applyBtn = document.getElementById('bulkPriceApplyBtn');
  if (applyBtn) {
    applyBtn.disabled = true;
    applyBtn.textContent = 'Applying...';
  }

  setBulkPriceStep(4);
  const progressBar = document.getElementById('bulkPriceProgressBar');
  if (progressBar) progressBar.style.width = '60%';

  const csrf = getCsrfToken();

  fetch('/admin/api/bulk-price/apply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf
    },
    body: JSON.stringify({
      items: includedItems,
      excludedIds: Array.from(bulkPriceExcludedIds),
      filterSummary: bulkPriceFilterSummary,
      methodSummary: bulkPriceMethodSummary,
      _csrf: csrf
    })
  })
  .then(res => res.json())
  .then(data => {
    if (progressBar) progressBar.style.width = '100%';

    setTimeout(() => {
      document.getElementById('bulkPriceProgressBox').style.display = 'none';
      const successBox = document.getElementById('bulkPriceSuccessBox');
      successBox.style.display = 'block';

      if (data.success) {
        document.getElementById('bulkPriceSuccessText').textContent =
          `Successfully updated ${data.totalAffected || includedItems.length} designs in transaction audit log #${data.logId}.`;
      } else {
        alert(data.message || 'Error occurred during price update.');
      }
    }, 400);
  })
  .catch(err => {
    alert('Network error while committing price update.');
    setBulkPriceStep(3);
  });
}




