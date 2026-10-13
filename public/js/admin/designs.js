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

function confirmDeleteAllDesigns() {
  const modal = document.getElementById('deleteAllDesignsModal');
  if (modal) modal.style.display = 'flex';
}

function closeDeleteAllModal() {
  const modal = document.getElementById('deleteAllDesignsModal');
  if (modal) modal.style.display = 'none';
}

function executeDeleteAllDesigns() {
  const btn = document.getElementById('confirmDeleteAllBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting All...'; }

  const csrf = getCsrfToken();

  fetch('/admin/designs/delete-all', {
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
    closeDeleteAllModal();
    if (btn) { btn.disabled = false; btn.textContent = 'Yes, Delete All Designs'; }
    if (data.success) {
      showAdminToast(data.message || 'All designs permanently removed.');
      setTimeout(() => window.location.reload(), 600);
    } else {
      alert(data.message || 'Unable to delete all designs. Please try again.');
    }
  })
  .catch(err => {
    console.error(err);
    closeDeleteAllModal();
    if (btn) { btn.disabled = false; btn.textContent = 'Yes, Delete All Designs'; }
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
  stats: {
    total: 0,
    processed: 0,
    linked: 0,
    unmatched: 0,
    failed: 0
  }
};

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function openBulkImageUploadModal() {
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
    stats: { total: 0, processed: 0, linked: 0, unmatched: 0, failed: 0 }
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

  const selectSection = document.getElementById('bulkImageFileSelectSection');
  if (selectSection) selectSection.style.display = 'block';

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
    } else if (item.status === 'unmatched') {
      icon = '<i class="fa-solid fa-circle-question" style="color: #E65100;"></i>';
      badgeColor = '#FFF3E0';
      borderColor = '#FFE0B2';
    } else if (item.status === 'failed') {
      icon = '<i class="fa-solid fa-circle-xmark" style="color: #C62828;"></i>';
      badgeColor = '#FFEBEE';
      borderColor = '#FFCDD2';
    }

    return `
      <div id="bulk-file-item-${item.id}" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; background: ${badgeColor}; border: 1px solid ${borderColor}; border-radius: 6px; font-size: 0.78rem;">
        <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65%;">
          ${icon}
          <strong style="color: var(--admin-text-dark); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.originalName}</strong>
          <span style="color: var(--admin-text-muted); font-size: 0.72rem;">(${item.formattedSize})</span>
        </div>
        <div style="font-size: 0.75rem; text-align: right; max-width: 35%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <span>${statusText}</span>
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
  } else if (item.status === 'unmatched') {
    icon = '<i class="fa-solid fa-circle-question" style="color: #E65100;"></i>';
    badgeColor = '#FFF3E0';
    borderColor = '#FFE0B2';
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
      <strong style="color: var(--admin-text-dark); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.originalName}</strong>
      <span style="color: var(--admin-text-muted); font-size: 0.72rem;">(${item.formattedSize})</span>
    </div>
    <div style="font-size: 0.75rem; text-align: right; max-width: 35%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
      <span>${statusText}</span>
    </div>
  `;
}

function updateProgressCounters() {
  const { total, processed, linked, unmatched, failed } = bulkUploadState.stats;
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  const bar = document.getElementById('bulkImageProgressBar');
  if (bar) bar.style.width = `${pct}%`;

  const counterText = document.getElementById('bulkImageProgressCounter');
  if (counterText) counterText.textContent = `${processed} / ${total} uploaded (${pct}%)`;

  const linkedEl = document.getElementById('bulkLinkedCount');
  if (linkedEl) linkedEl.textContent = linked;

  const unmatchedEl = document.getElementById('bulkUnmatchedCount');
  if (unmatchedEl) unmatchedEl.textContent = unmatched;

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
    processed: bulkUploadState.items.filter(it => it.status === 'linked' || it.status === 'unmatched' || (!it.isValid && it.status === 'failed')).length,
    linked: bulkUploadState.items.filter(it => it.status === 'linked').length,
    unmatched: bulkUploadState.items.filter(it => it.status === 'unmatched').length,
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
    const unmatchedList = data.unmatched || [];
    const failedList = data.failed || [];

    batch.items.forEach(item => {
      const matched = matchedList.find(m => m.filename.toLowerCase() === item.originalName.toLowerCase());
      const unmatched = unmatchedList.find(u => u.filename.toLowerCase() === item.originalName.toLowerCase());
      const failed = failedList.find(f => f.filename.toLowerCase() === item.originalName.toLowerCase());

      if (matched) {
        item.status = 'linked';
        item.details = `Linked to #${matched.designId} (${matched.sku || matched.title})`;
        item.matchedDesign = matched;
        bulkUploadState.stats.linked++;
      } else if (unmatched) {
        item.status = 'unmatched';
        item.details = unmatched.reason || 'No matching product found';
        bulkUploadState.stats.unmatched++;
      } else if (failed) {
        item.status = 'failed';
        item.details = failed.error || 'Upload error';
        item.referenceId = failed.referenceId;
        bulkUploadState.stats.failed++;
      } else {
        // Fallback: If returned in general matched/unmatched
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
  const unmatchedCount = bulkUploadState.items.filter(it => it.status === 'unmatched').length;
  const failedCount = bulkUploadState.items.filter(it => it.status === 'failed').length;

  if (reportSummaryText) {
    reportSummaryText.innerHTML = `
      <strong>Processed ${bulkUploadState.items.length} images:</strong>
      <span style="color: #2E7D32; font-weight: 600;">${linkedCount} successfully linked</span>,
      <span style="color: #E65100; font-weight: 600;">${unmatchedCount} unmatched</span>,
      <span style="color: #C62828; font-weight: 600;">${failedCount} failed</span>.
    `;
  }

  // Unmatched names list
  const unmatchedBox = document.getElementById('bulkUnmatchedDetailsBox');
  const unmatchedList = document.getElementById('bulkUnmatchedNamesList');
  const unmatchedItems = bulkUploadState.items.filter(it => it.status === 'unmatched');
  if (unmatchedItems.length > 0 && unmatchedBox && unmatchedList) {
    unmatchedList.innerHTML = unmatchedItems.map(it => `<div>• ${it.originalName} (${it.details})</div>`).join('');
    unmatchedBox.style.display = 'block';
  } else if (unmatchedBox) {
    unmatchedBox.style.display = 'none';
  }

  // Failed reasons list
  const failedBox = document.getElementById('bulkFailedDetailsBox');
  const failedList = document.getElementById('bulkFailedReasonsList');
  const failedItems = bulkUploadState.items.filter(it => it.status === 'failed');
  if (failedItems.length > 0 && failedBox && failedList) {
    failedList.innerHTML = failedItems.map(it => `<div>• ${it.originalName}: ${it.details}${it.referenceId ? ` [Ref: ${it.referenceId}]` : ''}</div>`).join('');
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



