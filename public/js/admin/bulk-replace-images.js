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
      this.replacementMode = 'replace_matching';

      this.initEvents();
    }

    setMode(mode) {
      this.replacementMode = mode;
    }

    clearSelectedFiles() {
      this.selectedFiles = [];
      const filesInput = document.getElementById('bulkReplaceFileInput');
      if (filesInput) filesInput.value = '';
      const summaryBadge = document.getElementById('selectedFilesSummaryBadge');
      if (summaryBadge) summaryBadge.style.display = 'none';
      const nextBtn = document.getElementById('bulkReplaceFilesNextBtn');
      if (nextBtn) nextBtn.disabled = true;
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
        if (stepFooter) stepFooter.style.display = (s === this.currentStep && s !== 4) ? 'flex' : 'none';
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
    // STEP 2: SELECT NEW FILES (ACCUMULATES FILES DIRECTLY)
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

      // Deduplicate and accumulate into this.selectedFiles
      const existingMap = new Map();
      this.selectedFiles.forEach(f => existingMap.set(`${f.name}_${f.size}`, f));
      validFiles.forEach(f => existingMap.set(`${f.name}_${f.size}`, f));
      this.selectedFiles = Array.from(existingMap.values());

      const imgCount = this.selectedFiles.filter(f => !f.name.toLowerCase().endsWith('.zip')).length;
      const zipCount = this.selectedFiles.filter(f => f.name.toLowerCase().endsWith('.zip')).length;

      const summaryBadge = document.getElementById('selectedFilesSummaryBadge');
      const imgEl = document.getElementById('selectedNewImagesCount');
      const zipEl = document.getElementById('selectedNewZipsCount');
      const totalEl = document.getElementById('selectedNewTotalCount');

      if (summaryBadge && imgEl && zipEl && totalEl) {
        summaryBadge.style.display = 'flex';
        imgEl.textContent = imgCount;
        zipEl.textContent = zipCount;
        totalEl.textContent = this.selectedFiles.length;
      }

      const nextBtn = document.getElementById('bulkReplaceFilesNextBtn');
      if (nextBtn) {
        nextBtn.disabled = this.selectedFiles.length === 0;
      }
    }

    // ==============================================================
    // STEP 3: CONFIRMATION SUMMARY & MATCH PREVIEW
    // ==============================================================
    async proceedToStep3() {
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
      if (confGroupName) confGroupName.textContent = this.selectedGroup ? this.selectedGroup.groupName : 'All Designs in Category';
      if (confOldImagesCount) confOldImagesCount.textContent = this.selectedGroup ? this.selectedGroup.existingImagesCount : 0;
      if (confOldZipsCount) confOldZipsCount.textContent = this.selectedGroup ? this.selectedGroup.existingZipsCount : 0;
      if (confNewImagesCount) confNewImagesCount.textContent = newImgCount;
      if (confNewZipsCount) confNewZipsCount.textContent = newZipCount;

      this.currentStep = 3;
      this.updateStepView();

      await this.loadStep3Preview();
    }

    async loadStep3Preview() {
      const tbody = document.getElementById('confPreviewTableBody');
      const matchedCountEl = document.getElementById('confMatchedDesignsCount');
      const unmatchedBadge = document.getElementById('confUnmatchedFilesBadge');
      const unmatchedCountEl = document.getElementById('confUnmatchedCount');

      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="5" style="padding: 20px; text-align: center; color: #0284C7;"><i class="fa-solid fa-spinner fa-spin"></i> Matching files against scoped designs...</td></tr>';
      }

      try {
        const filePayload = this.selectedFiles.map(f => ({ name: f.name, size: f.size }));
        const categoryIds = (this.currentCategoryId && this.currentCategoryId !== 'all') ? [this.currentCategoryId] : [];
        const checkedIds = (this.selectedGroup && !this.selectedGroup.isAllCategory && Array.isArray(this.selectedGroup.designs)) 
          ? this.selectedGroup.designs.map(d => d.id) 
          : [];

        const res = await fetch('/admin/designs/bulk-replace/preview-match', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'CSRF-Token': this.getCSRF()
          },
          body: JSON.stringify({
            _csrf: this.getCSRF(),
            files: filePayload,
            categoryIds,
            checkedIds,
            mode: this.replacementMode || 'replace_matching'
          })
        });

        const data = await res.json();
        if (!data.success) {
          throw new Error(data.message || 'Failed to generate preview');
        }

        const previewList = data.previewList || [];
        if (matchedCountEl) matchedCountEl.textContent = previewList.length;

        const unmatchedFiles = data.unmatchedFiles || [];
        if (unmatchedBadge && unmatchedCountEl) {
          if (unmatchedFiles.length > 0) {
            unmatchedBadge.style.display = 'inline-flex';
            unmatchedCountEl.textContent = unmatchedFiles.length;
          } else {
            unmatchedBadge.style.display = 'none';
          }
        }

        if (tbody) {
          tbody.innerHTML = '';
          if (previewList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="padding: 20px; text-align: center; color: #DC2626;"><i class="fa-solid fa-circle-exclamation"></i> No designs matched the selected file names in this category. Files must match SKU or Title.</td></tr>';
            return;
          }

          previewList.forEach((item, idx) => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid #F1F5F9';

            const imgNames = (item.images || []).map(img => `<span style="display: inline-block; background: #E0F2FE; color: #0369A1; padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; margin: 2px;">${this.escapeHtml(img.fileName || img.originalName)}</span>`).join(' ') || '<span style="color: #94A3B8; font-size: 0.75rem;">(None)</span>';

            const zipNames = (item.downloadFiles || []).map(z => `<span style="display: inline-block; background: #E0F7FA; color: #00796B; padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; margin: 2px;">${this.escapeHtml(z.fileName || z.originalName)}</span>`).join(' ') || '<span style="color: #94A3B8; font-size: 0.75rem;">(None)</span>';

            let statusBadge = '<span style="background: #E2E8F0; color: #475569; padding: 2px 8px; border-radius: 999px; font-size: 0.72rem; font-weight: 600;">Matched</span>';
            if (item.zipStatus && item.zipStatus.includes('none currently uploaded')) {
              statusBadge = '<span style="background: #FEF3C7; color: #92400E; padding: 2px 8px; border-radius: 999px; font-size: 0.72rem; font-weight: 700; border: 1px solid #FDE68A;"><i class="fa-solid fa-plus"></i> ZIP will be ADDED</span>';
            } else if (item.status && item.status.includes('replace Image & ZIP')) {
              statusBadge = '<span style="background: #DCFCE7; color: #166534; padding: 2px 8px; border-radius: 999px; font-size: 0.72rem; font-weight: 700; border: 1px solid #BBF7D0;"><i class="fa-solid fa-check"></i> Image & ZIP Replaced</span>';
            } else if (item.hasNewZip) {
              statusBadge = '<span style="background: #DCFCE7; color: #166534; padding: 2px 8px; border-radius: 999px; font-size: 0.72rem; font-weight: 700; border: 1px solid #BBF7D0;"><i class="fa-solid fa-file-zipper"></i> ZIP Replaced</span>';
            } else if (item.hasNewImage) {
              statusBadge = '<span style="background: #E0F2FE; color: #0369A1; padding: 2px 8px; border-radius: 999px; font-size: 0.72rem; font-weight: 700; border: 1px solid #BAE6FD;"><i class="fa-solid fa-image"></i> Image Replaced</span>';
            }

            tr.innerHTML = `
              <td style="padding: 8px 12px; text-align: center; color: #94A3B8;">${idx + 1}</td>
              <td style="padding: 8px 12px; font-weight: 600; color: #1E293B;">
                <div>${this.escapeHtml(item.title || item.sku)}</div>
                <div style="font-size: 0.74rem; color: #64748B; font-weight: 400;">SKU: <code>${this.escapeHtml(item.sku)}</code></div>
              </td>
              <td style="padding: 8px 12px;">${imgNames}</td>
              <td style="padding: 8px 12px;">${zipNames}</td>
              <td style="padding: 8px 12px; text-align: center;">${statusBadge}</td>
            `;
            tbody.appendChild(tr);
          });
        }
      } catch (err) {
        console.error('loadStep3Preview error:', err);
        if (tbody) {
          tbody.innerHTML = `<tr><td colspan="5" style="padding: 16px; text-align: center; color: #DC2626;">Error preparing preview: ${this.escapeHtml(err.message)}</td></tr>`;
        }
      }
    }

    // ==============================================================
    // STEP 4: APPLY REPLACEMENT & REPORT
    // ==============================================================
    async executeReplace() {
      if (this.isUploading) return;
      if (!this.selectedGroup) {
        alert('Missing target group or category to replace.');
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

      let uploadedProcessedItems = [];

      try {
        const uploader = new ChunkUploader({
          uploadType: 'bulk-replace',
          onProgress: (p) => {
            const percent = p.percent ? Math.round(p.percent * 0.85) : 0;
            if (progressBar) progressBar.style.width = `${percent}%`;
            if (progressPercent) progressPercent.textContent = `${percent}%`;
            if (progressStatus) progressStatus.textContent = `Uploading file ${p.processed} of ${p.total} (${percent}%)...`;
          },
          onItemStatusChange: (item) => {
            if (item.status === 'assembling') {
              if (progressStatus) progressStatus.textContent = `Validating & storing ${item.name}...`;
            }
          }
        });

        this.uploader = uploader;
        uploader.setFiles(this.selectedFiles, true);

        await uploader.start();

        // Collect processed files from completed items
        uploader.items.forEach(it => {
          if (it.processedFile) {
            uploadedProcessedItems.push(it.processedFile);
          }
        });

        if (uploader.items.some(it => it.status === 'failed')) {
          const failedCount = uploader.items.filter(it => it.status === 'failed').length;
          console.warn(`[BulkReplace] ${failedCount} files failed upload.`);
        }

        // Commit replacement in database
        if (progressStatus) progressStatus.textContent = 'Updating database records and attaching files to designs...';
        if (progressBar) progressBar.style.width = '92%';
        if (progressPercent) progressPercent.textContent = '92%';

        const isGroupReplacement = this.selectedGroup && !this.selectedGroup.isAllCategory && this.selectedGroup.groupName !== 'All Designs in Category';
        const groupNameToPass = isGroupReplacement ? this.selectedGroup.groupName : null;

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
            groupName: groupNameToPass,
            scopeSummary: groupNameToPass 
              ? `Replaced all files in group "${groupNameToPass}"`
              : `Replaced files across category "${this.currentCategoryName}"`,
            replacementMode: this.replacementMode || 'replace_matching',
            items: uploadedProcessedItems
          }),
          signal: this.abortController.signal
        });

        const commitData = await commitRes.json();
        if (!commitData.success && (!commitData.fileLogs || commitData.fileLogs.length === 0)) {
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
          reportSummaryEl.textContent = commitData.message || `File replacement finished successfully. Newly selected files are active.`;
        }

        const replacedImgEl = document.getElementById('reportCountReplacedImages');
        const replacedZipEl = document.getElementById('reportCountReplacedZips');
        const unchangedEl = document.getElementById('reportCountUnchanged');
        const removedOldEl = document.getElementById('reportCountRemovedOld');
        const failedEl = document.getElementById('reportCountFailed');

        if (replacedImgEl) replacedImgEl.textContent = commitData.replacedImagesCount ?? 0;
        if (replacedZipEl) replacedZipEl.textContent = (commitData.replacedZipsCount ?? 0) + (commitData.addedCount ?? 0);
        if (unchangedEl) unchangedEl.textContent = commitData.unchangedCount ?? 0;
        if (removedOldEl) removedOldEl.textContent = commitData.removedOldFilesCount ?? 0;
        if (failedEl) failedEl.textContent = commitData.failedCount ?? 0;

        // Populate Per-File Operation Log Table
        const fileLogs = commitData.fileLogs || [];
        const countEl = document.getElementById('bulkReplaceFileLogCount');
        const tbodyEl = document.getElementById('bulkReplaceFileLogTbody');
        if (countEl) countEl.textContent = fileLogs.length;

        if (tbodyEl) {
          tbodyEl.innerHTML = '';
          fileLogs.forEach((f, idx) => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid #F1F5F9';
            const isZip = (f.fileType || '').toLowerCase().includes('zip');
            const isVerified = f.result === 'Verified';

            const typeIcon = isZip 
              ? '<i class="fa-solid fa-file-zipper" style="color: #0891B2;"></i>' 
              : '<i class="fa-solid fa-file-image" style="color: #0284C7;"></i>';

            const typeBadge = isZip 
              ? '<span style="background: #E0F7FA; color: #00796B; font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; font-weight: 600;">ZIP</span>'
              : '<span style="background: #E0F2FE; color: #0369A1; font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; font-weight: 600;">Image</span>';

            const sizeText = this.formatFileSize(f.fileSize);

            const storageBadge = f.storageStatus === 'Stored'
              ? '<span style="color: #16A34A; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-circle-check"></i> Stored</span>'
              : `<span style="color: #DC2626; font-weight: 600;" title="${this.escapeHtml(f.error || '')}"><i class="fa-solid fa-circle-xmark"></i> Failed</span>`;

            let dbBadge = '<span style="color: #16A34A; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-check"></i> Updated</span>';
            if (f.dbStatus === 'Unchanged') {
              dbBadge = '<span style="color: #475569; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-equals"></i> Unchanged</span>';
            } else if (f.dbStatus === 'Failed') {
              dbBadge = '<span style="color: #DC2626; font-weight: 600;"><i class="fa-solid fa-xmark"></i> Failed</span>';
            }

            const resultBadge = isVerified
              ? '<span style="background: #DCFCE7; color: #166534; font-size: 0.75rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; border: 1px solid #BBF7D0; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-check"></i> Verified</span>'
              : `<span style="background: #FEE2E2; color: #991B1B; font-size: 0.75rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; border: 1px solid #FECACA; display: inline-flex; align-items: center; gap: 4px;" title="${this.escapeHtml(f.error || 'Failed')}"><i class="fa-solid fa-triangle-exclamation"></i> Failed</span>`;

            tr.innerHTML = `
              <td style="padding: 10px 14px; text-align: center; color: #94A3B8; font-weight: 500;">${idx + 1}</td>
              <td style="padding: 10px 14px; font-weight: 600; color: #1E293B; word-break: break-all;">
                <span style="margin-right: 6px;">${typeIcon}</span>${this.escapeHtml(f.fileName)}
              </td>
              <td style="padding: 10px 14px;">${typeBadge}</td>
              <td style="padding: 10px 14px; color: #64748B;">${sizeText}</td>
              <td style="padding: 10px 14px;">${storageBadge}</td>
              <td style="padding: 10px 14px;">${dbBadge}</td>
              <td style="padding: 10px 14px; text-align: center;">${resultBadge}</td>
            `;
            tbodyEl.appendChild(tr);
          });
        }

        // Retry button if there are failures
        const retryBtn = document.getElementById('bulkReplaceRetryFailedBtn');
        if (retryBtn) {
          if (commitData.failedCount > 0) {
            retryBtn.style.display = 'inline-flex';
            this.failedFiles = this.selectedFiles.filter(orig => 
              fileLogs.some(l => l.fileName === orig.name && l.result === 'Failed')
            );
          } else {
            retryBtn.style.display = 'none';
            this.failedFiles = [];
          }
        }

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

    retryFailed() {
      if (!this.failedFiles || this.failedFiles.length === 0) {
        alert('No failed files to retry.');
        return;
      }
      this.selectedFiles = [...this.failedFiles];
      this.executeReplace();
    }

    formatFileSize(bytes) {
      const b = parseInt(bytes, 10) || 0;
      if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
      if (b >= 1024) return Math.round(b / 1024) + ' KB';
      return b + ' B';
    }

    escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    cancelUpload() {
      if (this.uploader) {
        this.uploader.abort();
      }
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
