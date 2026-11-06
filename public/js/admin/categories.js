/**
 * ARUVI Admin Categories Management
 * Handles AJAX category modal, drag-and-drop image upload with live preview,
 * in-place row updates, validation, delete with reassignment, and bulk actions.
 */

(function() {
  'use strict';

  let currentCategoryToDelete = null;

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getCsrfToken() {
    const meta = document.getElementById('catCsrfInput');
    if (meta && meta.value) return meta.value;
    const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
    return window.ARUVI_CSRF_TOKEN || '';
  }

  function showAdminToast(msg, isError = false, refId = null) {
    const toastId = isError ? 'adminErrorToast' : 'adminToastPopup';
    let toast = document.getElementById(toastId);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = toastId;
      document.body.appendChild(toast);
    }

    const bg = isError ? '#C62828' : '#1B5E20';
    const border = isError ? '#EF9A9A' : '#81C784';
    const icon = isError ? 'fa-solid fa-circle-exclamation' : 'fa-solid fa-circle-check';
    const iconColor = isError ? '#FFCDD2' : '#66BB6A';

    toast.style.cssText = `position: fixed; top: 25px; right: 25px; background: ${bg}; color: white; padding: 1rem 1.6rem; border-radius: 12px; box-shadow: 0 12px 30px rgba(0,0,0,0.25); z-index: 999999; display: flex; align-items: center; gap: 12px; font-weight: 600; font-size: 0.92rem; border: 2px solid ${border}; max-width: 420px; line-height: 1.4;`;

    let html = `<i class="${icon}" style="font-size: 1.4rem; color: ${iconColor}; flex-shrink: 0;"></i>`;
    html += `<div style="flex: 1;">${escapeHtml(msg)}`;
    if (refId) {
      html += `<div style="font-size: 0.76rem; opacity: 0.85; margin-top: 3px;">Reference ID: <code>${escapeHtml(refId)}</code></div>`;
    }
    html += `</div>`;
    html += `<button type="button" onclick="this.parentElement.style.display='none'" style="background: none; border: none; color: white; margin-left: 10px; cursor: pointer; font-size: 1.2rem; flex-shrink: 0;">&times;</button>`;

    toast.innerHTML = html;
    toast.style.display = 'flex';
    setTimeout(() => { if (toast) toast.style.display = 'none'; }, isError ? 7000 : 4500);
  }

  function clearValidationErrors() {
    document.querySelectorAll('.field-error-msg').forEach(el => el.innerText = '');
    document.querySelectorAll('.is-invalid-field').forEach(el => el.classList.remove('is-invalid-field'));
  }

  function setFieldError(fieldId, errorMsg) {
    const input = document.getElementById(fieldId);
    const errEl = document.getElementById(fieldId + 'Error');
    if (input) input.classList.add('is-invalid-field');
    if (errEl) errEl.innerText = errorMsg;
  }

  function updateIconPreview(iconClass) {
    const previewEl = document.getElementById('catIconPreview');
    if (previewEl) {
      previewEl.innerHTML = `<i class="${iconClass || 'fa-solid fa-shapes'}"></i>`;
    }
  }

  // Live File / Drag & Drop Image Preview
  function handleImageSelected(file) {
    if (!file) return;

    clearValidationErrors();
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    const allowedExts = ['.png', '.jpg', '.jpeg', '.webp'];

    if (!allowedExts.includes(ext)) {
      setFieldError('catImageInput', 'Invalid image format! Only JPG, PNG, and WEBP formats are supported.');
      showAdminToast('Invalid image format! Allowed formats: JPG, PNG, and WEBP.', true);
      document.getElementById('catImageInput').value = '';
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setFieldError('catImageInput', 'Image exceeds 5MB limit. Please upload an image under 5MB.');
      showAdminToast('Image exceeds 5MB limit. Please upload an image under 5MB.', true);
      document.getElementById('catImageInput').value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        const previewEl = document.getElementById('catImgPreviewEl');
        const box = document.getElementById('catImgPreviewBox');
        const status = document.getElementById('catImgPreviewStatus');
        const removeWrap = document.getElementById('catRemoveImgWrap');
        const removeChk = document.getElementById('catRemoveImage');

        if (previewEl) {
          previewEl.src = e.target.result;
          previewEl.style.opacity = '1';
        }
        if (box) box.style.display = 'flex';
        if (removeChk) removeChk.checked = false;
        if (removeWrap) removeWrap.style.display = 'none';

        if (status) {
          const dims = `${this.naturalWidth}×${this.naturalHeight}px`;
          const sizeKb = Math.round(file.size / 1024);
          status.innerHTML = `<span style="color: #2E7D32; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> New Image Ready:</span><br><strong style="color: var(--admin-text-dark);">${escapeHtml(file.name)}</strong> (${dims}, ${sizeKb} KB)`;
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function initDropzone() {
    const dropzone = document.getElementById('catImageDropzone');
    const input = document.getElementById('catImageInput');
    if (!dropzone || !input) return;

    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('dropzone-active');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dropzone-active');
      }, false);
    });

    dropzone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt.files;
      if (files && files.length > 0) {
        input.files = files;
        handleImageSelected(files[0]);
      }
    });

    input.addEventListener('change', function() {
      if (this.files && this.files.length > 0) {
        handleImageSelected(this.files[0]);
      }
    });
  }

  function openAddCategoryModal() {
    clearValidationErrors();
    document.getElementById('modalTitle').innerText = 'Add New Category';
    const form = document.getElementById('categoryForm');
    form.dataset.mode = 'create';
    form.dataset.id = '';
    form.action = '/admin/categories/create';

    document.getElementById('catName').value = '';
    document.getElementById('catSlug').value = '';
    document.getElementById('catDesc').value = '';
    document.getElementById('catDisplayOrder').value = '0';
    document.getElementById('catIconSelect').value = 'fa-solid fa-shapes';
    updateIconPreview('fa-solid fa-shapes');
    document.getElementById('catShowOnHome').checked = true;
    document.getElementById('catIsActive').checked = true;

    // Reset image
    document.getElementById('catImageInput').value = '';
    document.getElementById('catImgPreviewBox').style.display = 'none';
    document.getElementById('catRemoveImgWrap').style.display = 'none';
    document.getElementById('catRemoveImage').checked = false;

    document.getElementById('categoryModal').style.display = 'flex';
  }

  function openEditCategoryFromBtn(btn) {
    clearValidationErrors();
    const d = btn.dataset;
    document.getElementById('modalTitle').innerText = `Edit Category #${d.id} — ${d.name}`;
    const form = document.getElementById('categoryForm');
    form.dataset.mode = 'edit';
    form.dataset.id = d.id;
    form.action = `/admin/categories/edit/${d.id}`;

    document.getElementById('catName').value = d.name || '';
    document.getElementById('catSlug').value = d.slug || '';
    document.getElementById('catDesc').value = d.desc || '';
    document.getElementById('catDisplayOrder').value = d.order || '0';

    const iconVal = d.icon || 'fa-solid fa-shapes';
    document.getElementById('catIconSelect').value = iconVal;
    updateIconPreview(iconVal);

    document.getElementById('catShowOnHome').checked = (d.home === '1' || d.home === 'true');
    document.getElementById('catIsActive').checked = (d.active === '1' || d.active === 'true');

    // Reset image input
    document.getElementById('catImageInput').value = '';
    document.getElementById('catRemoveImage').checked = false;

    const box = document.getElementById('catImgPreviewBox');
    const previewEl = document.getElementById('catImgPreviewEl');
    const status = document.getElementById('catImgPreviewStatus');
    const removeWrap = document.getElementById('catRemoveImgWrap');

    if (d.image && d.image.trim() !== '') {
      if (previewEl) {
        previewEl.src = d.image;
        previewEl.style.opacity = '1';
      }
      if (status) {
        const filename = d.image.split('/').pop();
        status.innerHTML = `<span style="font-weight: 600; color: var(--admin-text-dark);">Current Category Image:</span><br><code style="font-size: 0.76rem;">${escapeHtml(filename)}</code>`;
      }
      if (box) box.style.display = 'flex';
      if (removeWrap) removeWrap.style.display = 'block';
    } else {
      if (box) box.style.display = 'none';
      if (removeWrap) removeWrap.style.display = 'none';
    }

    document.getElementById('categoryModal').style.display = 'flex';
  }

  function closeCategoryModal() {
    document.getElementById('categoryModal').style.display = 'none';
  }

  function toggleRemoveImg(chk) {
    const previewEl = document.getElementById('catImgPreviewEl');
    const status = document.getElementById('catImgPreviewStatus');
    if (previewEl) {
      previewEl.style.opacity = chk.checked ? '0.25' : '1';
    }
    if (status) {
      if (chk.checked) {
        status.innerHTML = '<span style="color: #C62828; font-weight: 600;"><i class="fa-solid fa-trash-can"></i> Image will be removed upon save.</span>';
      } else {
        status.innerHTML = '<span style="font-weight: 600; color: var(--admin-text-dark);">Current Category Image</span>';
      }
    }
  }

  // Update existing row in table without full reload
  function updateTableRow(cat) {
    const row = document.getElementById(`catRow-${cat.id}`);
    if (!row) {
      // If newly created row, reload or dynamically append
      setTimeout(() => window.location.reload(), 400);
      return;
    }

    // 1. Update Thumbnail & Name
    const cellGroup = row.querySelector('.cat-cell-group');
    if (cellGroup) {
      const img = cellGroup.querySelector('.cat-thumb-img');
      const placeholder = cellGroup.querySelector('.cat-thumb-placeholder');
      if (cat.image_url) {
        if (img) {
          img.src = cat.image_url;
          img.style.display = 'block';
        } else {
          const newImg = document.createElement('img');
          newImg.src = cat.image_url;
          newImg.alt = cat.name;
          newImg.className = 'cat-thumb-img';
          cellGroup.insertBefore(newImg, placeholder);
        }
        if (placeholder) placeholder.style.display = 'none';
      } else {
        if (img) img.style.display = 'none';
        if (placeholder) {
          placeholder.style.display = 'flex';
          placeholder.innerHTML = `<i class="${cat.icon || 'fa-solid fa-shapes'}"></i>`;
        }
      }

      const nameHeading = cellGroup.querySelector('.cat-name-heading');
      if (nameHeading) {
        nameHeading.textContent = cat.name;
        nameHeading.title = cat.name;
      }
      const tag = cellGroup.querySelector('.cat-tag');
      if (tag) tag.textContent = cat.name;
    }

    // 2. Update Icon Badge
    const iconBadge = row.querySelector('.cat-icon-badge');
    if (iconBadge) {
      iconBadge.innerHTML = `<i class="${cat.icon || 'fa-solid fa-shapes'}"></i>`;
    }

    // 3. Update Slug Badge
    const slugBadge = row.querySelector('.cat-slug-badge');
    if (slugBadge) {
      slugBadge.textContent = cat.slug;
      slugBadge.title = cat.slug;
    }

    // 4. Update Order Number
    const orderVal = document.getElementById(`catOrderNum-${cat.id}`);
    if (orderVal) orderVal.textContent = cat.sort_order;

    // 5. Update Home switch label
    const homeLabel = document.getElementById(`catHomeLabel-${cat.id}`);
    const homeChk = row.querySelector('input[onchange*="toggleCategoryHome"]');
    if (homeLabel) {
      const isH = Boolean(cat.show_on_home);
      homeLabel.textContent = isH ? 'Home' : 'Hidden';
      homeLabel.className = 'switch-label-text ' + (isH ? 'active' : 'inactive');
      if (homeChk) homeChk.checked = isH;
    }

    // 6. Update Status switch label
    const statusLabel = document.getElementById(`catStatusLabel-${cat.id}`);
    const statusChk = row.querySelector('input[onchange*="toggleCategoryStatus"]');
    if (statusLabel) {
      const isA = Boolean(cat.is_active);
      statusLabel.textContent = isA ? 'Active' : 'Inactive';
      statusLabel.className = 'switch-label-text ' + (isA ? 'active' : 'inactive');
      if (statusChk) statusChk.checked = isA;
    }

    // 7. Update Edit Button dataset
    const editBtn = row.querySelector('.edit-btn');
    if (editBtn) {
      editBtn.dataset.name = cat.name;
      editBtn.dataset.slug = cat.slug;
      editBtn.dataset.desc = cat.description || '';
      editBtn.dataset.icon = cat.icon || 'fa-solid fa-shapes';
      editBtn.dataset.order = cat.sort_order;
      editBtn.dataset.home = cat.show_on_home ? '1' : '0';
      editBtn.dataset.active = cat.is_active ? '1' : '0';
      editBtn.dataset.image = cat.image_url || '';
    }

    // Pulse highlight row
    row.style.transition = 'background-color 0.4s ease';
    row.style.backgroundColor = '#E8F5E9';
    setTimeout(() => { row.style.backgroundColor = ''; }, 1200);
  }

  // Handle Form Submission via AJAX
  function handleFormSubmit(e) {
    e.preventDefault();
    clearValidationErrors();

    const form = document.getElementById('categoryForm');
    const saveBtn = document.getElementById('saveCatBtn');
    const origBtnText = saveBtn.innerHTML;

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

    const formData = new FormData(form);

    fetch(form.action, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': getCsrfToken()
      },
      body: formData
    })
    .then(async res => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw data;
      }
      return data;
    })
    .then(data => {
      saveBtn.disabled = false;
      saveBtn.innerHTML = origBtnText;

      if (data.success) {
        closeCategoryModal();
        showAdminToast(data.message || 'Category saved successfully!');
        if (data.category) {
          updateTableRow(data.category);
        } else {
          setTimeout(() => window.location.reload(), 400);
        }
      } else {
        showAdminToast(data.message || 'Failed to save category.', true, data.refId);
        if (data.errors) {
          if (data.errors.name) setFieldError('catName', data.errors.name);
          if (data.errors.slug) setFieldError('catSlug', data.errors.slug);
          if (data.errors.image) setFieldError('catImageInput', data.errors.image);
        }
      }
    })
    .catch(err => {
      saveBtn.disabled = false;
      saveBtn.innerHTML = origBtnText;

      if (err && err.errors) {
        if (err.errors.name) setFieldError('catName', err.errors.name);
        if (err.errors.slug) setFieldError('catSlug', err.errors.slug);
        if (err.errors.image) setFieldError('catImageInput', err.errors.image);
      }
      const msg = (err && err.message) ? err.message : 'Server error saving category.';
      showAdminToast(msg, true, err ? err.refId : null);
    });
  }

  // Delete Category Handling
  function confirmDeleteCategoryFromBtn(btn) {
    if (!btn || !btn.dataset) return;
    const id = btn.dataset.id;
    const name = btn.dataset.name || '';
    const designsCount = parseInt(btn.dataset.designs || '0', 10);

    currentCategoryToDelete = { id, name, designsCount };

    const modal = document.getElementById('deleteCategoryModal');
    const title = document.getElementById('deleteCategoryTitle');
    const msg = document.getElementById('deleteCategoryModalText');
    const reassignWrap = document.getElementById('deleteReassignWrap');
    const reassignSelect = document.getElementById('deleteReassignSelect');

    if (designsCount > 0) {
      if (title) title.innerText = 'Reassign Designs Before Deleting';
      if (msg) msg.innerHTML = `Category <strong>"${escapeHtml(name)}"</strong> currently has <strong>${designsCount} design(s)</strong>.<br>Please select another category to move these designs to before deleting:`;
      if (reassignWrap) reassignWrap.style.display = 'block';

      // Populate reassign select with other categories
      if (reassignSelect) {
        reassignSelect.innerHTML = '<option value="">-- Choose Target Category --</option>';
        document.querySelectorAll('.compact-action-btn.edit-btn').forEach(b => {
          if (b.dataset.id !== id) {
            const opt = document.createElement('option');
            opt.value = b.dataset.id;
            opt.textContent = `#${b.dataset.id} - ${b.dataset.name}`;
            reassignSelect.appendChild(opt);
          }
        });
      }
    } else {
      if (title) title.innerText = 'Delete Category?';
      if (msg) msg.innerHTML = `Are you sure you want to delete category <strong>"${escapeHtml(name)}"</strong>?`;
      if (reassignWrap) reassignWrap.style.display = 'none';
    }

    if (modal) modal.style.display = 'flex';
  }

  function closeDeleteCategoryModal() {
    currentCategoryToDelete = null;
    const modal = document.getElementById('deleteCategoryModal');
    if (modal) modal.style.display = 'none';
  }

  function executeDeleteCategory() {
    if (!currentCategoryToDelete) return;
    const { id, name, designsCount } = currentCategoryToDelete;

    let reassignTo = null;
    if (designsCount > 0) {
      const select = document.getElementById('deleteReassignSelect');
      if (!select || !select.value) {
        alert('Please select a target category to reassign designs to.');
        return;
      }
      reassignTo = select.value;
    }

    const btn = document.getElementById('confirmDeleteCategoryBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Deleting...'; }

    fetch(`/admin/categories/delete/${id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': getCsrfToken()
      },
      body: JSON.stringify({
        _csrf: getCsrfToken(),
        reassign_to: reassignTo
      })
    })
    .then(async res => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw data;
      return data;
    })
    .then(data => {
      closeDeleteCategoryModal();
      if (btn) { btn.disabled = false; btn.textContent = 'Delete'; }
      if (data.success) {
        const row = document.getElementById(`catRow-${id}`);
        if (row) {
          row.style.opacity = '0';
          row.style.transition = 'opacity 0.3s ease';
          setTimeout(() => row.remove(), 300);
        }
        showAdminToast(data.message || `Category "${name}" deleted.`);
      } else {
        showAdminToast(data.message || 'Unable to delete category.', true, data.refId);
      }
    })
    .catch(err => {
      closeDeleteCategoryModal();
      if (btn) { btn.disabled = false; btn.textContent = 'Delete'; }
      showAdminToast(err.message || 'Error deleting category.', true, err ? err.refId : null);
    });
  }

  // Toggles & Reordering
  async function toggleCategoryStatus(id) {
    try {
      const res = await fetch(`/admin/categories/toggle-status/${id}`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRF-Token': getCsrfToken()
        }
      });
      const data = await res.json();
      if (data.success) {
        const lbl = document.getElementById(`catStatusLabel-${id}`);
        if (lbl) {
          lbl.innerText = data.is_active ? 'Active' : 'Inactive';
          lbl.className = 'switch-label-text ' + (data.is_active ? 'active' : 'inactive');
        }
        showAdminToast(data.message || 'Category status updated.');
      } else {
        showAdminToast(data.message || 'Error updating status', true, data.refId);
      }
    } catch (e) {
      showAdminToast('Network error updating category status.', true);
    }
  }

  async function toggleCategoryHome(id) {
    try {
      const res = await fetch(`/admin/categories/toggle-home/${id}`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRF-Token': getCsrfToken()
        }
      });
      const data = await res.json();
      if (data.success) {
        const lbl = document.getElementById(`catHomeLabel-${id}`);
        if (lbl) {
          lbl.innerText = data.show_on_home ? 'Home' : 'Hidden';
          lbl.className = 'switch-label-text ' + (data.show_on_home ? 'active' : 'inactive');
        }
        showAdminToast(data.message || 'Home visibility updated.');
      } else {
        showAdminToast(data.message || 'Error updating home visibility', true, data.refId);
      }
    } catch (e) {
      showAdminToast('Network error updating category home visibility.', true);
    }
  }

  async function reorderCategory(id, direction) {
    try {
      const res = await fetch(`/admin/categories/reorder/${id}/${direction}`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRF-Token': getCsrfToken()
        }
      });
      const data = await res.json();
      if (data.success) {
        showAdminToast(data.message || 'Category order updated.');
        setTimeout(() => window.location.reload(), 300);
      } else {
        showAdminToast(data.message || 'Error updating category order', true, data.refId);
      }
    } catch (e) {
      showAdminToast('Network error reordering category.', true);
    }
  }

  // Bulk Operations
  function getSelectedCategoryIds() {
    return Array.from(document.querySelectorAll('.cat-checkbox:checked')).map(cb => cb.value);
  }

  function updateBulkBar() {
    const selected = getSelectedCategoryIds();
    const bar = document.getElementById('catBulkBar');
    const countEl = document.getElementById('catBulkCount');
    if (bar && countEl) {
      if (selected.length > 0) {
        countEl.textContent = `${selected.length} Selected`;
        bar.style.display = 'flex';
      } else {
        bar.style.display = 'none';
      }
    }
  }

  async function executeBulkAction(action) {
    const ids = getSelectedCategoryIds();
    if (ids.length === 0) return;

    if (!confirm(`Are you sure you want to ${action} ${ids.length} selected categories?`)) return;

    try {
      const res = await fetch('/admin/categories/bulk-action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRF-Token': getCsrfToken()
        },
        body: JSON.stringify({
          action,
          ids,
          _csrf: getCsrfToken()
        })
      });
      const data = await res.json();
      if (data.success) {
        showAdminToast(data.message || 'Bulk operation completed.');
        setTimeout(() => window.location.reload(), 400);
      } else {
        showAdminToast(data.message || 'Bulk operation failed.', true, data.refId);
      }
    } catch (e) {
      showAdminToast('Network error during bulk operation.', true);
    }
  }

  // Initialize event bindings on DOM load
  document.addEventListener('DOMContentLoaded', () => {
    initDropzone();

    const form = document.getElementById('categoryForm');
    if (form) {
      form.addEventListener('submit', handleFormSubmit);
    }

    const selectAll = document.getElementById('selectAllCats');
    if (selectAll) {
      selectAll.addEventListener('change', function() {
        document.querySelectorAll('.cat-checkbox').forEach(cb => cb.checked = selectAll.checked);
        updateBulkBar();
      });
    }

    document.querySelectorAll('.cat-checkbox').forEach(cb => {
      cb.addEventListener('change', updateBulkBar);
    });
  });

  // Expose global methods for template inline callers
  window.openAddCategoryModal = openAddCategoryModal;
  window.openEditCategoryFromBtn = openEditCategoryFromBtn;
  window.closeCategoryModal = closeCategoryModal;
  window.toggleRemoveImg = toggleRemoveImg;
  window.updateIconPreview = updateIconPreview;
  window.confirmDeleteCategoryFromBtn = confirmDeleteCategoryFromBtn;
  window.closeDeleteCategoryModal = closeDeleteCategoryModal;
  window.executeDeleteCategory = executeDeleteCategory;
  window.toggleCategoryStatus = toggleCategoryStatus;
  window.toggleCategoryHome = toggleCategoryHome;
  window.reorderCategory = reorderCategory;
  window.executeBulkAction = executeBulkAction;
})();
