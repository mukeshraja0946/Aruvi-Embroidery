/**
 * Bulk Image & ZIP Replace by Category Controller
 * Handles streamlined 4-step workflow:
 * 1. Category & Existing Group Selection (Scans actual stored paths, e.g. "ARUVI BULK DESIGNS 2")
 * 2. Select New Files (Multi-file select or Drag & Drop, no folder picker required)
 * 3. Confirmation Summary (Category, Group name, Old image/ZIP counts to remove, New image/ZIP counts to activate)
 * 4. Apply & Report (Chunked upload, replaces old files so only new files are active, 7-day rollback backup)
 */

(function () {
  'use strict';

  class BulkImageReplace {
    constructor() {
      this.currentStep = 1;
      this.currentCategoryId = null;
      this.currentCategoryName = '';
      this.availableGroups = [];
      this.selectedGroup = null;
      this.selectedFiles = [];
      this.isUploading = false;
      this.abortController = null;
      this.lastLogId = null;

      this.initEvents();
    }

    getCSRF() {
      return window.CSRF_TOKEN ||
             document.querySelector('meta[name="csrf-token"]')?.content ||
             document.querySelector('input[name="_csrf"]')?.value || '';
    }

    initEvents() {
      // Wire standard files input
      const filesInput = document.getElementById('bulkReplaceFileInput');
      if (filesInput) {
        filesInput.addEventListener('change', (e) => this.handleFilesSelected(e.target.files));
      }

      // Wire drag & drop area
      const dropZone = document.getElementById('bulkReplaceDropZone');
      if (dropZone) {
        ['dragenter', 'dragover'].forEach(name => {
          dropZone.addEventListener(name, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.style.borderColor = '#16A34A';
            dropZone.style.background = '#ECFDF5';
          });
        });

        ['dragleave', 'drop'].forEach(name => {
          dropZone.addEventListener(name, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.style.borderColor = '#0284C7';
            dropZone.style.background = '#F0F9FF';
          });
        });

        dropZone.addEventListener('drop', (e) => {
          if (e.dataTransfer && e.dataTransfer.files) {
            this.handleFilesSelected(e.dataTransfer.files);
          }
        });
      }
    }

    async openModal() {
      const modal = document.getElementById('bulkReplaceImagesModal');
      if (!modal) {
        console.error('[BulkReplace] Modal element #bulkReplaceImagesModal not found');
        return;
      }
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';

      this.currentStep = 1;
      this.selectedFiles = [];
      this.selectedGroup = null;
      this.isUploading = false;
      this.lastLogId = null;

      // Reset file input and badges
      const filesInput = document.getElementById('bulkReplaceFileInput');
      if (filesInput) filesInput.value = '';

      const summaryBadge = document.getElementById('selectedFilesSummaryBadge');
      if (summaryBadge) summaryBadge.style.display = 'none';

      const nextFilesBtn = document.getElementById('bulkReplaceFilesNextBtn');
      if (nextFilesBtn) nextFilesBtn.disabled = true;

      const confirmBtn = document.getElementById('bulkReplaceConfirmBtn');
      if (confirmBtn) confirmBtn.disabled = false;

      this.updateStepView();

      const catSelect = document.getElementById('bulkReplaceCategorySelect');
      const initialCatId = catSelect ? catSelect.value : 'all';
      await this.loadCategoryGroups(initialCatId);
    }

    closeModal() {
      if (this.isUploading) {
        if (!confirm('A file replacement is currently uploading. Are you sure you want to cancel and exit?')) {
          return;
        }
        if (this.abortController) this.abortController.abort();
      }
      const modal = document.getElementById('bulkReplaceImagesModal');
      if (modal) modal.style.display = 'none';
      document.body.style.overflow = '';
    }

    updateStepView() {
      for (let s = 1; s <= 4; s++) {
        const stepHeader = document.getElementById(`bulkReplaceStepHeader${s}`);
        const stepBody = document.getElementById(`bulkReplaceStepBody${s}`);
        const stepFooter = document.getElementById(`bulkReplaceStepFooter${s}`);

        if (stepHeader) {
          stepHeader.classList.toggle('active', s === this.currentStep);
          stepHeader.classList.toggle('completed', s < this.currentStep);

          if (s === this.currentStep) {
            stepHeader.style.background = '#0284C7';
            stepHeader.style.color = '#FFFFFF';
          } else if (s < this.currentStep) {
            stepHeader.style.background = '#E0F2FE';
            stepHeader.style.color = '#0369A1';
          } else {
            stepHeader.style.background = '#E2E8F0';
            stepHeader.style.color = '#475569';
          }
        }
        if (stepBody) stepBody.style.display = (s === this.currentStep) ? 'block' : 'none';
        if (stepFooter) stepFooter.style.display = (s === this.currentStep) ? 'flex' : 'none';
      }
    }

    // ==============================================================
    // STEP 1: CATEGORY & DETECTED EXISTING FOLDER GROUP SELECTION
    // ==============================================================
    async loadCategoryGroups(categoryId) {
      const groupSelect = document.getElementById('bulkReplaceGroupSelect');
      const nextBtn = document.getElementById('bulkReplaceScopeNextBtn');

      if (groupSelect) {
        groupSelect.innerHTML = '<option value="">Scanning stored image & ZIP paths...</option>';
      }
      if (nextBtn) nextBtn.disabled = true;

      const catSelect = document.getElementById('bulkReplaceCategorySelect');
      if (catSelect && catSelect.selectedOptions && catSelect.selectedOptions[0]) {
        this.currentCategoryName = catSelect.selectedOptions[0].textContent.replace(/\s*\(\d+\s*designs\)/i, '').trim();
      } else {
        this.currentCategoryName = 'Selected Category';
      }
      this.currentCategoryId = categoryId;

      try {
        const res = await fetch(`/admin/designs/bulk-replace/groups?categoryId=${encodeURIComponent(categoryId || 'all')}`);
        const data = await res.json();

        if (data.success) {
          this.availableGroups = data.groups || [];
          this.currentCategoryName = data.categoryName || this.currentCategoryName;

          if (groupSelect) {
            groupSelect.innerHTML = '';

            if (this.availableGroups.length === 0) {
              const opt = document.createElement('option');
              opt.value = '';
              opt.textContent = 'No designs found in this category';
              groupSelect.appendChild(opt);
              this.selectGroup(null);
              return;
            }

            let preferredGroup = null;

            this.availableGroups.forEach((g, idx) => {
              const opt = document.createElement('option');
              opt.value = g.groupName;
              opt.textContent = `📁 ${g.groupName} (${g.designCount} designs — ${g.existingImagesCount} images, ${g.existingZipsCount} ZIPs)`;
              groupSelect.appendChild(opt);

              if (/aruvi.*bulk.*designs.*2/i.test(g.groupName) || idx === 0) {
                if (!preferredGroup || /aruvi.*bulk.*designs.*2/i.test(g.groupName)) {
                  preferredGroup = g;
                }
              }
            });

            if (preferredGroup) {
              groupSelect.value = preferredGroup.groupName;
              this.selectGroup(preferredGroup.groupName);
            }
          }
        } else {
          if (groupSelect) {
            groupSelect.innerHTML = `<option value="">Error: ${data.message || 'Failed to scan paths'}</option>`;
          }
          this.selectGroup(null);
        }
      } catch (err) {
        console.error('[BulkReplace] Error scanning category groups:', err);
        if (groupSelect) {
          groupSelect.innerHTML = `<option value="">Error scanning paths: ${err.message}</option>`;
        }
        this.selectGroup(null);
      }
    }

    selectGroup(groupName) {
      const nextBtn = document.getElementById('bulkReplaceScopeNextBtn');
      const nameEl = document.getElementById('groupDetailName');
      const designsEl = document.getElementById('groupDetailDesignsCount');
      const imagesEl = document.getElementById('groupDetailImagesCount');
      const zipsEl = document.getElementById('groupDetailZipsCount');

      if (!groupName) {
        this.selectedGroup = null;
        if (nameEl) nameEl.textContent = '-';
        if (designsEl) designsEl.textContent = '0';
        if (imagesEl) imagesEl.textContent = '0';
        if (zipsEl) zipsEl.textContent = '0';
        if (nextBtn) nextBtn.disabled = true;
        return;
      }

      const foundGroup = this.availableGroups.find(g => g.groupName === groupName);
      if (foundGroup) {
        this.selectedGroup = foundGroup;
        if (nameEl) nameEl.textContent = foundGroup.groupName;
        if (designsEl) designsEl.textContent = foundGroup.designCount;
        if (imagesEl) imagesEl.textContent = foundGroup.existingImagesCount;
        if (zipsEl) zipsEl.textContent = foundGroup.existingZipsCount;
        if (nextBtn) nextBtn.disabled = false;
      } else {
        this.selectedGroup = null;
        if (nextBtn) nextBtn.disabled = true;
      }
    }

    proceedToStep2() {
      if (!this.selectedGroup) {
        alert('Please choose an existing folder or group to replace.');
        return;
      }
      this.currentStep = 2;
      this.updateStepView();
    }

    // ==============================================================
    // STEP 2: SELECT NEW FILES (FILES DIRECTLY, NO FOLDER REQUIRED)
    // ==============================================================
    handleFilesSelected(filesList) {
      if (!filesList || filesList.length === 0) return;

      const allowedExts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.zip']);
      const validFiles = Array.from(filesList).filter(f => {
        const ext = f.name.substring(f.name.lastIndexOf('.')).toLowerCase();
        return allowedExts.has(ext);
      });

      if (validFiles.length === 0) {
        alert('No supported files found. Supported formats: PNG, JPG, JPEG, WebP, and ZIP.');
        return;
      }

      this.selectedFiles = validFiles;

      const imgCount = validFiles.filter(f => !f.name.toLowerCase().endsWith('.zip')).length;
      const zipCount = validFiles.filter(f => f.name.toLowerCase().endsWith('.zip')).length;

      const summaryBadge = document.getElementById('selectedFilesSummaryBadge');
      const imgEl = document.getElementById('selectedNewImagesCount');
      const zipEl = document.getElementById('selectedNewZipsCount');
      const totalEl = document.getElementById('selectedNewTotalCount');

      if (summaryBadge && imgEl && zipEl && totalEl) {
        summaryBadge.style.display = 'flex';
        imgEl.textContent = imgCount;
        zipEl.textContent = zipCount;
        totalEl.textContent = validFiles.length;
      }

      const nextBtn = document.getElementById('bulkReplaceFilesNextBtn');
      if (nextBtn) {
        nextBtn.disabled = validFiles.length === 0;
      }
    }

    // ==============================================================
    // STEP 3: CONFIRMATION SUMMARY (NO MANUAL MAPPING / PREVIEW)
    // ==============================================================
    proceedToStep3() {
      if (!this.selectedFiles || this.selectedFiles.length === 0) {
        alert('Please select or drag-and-drop replacement files first.');
        return;
      }

      const newImgCount = this.selectedFiles.filter(f => !f.name.toLowerCase().endsWith('.zip')).length;
      const newZipCount = this.selectedFiles.filter(f => f.name.toLowerCase().endsWith('.zip')).length;

      const confCategoryName = document.getElementById('confCategoryName');
      const confGroupName = document.getElementById('confGroupName');
      const confOldImagesCount = document.getElementById('confOldImagesCount');
      const confOldZipsCount = document.getElementById('confOldZipsCount');
      const confNewImagesCount = document.getElementById('confNewImagesCount');
      const confNewZipsCount = document.getElementById('confNewZipsCount');

      if (confCategoryName) confCategoryName.textContent = this.currentCategoryName || 'Selected Category';
      if (confGroupName) confGroupName.textContent = this.selectedGroup ? this.selectedGroup.groupName : '-';
      if (confOldImagesCount) confOldImagesCount.textContent = this.selectedGroup ? this.selectedGroup.existingImagesCount : 0;
      if (confOldZipsCount) confOldZipsCount.textContent = this.selectedGroup ? this.selectedGroup.existingZipsCount : 0;
      if (confNewImagesCount) confNewImagesCount.textContent = newImgCount;
      if (confNewZipsCount) confNewZipsCount.textContent = newZipCount;

      this.currentStep = 3;
      this.updateStepView();
    }

    // ==============================================================
    // STEP 4: APPLY REPLACEMENT & REPORT
    // ==============================================================
    async executeReplace() {
      if (this.isUploading) return;
      if (!this.selectedGroup) {
        alert('Missing target group to replace.');
        return;
      }
      if (!this.selectedFiles || this.selectedFiles.length === 0) {
        alert('No replacement files selected.');
        return;
      }

      // Prevent duplicate clicks
      this.isUploading = true;
      const confirmBtn = document.getElementById('bulkReplaceConfirmBtn');
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Replacing Files...';
      }

      this.currentStep = 4;
      this.updateStepView();

      const progressSection = document.getElementById('uploadProgressSection');
      const reportSection = document.getElementById('uploadReportSection');
      if (progressSection) progressSection.style.display = 'block';
      if (reportSection) reportSection.style.display = 'none';

      const progressBar = document.getElementById('bulkReplaceProgressBar');
      const progressPercent = document.getElementById('bulkReplaceProgressPercent');
      const progressStatus = document.getElementById('bulkReplaceProgressStatus');

      this.abortController = new AbortController();

      const chunkSize = 5;
      const chunks = [];
      for (let i = 0; i < this.selectedFiles.length; i += chunkSize) {
        chunks.push(this.selectedFiles.slice(i, i + chunkSize));
      }

      let uploadedProcessedItems = [];
      let completedChunks = 0;

      try {
        const parallelLimit = 3;
        let activeIdx = 0;

        const uploadWorker = async () => {
          while (activeIdx < chunks.length) {
            const currentIdx = activeIdx++;
            const chunkFiles = chunks[currentIdx];

            const formData = new FormData();
            formData.append('_csrf', this.getCSRF());
            chunkFiles.forEach(file => {
              formData.append('files', file, file.name);
            });

            const res = await fetch('/admin/designs/bulk-replace/upload-chunk', {
              method: 'POST',
              headers: {
                'CSRF-Token': this.getCSRF()
              },
              body: formData,
              signal: this.abortController.signal
            });

            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.message || `Server returned error status ${res.status}`);
            }

            const data = await res.json();
            if (data.success && data.files) {
              data.files.forEach(pfile => {
                uploadedProcessedItems.push({
                  originalName: pfile.originalName,
                  publicUrl: pfile.publicUrl || null,
                  thumbUrl: pfile.thumbUrl || null,
                  storageKey: pfile.storageKey || null,
                  fileSize: pfile.fileSize,
                  checksum: pfile.checksum,
                  isZip: pfile.isZip || false,
                  detectedFormats: pfile.detectedFormats || []
                });
              });
            }

            completedChunks++;
            const percent = Math.round((completedChunks / chunks.length) * 85);
            if (progressBar) progressBar.style.width = `${percent}%`;
            if (progressPercent) progressPercent.textContent = `${percent}%`;
            if (progressStatus) progressStatus.textContent = `Uploaded chunk ${completedChunks} of ${chunks.length}...`;
          }
        };

        const workers = [];
        for (let w = 0; w < Math.min(parallelLimit, chunks.length); w++) {
          workers.push(uploadWorker());
        }
        await Promise.all(workers);

        // Commit replacement in database:
        // Removes old images and ZIPs belonging to this group, sets new files active
        if (progressStatus) progressStatus.textContent = 'Removing old files and activating newly selected files in database...';
        if (progressBar) progressBar.style.width = '92%';
        if (progressPercent) progressPercent.textContent = '92%';

        const commitRes = await fetch('/admin/designs/bulk-replace/commit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'CSRF-Token': this.getCSRF()
          },
          body: JSON.stringify({
            _csrf: this.getCSRF(),
            categoryId: this.currentCategoryId,
            categoryName: this.currentCategoryName,
            groupName: this.selectedGroup.groupName,
            scopeSummary: `Replaced all files in group "${this.selectedGroup.groupName}"`,
            replacementMode: 'replace_group',
            items: uploadedProcessedItems
          }),
          signal: this.abortController.signal
        });

        const commitData = await commitRes.json();
        if (!commitData.success) {
          throw new Error(commitData.message || 'Database replacement commit failed');
        }

        this.lastLogId = commitData.logId;
        this.isUploading = false;

        if (progressBar) progressBar.style.width = '100%';
        if (progressPercent) progressPercent.textContent = '100%';

        // Display Final Completion Report Section
        if (progressSection) progressSection.style.display = 'none';
        if (reportSection) reportSection.style.display = 'block';

        const reportSummaryEl = document.getElementById('reportGroupSummaryText');
        if (reportSummaryEl) {
          reportSummaryEl.textContent = commitData.message || `All old files in "${this.selectedGroup.groupName}" have been removed. Only newly selected files are active.`;
        }

        const replacedImgEl = document.getElementById('reportCountReplacedImages');
        const replacedZipEl = document.getElementById('reportCountReplacedZips');
        const removedOldEl = document.getElementById('reportCountRemovedOld');
        const failedEl = document.getElementById('reportCountFailed');

        if (replacedImgEl) replacedImgEl.textContent = commitData.replacedImagesCount || 0;
        if (replacedZipEl) replacedZipEl.textContent = commitData.replacedZipsCount || 0;
        if (removedOldEl) removedOldEl.textContent = commitData.removedOldFilesCount || 0;
        if (failedEl) failedEl.textContent = commitData.failedCount || 0;

        // CSV Report download link
        const csvBtn = document.getElementById('bulkReplaceDownloadCsvBtn');
        if (csvBtn) {
          csvBtn.href = `/admin/designs/bulk-replace/export-csv/${commitData.logId}`;
        }

        // 7-day rollback button
        const undoBtn = document.getElementById('bulkReplaceUndoBtn');
        if (undoBtn) {
          undoBtn.style.display = 'inline-flex';
          undoBtn.onclick = () => this.undoCurrentReplace(commitData.logId);
        }
      } catch (err) {
        this.isUploading = false;
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> Replace Files Now';
        }
        alert('Replacement Error: ' + err.message);
        if (progressStatus) progressStatus.textContent = 'Error: ' + err.message;
        // Allow user to return to Step 3 to review
        this.currentStep = 3;
        this.updateStepView();
      }
    }

    cancelUpload() {
      if (this.abortController) {
        this.abortController.abort();
      }
      this.isUploading = false;
      const confirmBtn = document.getElementById('bulkReplaceConfirmBtn');
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> Replace Files Now';
      }
      alert('Upload cancelled.');
      this.currentStep = 3;
      this.updateStepView();
    }

    async undoCurrentReplace(logId) {
      if (!confirm(`Are you sure you want to revert this replacement (Session #${logId})?\n\nThis will restore all affected products to their previous files from the safety backup.`)) {
        return;
      }

      try {
        const res = await fetch(`/admin/designs/bulk-replace/undo/${logId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'CSRF-Token': this.getCSRF()
          },
          body: JSON.stringify({ _csrf: this.getCSRF() })
        });
        const data = await res.json();
        if (data.success) {
          alert(data.message || 'Replacement successfully reverted to previous files.');
          window.location.reload();
        } else {
          alert('Undo Error: ' + (data.message || 'Failed to revert'));
        }
      } catch (err) {
        alert('Network error while undoing: ' + err.message);
      }
    }
  }

  // Ensure singleton instance
  function ensureInstance() {
    if (!window.bulkImageReplaceInstance) {
      window.bulkImageReplaceInstance = new BulkImageReplace();
    }
    return window.bulkImageReplaceInstance;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureInstance);
  } else {
    ensureInstance();
  }

  window.openBulkReplaceImagesModal = function () {
    try {
      const inst = ensureInstance();
      if (inst) {
        inst.openModal();
        return;
      }
    } catch (e) {
      console.error('[BulkReplace] Error opening modal via instance:', e);
    }

    const modal = document.getElementById('bulkReplaceImagesModal');
    if (modal) {
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }
  };

  window.closeBulkReplaceImagesModal = function () {
    try {
      const inst = ensureInstance();
      if (inst) {
        inst.closeModal();
        return;
      }
    } catch (e) {
      console.error('[BulkReplace] Error closing modal via instance:', e);
    }

    const modal = document.getElementById('bulkReplaceImagesModal');
    if (modal) {
      modal.style.display = 'none';
      document.body.style.overflow = '';
    }
  };
})();
