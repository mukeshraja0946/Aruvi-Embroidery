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
      this.categoryDesigns = [];
      this.selectedGroup = null;
      this.selectedTargetDesignId = null;
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
      this.selectedTargetDesignId = null;
      this.categoryDesigns = [];
      this.isUploading = false;
      this.lastLogId = null;

      // Reset target design notice
      const targetNotice = document.getElementById('targetDesignNotice');
      if (targetNotice) targetNotice.style.display = 'none';

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
          this.categoryDesigns = data.categoryDesigns || [];
          this.currentCategoryName = data.categoryName || this.currentCategoryName;

          if (groupSelect) {
            groupSelect.innerHTML = '';

            if (this.availableGroups.length === 0 && this.categoryDesigns.length === 0) {
              const opt = document.createElement('option');
              opt.value = '';
              opt.textContent = 'No designs found in this category';
              groupSelect.appendChild(opt);
              this.selectGroup(null);
              return;
            }

            let defaultVal = null;

            // 1. Pack designs / Single Design targeting optgroup
            if (this.categoryDesigns.length > 0) {
              const packGroup = document.createElement('optgroup');
              packGroup.label = '🎯 Pack / Individual Designs (Target All 10 Images + 10 ZIPs to 1 Design)';

              this.categoryDesigns.forEach(d => {
                const opt = document.createElement('option');
                opt.value = `design:${d.id}`;
                opt.textContent = `🎯 Design #${d.id} — ${d.title || d.sku} (SKU: ${d.sku})`;
                packGroup.appendChild(opt);

                // Priority: auto-select Design #637 or first pack design
                if (!defaultVal && (d.id === 637 || /AED-BUL-01/i.test(d.sku) || /Aruvi Bulk Designs 1/i.test(d.title))) {
                  defaultVal = `design:${d.id}`;
                }
              });

              groupSelect.appendChild(packGroup);
            }

            // 2. Folder Groups optgroup
            if (this.availableGroups.length > 0) {
              const folderGroup = document.createElement('optgroup');
              folderGroup.label = '📁 Folder Groups (Multi-design Import Groups)';

              this.availableGroups.forEach(g => {
                const opt = document.createElement('option');
                opt.value = `group:${g.groupName}`;
                opt.textContent = `📁 ${g.groupName} (${g.designCount} designs — ${g.existingImagesCount} images, ${g.existingZipsCount} ZIPs)`;
                folderGroup.appendChild(opt);

                if (!defaultVal) {
                  defaultVal = `group:${g.groupName}`;
                }
              });

              groupSelect.appendChild(folderGroup);
            }

            if (!defaultVal && this.categoryDesigns.length > 0) {
              defaultVal = `design:${this.categoryDesigns[0].id}`;
            }

            if (defaultVal) {
              groupSelect.value = defaultVal;
              this.selectGroup(defaultVal);
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

    selectGroup(val) {
      const nextBtn = document.getElementById('bulkReplaceScopeNextBtn');
      const nameEl = document.getElementById('groupDetailName');
      const designsEl = document.getElementById('groupDetailDesignsCount');
      const imagesEl = document.getElementById('groupDetailImagesCount');
      const zipsEl = document.getElementById('groupDetailZipsCount');
      const targetNotice = document.getElementById('targetDesignNotice');
      const targetNoticeText = document.getElementById('targetDesignNoticeText');

      if (!val) {
        this.selectedGroup = null;
        this.selectedTargetDesignId = null;
        if (targetNotice) targetNotice.style.display = 'none';
        if (nameEl) nameEl.textContent = '-';
        if (designsEl) designsEl.textContent = '0';
        if (imagesEl) imagesEl.textContent = '0';
        if (zipsEl) zipsEl.textContent = '0';
        if (nextBtn) nextBtn.disabled = true;
        return;
      }

      if (val.startsWith('design:')) {
        const dId = parseInt(val.replace('design:', ''), 10);
        const found = this.categoryDesigns.find(d => d.id === dId);
        if (found) {
          this.selectedTargetDesignId = dId;
          this.selectedGroup = {
            groupName: found.title || found.sku,
            designCount: 1,
            designs: [found],
            isSingleDesign: true,
            existingImagesCount: found.images_count || (found.preview_image_url ? 1 : 0),
            existingZipsCount: found.files_count || (found.import_zip_filename ? 1 : 0)
          };
          if (targetNotice && targetNoticeText) {
            targetNotice.style.display = 'block';
            targetNoticeText.textContent = `Design #${found.id} (${found.sku} — ${found.title}). All uploaded images & ZIPs will attach directly to this design!`;
          }
          if (nameEl) nameEl.textContent = `Design #${found.id} (${found.sku})`;
          if (designsEl) designsEl.textContent = '1';
          if (imagesEl) imagesEl.textContent = this.selectedGroup.existingImagesCount;
          if (zipsEl) zipsEl.textContent = this.selectedGroup.existingZipsCount;
          if (nextBtn) nextBtn.disabled = false;
          return;
        }
      }

      // Folder group selection
      this.selectedTargetDesignId = null;
      if (targetNotice) targetNotice.style.display = 'none';

      const cleanGroupName = val.startsWith('group:') ? val.replace('group:', '') : val;
      const foundGroup = this.availableGroups.find(g => g.groupName === cleanGroupName);
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
      const confTargetRow = document.getElementById('confTargetDesignRow');
      const confTargetText = document.getElementById('confTargetDesignText');

      if (this.selectedTargetDesignId && this.selectedGroup && this.selectedGroup.designs && this.selectedGroup.designs[0]) {
        const d = this.selectedGroup.designs[0];
        if (confTargetRow) confTargetRow.style.display = 'block';
        if (confTargetText) confTargetText.textContent = `Design #${d.id} (${d.sku} — ${d.title})`;
      } else {
        if (confTargetRow) confTargetRow.style.display = 'none';
      }

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
      const confirmBtn = document.getElementById('bulkReplaceConfirmBtn');
      const retryBtn = document.getElementById('bulkReplaceRetryPreviewBtn');

      this.previewLoaded = false;
      this.previewList = [];

      // Guard: Disable Replace Files button while preview is generating
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.style.opacity = '0.5';
        confirmBtn.style.cursor = 'not-allowed';
        confirmBtn.title = 'Preparing preview...';
      }
      if (retryBtn) retryBtn.style.display = 'none';

      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding: 24px; text-align: center; color: #0284C7;"><i class="fa-solid fa-spinner fa-spin"></i> Matching files against scoped designs and verifying schema...</td></tr>';
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
            targetDesignId: this.selectedTargetDesignId,
            mode: this.replacementMode || 'replace_matching'
          })
        });

        const data = await res.json();
        if (!data.success) {
          const customErr = new Error(data.message || 'Failed to generate preview');
          customErr.refId = data.refId || `REF_PREVIEW_${Date.now()}`;
          customErr.schemaError = Boolean(data.schemaError);
          customErr.data = data;
          throw customErr;
        }

        const previewList = data.previewList || [];
        if (matchedCountEl) matchedCountEl.textContent = previewList.length;

        const filesToRetireCountEl = document.getElementById('confFilesToRetireCount');
        const retirementNoteEl = document.getElementById('confRetirementNote');
        const filesToRetire = data.summary?.filesToRetireCount ?? 0;
        if (filesToRetireCountEl) filesToRetireCountEl.textContent = filesToRetire;
        if (retirementNoteEl) {
          retirementNoteEl.textContent = filesToRetire > 0 
            ? `${filesToRetire} existing file(s) will be retired to 7-day backup` 
            : 'No existing files will be retired';
        }

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
            this.previewLoaded = false;
            if (confirmBtn) {
              confirmBtn.disabled = true;
              confirmBtn.style.opacity = '0.5';
              confirmBtn.style.cursor = 'not-allowed';
              confirmBtn.title = 'Cannot replace: 0 designs matched the selected file names';
            }
            if (retryBtn) retryBtn.style.display = 'inline-flex';
            tbody.innerHTML = '<tr><td colspan="6" style="padding: 24px; text-align: center; color: #DC2626; background: #FEF2F2;"><i class="fa-solid fa-circle-exclamation"></i> <strong>0 matched designs.</strong> No designs matched the selected file names in this category. Files must match SKU or Title.</td></tr>';
            return;
          }

          // Successfully generated preview with >= 1 matched design
          this.previewLoaded = true;
          this.previewList = previewList;

          if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.style.opacity = '1';
            confirmBtn.style.cursor = 'pointer';
            confirmBtn.title = `Ready to replace files for ${previewList.length} design(s)`;
          }
          if (retryBtn) retryBtn.style.display = 'none';

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

            const retireText = item.retirementPreview || (item.willRetireCount > 0 ? `${item.willRetireCount} old file(s) to retire` : 'None');
            const retireCellHtml = item.willRetireCount > 0 
              ? `<span style="background: #FFF7ED; color: #C2410C; padding: 2px 8px; border-radius: 6px; font-size: 0.72rem; font-weight: 600; border: 1px solid #FFEDD5;"><i class="fa-solid fa-box-archive"></i> ${this.escapeHtml(retireText)}</span>`
              : `<span style="color: #94A3B8; font-size: 0.72rem;">None</span>`;

            tr.innerHTML = `
              <td style="padding: 8px 12px; text-align: center; color: #94A3B8;">${idx + 1}</td>
              <td style="padding: 8px 12px; font-weight: 600; color: #1E293B;">
                <div>${this.escapeHtml(item.title || item.sku)}</div>
                <div style="font-size: 0.74rem; color: #64748B; font-weight: 400;">SKU: <code>${this.escapeHtml(item.sku)}</code></div>
              </td>
              <td style="padding: 8px 12px;">${imgNames}</td>
              <td style="padding: 8px 12px;">${zipNames}</td>
              <td style="padding: 8px 12px; text-align: center;">${retireCellHtml}</td>
              <td style="padding: 8px 12px; text-align: center;">${statusBadge}</td>
            `;
            tbody.appendChild(tr);
          });
        }
      } catch (err) {
        console.error('loadStep3Preview error:', err);
        this.previewLoaded = false;
        this.previewList = [];

        if (confirmBtn) {
          confirmBtn.disabled = true;
          confirmBtn.style.opacity = '0.5';
          confirmBtn.style.cursor = 'not-allowed';
          confirmBtn.title = `Replace disabled: ${err.message || 'Preview generation failed'}`;
        }
        if (retryBtn) retryBtn.style.display = 'inline-flex';

        const refId = err.refId || `REF_ERR_${Date.now()}`;
        const errorPayload = {
          error: err.message,
          refId,
          schemaError: Boolean(err.schemaError),
          timestamp: new Date().toISOString(),
          category: this.currentCategoryName,
          selectedFilesCount: (this.selectedFiles || []).length
        };

        if (tbody) {
          tbody.innerHTML = `
            <tr>
              <td colspan="6" style="padding: 24px; text-align: center; background: #FEF2F2; border-radius: 8px;">
                <div style="font-size: 1.6rem; color: #DC2626; margin-bottom: 8px;">
                  <i class="fa-solid fa-triangle-exclamation"></i>
                </div>
                <div style="font-weight: 700; color: #991B1B; font-size: 0.95rem; margin-bottom: 6px;">
                  ${err.schemaError ? 'Database Update Needed' : 'Preview Generation Failed'}
                </div>
                <div style="color: #B91C1C; font-size: 0.85rem; max-width: 680px; margin: 0 auto 12px; line-height: 1.45; font-weight: 500;">
                  ${this.escapeHtml(err.message)}
                </div>
                <div style="display: inline-flex; align-items: center; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; justify-content: center;">
                  <span style="background: #FEE2E2; color: #991B1B; border: 1px solid #FECACA; padding: 3px 10px; border-radius: 6px; font-size: 0.74rem; font-family: monospace;">
                    Ref: ${this.escapeHtml(refId)}
                  </span>
                  <button type="button" class="btn btn-sm btn-outline" style="font-size: 0.75rem; padding: 4px 10px; border-radius: 6px; background: #FFF; color: #991B1B; border-color: #FCA5A5; cursor: pointer;" onclick="window.bulkImageReplaceInstance.copyErrorDetails(this)">
                    <i class="fa-solid fa-copy"></i> Copy details
                  </button>
                </div>
                <div>
                  <button type="button" class="btn btn-sm btn-primary" style="font-size: 0.85rem; padding: 6px 18px; border-radius: 6px; background: #0284C7; border-color: #0284C7; color: #FFF; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;" onclick="window.bulkImageReplaceInstance.loadStep3Preview()">
                    <i class="fa-solid fa-rotate-right"></i> Retry Preview
                  </button>
                </div>
              </td>
            </tr>
          `;
          this.lastErrorPayload = errorPayload;
        }
      }
    }

    copyErrorDetails(btn) {
      const payload = this.lastErrorPayload || { error: 'Unknown preview error', timestamp: new Date().toISOString() };
      const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          if (btn) {
            const original = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
            setTimeout(() => { btn.innerHTML = original; }, 2000);
          }
        });
      } else {
        prompt('Copy Error Details:', text);
      }
    }

    // ==============================================================
    // STEP 4: APPLY REPLACEMENT & REPORT
    // ==============================================================
    async executeReplace() {
      // Guard: Never allow apply if preview did not load or has 0 matched designs
      if (!this.previewLoaded || !this.previewList || this.previewList.length === 0) {
        alert('Cannot apply replacement: The preview did not load successfully or shows 0 matched designs.');
        return;
      }

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

      // 1. PRE-FLIGHT CHECK
      if (progressStatus) progressStatus.textContent = 'Running pre-flight storage & environment checks...';
      try {
        const pfUrl = `/admin/designs/bulk-replace/preflight?categoryId=${encodeURIComponent(this.currentCategoryId || 'all')}&targetDesignId=${encodeURIComponent(this.selectedTargetDesignId || '')}&fileCount=${this.selectedFiles.length}`;
        const pfRes = await fetch(pfUrl);
        const pfData = await pfRes.json();
        if (!pfData.ok) {
          this.isUploading = false;
          if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> Replace Files Now';
          }
          if (progressStatus) progressStatus.textContent = `Pre-Flight Blocked: ${pfData.message}`;
          alert(`PRE-FLIGHT CHECK BLOCKED [${pfData.code}]:\n\n${pfData.message}\n\nFIX: ${pfData.fix || 'Check environment configuration'}`);
          this.currentStep = 3;
          this.updateStepView();
          return;
        }
      } catch (pfErr) {
        console.warn('Pre-flight fetch error:', pfErr);
      }

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
            targetDesignId: this.selectedTargetDesignId,
            scopeSummary: this.selectedTargetDesignId
              ? `Replaced all files for Design #${this.selectedTargetDesignId}`
              : (groupNameToPass 
                  ? `Replaced all files in group "${groupNameToPass}"`
                  : `Replaced files across category "${this.currentCategoryName}"`),
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
        const removedOldCount = commitData.removedOldFilesCount ?? 0;
        const failedCount = commitData.failedCount ?? 0;
        const replacedImgs = commitData.replacedImagesCount ?? 0;
        const replacedZips = commitData.replacedZipsCount ?? 0;
        const restoredCount = commitData.restoredCount ?? 0;
        const unchangedCount = commitData.unchangedCount ?? 0;
        const skippedCount = commitData.skippedCount ?? 0;
        const succeededCount = (replacedImgs + replacedZips + restoredCount);

        if (reportSummaryEl) {
          if (commitData.message) {
            reportSummaryEl.textContent = commitData.message;
          } else if (removedOldCount === 0) {
            reportSummaryEl.textContent = `File replacement finished. ${succeededCount} file(s) active. Old files remain untouched.`;
          } else {
            reportSummaryEl.textContent = `File replacement finished. ${succeededCount} file(s) active. ${removedOldCount} old file(s) safely retired to 7-day rollback backup.`;
          }
        }

        // Stats Cards (6 Cards)
        const replacedImgEl = document.getElementById('reportCountReplacedImages');
        const replacedZipEl = document.getElementById('reportCountReplacedZips');
        const restoredEl = document.getElementById('reportCountRestored');
        const unchangedEl = document.getElementById('reportCountUnchanged');
        const skippedEl = document.getElementById('reportCountSkipped');
        const failedEl = document.getElementById('reportCountFailed');
        const removedOldEl = document.getElementById('reportCountRemovedOld');

        if (replacedImgEl) replacedImgEl.textContent = replacedImgs;
        if (replacedZipEl) replacedZipEl.textContent = replacedZips;
        if (restoredEl) restoredEl.textContent = restoredCount;
        if (unchangedEl) unchangedEl.textContent = unchangedCount;
        if (skippedEl) skippedEl.textContent = skippedCount;
        if (failedEl) failedEl.textContent = failedCount;
        if (removedOldEl) removedOldEl.textContent = removedOldCount;

        // Invariant Equation: selected = replaced + restored + unchanged + skipped + failed
        const selectedTotal = commitData.totalSelectedFiles || (commitData.fileLogs ? commitData.fileLogs.length : this.selectedFiles.length);
        const eqSel = document.getElementById('reportEquationSelected');
        const eqDone = document.getElementById('reportEquationDone');
        const eqRest = document.getElementById('reportEquationRestored');
        const eqUnch = document.getElementById('reportEquationUnchanged');
        const eqSkip = document.getElementById('reportEquationSkipped');
        const eqFail = document.getElementById('reportEquationFailed');

        if (eqSel) eqSel.textContent = selectedTotal;
        if (eqDone) eqDone.textContent = replacedImgs + replacedZips;
        if (eqRest) eqRest.textContent = restoredCount;
        if (eqUnch) eqUnch.textContent = unchangedCount;
        if (eqSkip) eqSkip.textContent = skippedCount;
        if (eqFail) eqFail.textContent = failedCount;

        // Separate Sub-Counters: Images vs ZIPs
        const subImgSel = document.getElementById('reportSubImagesSelected');
        const subImgDone = document.getElementById('reportSubImagesDone');
        const subImgRest = document.getElementById('reportSubImagesRestored');
        const subImgUnch = document.getElementById('reportSubImagesUnchanged');
        const subImgFail = document.getElementById('reportSubImagesFailed');

        if (subImgSel) subImgSel.textContent = commitData.selectedImagesCount ?? this.selectedFiles.filter(f => !f.name.toLowerCase().endsWith('.zip')).length;
        if (subImgDone) subImgDone.textContent = replacedImgs;
        if (subImgRest) subImgRest.textContent = commitData.restoredImagesCount ?? 0;
        if (subImgUnch) subImgUnch.textContent = commitData.unchangedImagesCount ?? 0;
        if (subImgFail) subImgFail.textContent = commitData.failedImagesCount ?? 0;

        const subZipSel = document.getElementById('reportSubZipsSelected');
        const subZipDone = document.getElementById('reportSubZipsDone');
        const subZipRest = document.getElementById('reportSubZipsRestored');
        const subZipUnch = document.getElementById('reportSubZipsUnchanged');
        const subZipFail = document.getElementById('reportSubZipsFailed');

        if (subZipSel) subZipSel.textContent = commitData.selectedZipsCount ?? this.selectedFiles.filter(f => f.name.toLowerCase().endsWith('.zip')).length;
        if (subZipDone) subZipDone.textContent = replacedZips;
        if (subZipRest) subZipRest.textContent = commitData.restoredZipsCount ?? 0;
        if (subZipUnch) subZipUnch.textContent = commitData.unchangedZipsCount ?? 0;
        if (subZipFail) subZipFail.textContent = commitData.failedZipsCount ?? 0;

        // Honest Header Badge
        const headerBadge = document.getElementById('bulkReplaceHeaderBadge');
        if (headerBadge) {
          if (failedCount > 0) {
            headerBadge.style.background = '#FFEBEE';
            headerBadge.style.color = '#C62828';
            headerBadge.style.borderColor = '#FFCDD2';
            headerBadge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Completed: ${succeededCount} succeeded, ${failedCount} failed`;
          } else {
            headerBadge.style.background = '#E8F5E9';
            headerBadge.style.color = '#2E7D32';
            headerBadge.style.borderColor = '#C8E6C9';
            headerBadge.innerHTML = `<i class="fa-solid fa-circle-check"></i> Completed: ${succeededCount} succeeded, 0 failed`;
          }
        }

        const reportIcon = document.getElementById('reportSuccessIcon');
        if (reportIcon) {
          if (failedCount > 0) {
            reportIcon.style.background = '#FFF3E0';
            reportIcon.style.color = '#E65100';
            reportIcon.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
          } else {
            reportIcon.style.background = '#E8F5E9';
            reportIcon.style.color = '#2E7D32';
            reportIcon.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
          }
        }

        const reportTitle = document.getElementById('reportTitleText');
        if (reportTitle) {
          reportTitle.textContent = failedCount > 0 
            ? `File Replacement Finished (${succeededCount} Succeeded, ${failedCount} Failed)`
            : 'File Replacement Completed!';
        }

        // Populate Per-File Operation Log Table
        const fileLogs = commitData.fileLogs || [];
        this.lastFileLogs = fileLogs;
        const countEl = document.getElementById('bulkReplaceFileLogCount');
        const tbodyEl = document.getElementById('bulkReplaceFileLogTbody');
        if (countEl) countEl.textContent = fileLogs.length;

        if (tbodyEl) {
          tbodyEl.innerHTML = '';
          fileLogs.forEach((f, idx) => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid #F1F5F9';
            const isZip = (f.fileType || '').toLowerCase().includes('zip');
            const resState = (f.result || '').toLowerCase();
            const dbState = (f.dbStatus || '').toLowerCase();

            const typeIcon = isZip 
              ? '<i class="fa-solid fa-file-zipper" style="color: #0891B2;"></i>' 
              : '<i class="fa-solid fa-file-image" style="color: #0284C7;"></i>';

            const typeBadge = isZip 
              ? '<span style="background: #E0F7FA; color: #00796B; font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; font-weight: 600;">ZIP</span>'
              : '<span style="background: #E0F2FE; color: #0369A1; font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; font-weight: 600;">Image</span>';

            const sizeText = this.formatFileSize(f.fileSize);

            // Storage badge
            let storageBadge = f.storageStatus === 'Stored'
              ? '<span style="color: #16A34A; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-circle-check"></i> Stored</span>'
              : (resState === 'skipped' || dbState === 'skipped')
                ? '<span style="color: #64748B; font-weight: 500;">—</span>'
                : `<span style="color: #DC2626; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;" title="${this.escapeHtml(f.error || '')}"><i class="fa-solid fa-circle-xmark"></i> ${this.escapeHtml(f.storageStatus || 'Failed')}</span>`;

            // Database badge & Status Details (Neutral/Blue for Unchanged & Restored)
            let dbBadge = '';
            let statusDetailsHtml = '';
            let actionBtnHtml = '<span style="color: #94A3B8; font-size: 0.75rem;">—</span>';

            if (resState === 'unchanged' || dbState === 'unchanged') {
              dbBadge = '<span style="color: #475569; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-equals"></i> Unchanged</span>';
              statusDetailsHtml = '<span style="background: #F1F5F9; color: #475569; font-size: 0.74rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; border: 1px solid #CBD5E1; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-equals"></i> Identical (Kept)</span>';
            } else if (resState === 'restored' || dbState === 'restored') {
              dbBadge = '<span style="color: #1D4ED8; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-rotate-left"></i> Restored</span>';
              statusDetailsHtml = '<span style="background: #EFF6FF; color: #1D4ED8; font-size: 0.74rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; border: 1px solid #BFDBFE; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-rotate-left"></i> Restored</span>';
            } else if (resState === 'skipped' || dbState === 'skipped') {
              dbBadge = '<span style="color: #D97706; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-forward-step"></i> Skipped</span>';
              statusDetailsHtml = `<span style="background: #FFFBEB; color: #D97706; font-size: 0.74rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; border: 1px solid #FDE68A; display: inline-flex; align-items: center; gap: 4px;" title="${this.escapeHtml(f.error || '')}"><i class="fa-solid fa-forward-step"></i> ${this.escapeHtml(f.error || 'Duplicate in selection (skipped)')}</span>`;
            } else if (resState === 'not_processed') {
              dbBadge = '<span style="color: #64748B; font-weight: 500;">Not processed</span>';
              statusDetailsHtml = `<span style="background: #F1F5F9; color: #64748B; font-size: 0.74rem; font-weight: 600; padding: 2px 8px; border-radius: 999px; border: 1px solid #E2E8F0;">${this.escapeHtml(f.error || 'Job halted before this file')}</span>`;
            } else if (resState === 'failed' || dbState === 'failed') {
              dbBadge = `<span style="color: #DC2626; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-xmark"></i> Failed</span>`;
              const code = f.errorCode || 'FAILED';
              const stage = f.stage || 'storage_write';
              const errMsg = f.errorMessage || f.error || 'Operation failed';
              const ref = f.refId || '-';
              statusDetailsHtml = `
                <div style="display: flex; flex-direction: column; gap: 2px;">
                  <div style="display: flex; align-items: center; gap: 5px;">
                    <span style="background: #FEE2E2; color: #991B1B; font-size: 0.68rem; font-weight: 800; padding: 1px 6px; border-radius: 4px; border: 1px solid #FECACA;">${this.escapeHtml(code)}</span>
                    <span style="font-size: 0.72rem; color: #64748B; font-weight: 600;">Stage: ${this.escapeHtml(stage)}</span>
                  </div>
                  <div style="font-size: 0.72rem; color: #DC2626; font-weight: 500; word-break: break-word; line-height: 1.3;">${this.escapeHtml(errMsg)}</div>
                  <div style="font-size: 0.68rem; color: #94A3B8; font-family: monospace;">Ref: ${this.escapeHtml(ref)}</div>
                </div>
              `;
              actionBtnHtml = `
                <button type="button" onclick="window.bulkImageReplaceInstance.copyErrorDetails('${this.escapeHtml(ref)}')" class="btn btn-sm" style="font-size: 0.72rem; padding: 3px 8px; border-radius: 6px; background: #F8FAFC; border: 1px solid #CBD5E1; color: #334155; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-weight: 600;" title="Copy full error details to clipboard">
                  <i class="fa-regular fa-copy"></i> Copy details
                </button>
              `;
            } else {
              // Verified / Updated
              dbBadge = '<span style="color: #16A34A; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-check"></i> Updated</span>';
              statusDetailsHtml = '<span style="background: #DCFCE7; color: #166534; font-size: 0.74rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; border: 1px solid #BBF7D0; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-check"></i> Replaced</span>';
            }

            tr.innerHTML = `
              <td style="padding: 10px 14px; text-align: center; color: #94A3B8; font-weight: 500;">${idx + 1}</td>
              <td style="padding: 10px 14px; font-weight: 600; color: #1E293B; word-break: break-all;">
                <span style="margin-right: 6px;">${typeIcon}</span>${this.escapeHtml(f.fileName)}
              </td>
              <td style="padding: 10px 14px;">${typeBadge}</td>
              <td style="padding: 10px 14px; color: #64748B;">${sizeText}</td>
              <td style="padding: 10px 14px; font-weight: 600; color: #1E293B;">
                <code>${this.escapeHtml(f.targetSku || f.sku || '-')}</code> ${f.targetDesignId ? `<span style="font-size: 0.72rem; color: #64748B;">(#${f.targetDesignId})</span>` : ''}
              </td>
              <td style="padding: 10px 14px;">${storageBadge}</td>
              <td style="padding: 10px 14px;">${dbBadge}</td>
              <td style="padding: 10px 14px;">${statusDetailsHtml}</td>
              <td style="padding: 10px 14px; text-align: center;">${actionBtnHtml}</td>
            `;
            tbodyEl.appendChild(tr);
          });
        }

        // Populate Retired Files Table
        const retiredList = commitData.retiredOldFilesList || commitData.retiredFiles || [];
        this.lastRetiredFiles = retiredList;
        const retiredTbody = document.getElementById('bulkReplaceRetiredFilesTbody');
        if (retiredTbody) {
          if (retiredList.length === 0) {
            retiredTbody.innerHTML = '<tr><td colspan="4" style="padding: 10px; text-align: center; color: #94A3B8;">No existing files needed retirement.</td></tr>';
          } else {
            retiredTbody.innerHTML = '';
            retiredList.forEach(r => {
              const rtr = document.createElement('tr');
              rtr.style.borderBottom = '1px solid #FED7AA';
              rtr.innerHTML = `
                <td style="padding: 6px 10px; font-weight: 600;"><code>${this.escapeHtml(r.sku || ('Design #' + r.designId))}</code></td>
                <td style="padding: 6px 10px;"><span style="background: #FFEDD5; color: #9A3412; font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; font-weight: 600;">${this.escapeHtml(r.type || 'File')}</span></td>
                <td style="padding: 6px 10px; font-family: monospace; font-size: 0.72rem; word-break: break-all;">${this.escapeHtml(r.fileName || r.path || '-')}</td>
                <td style="padding: 6px 10px; color: #64748B;">${this.escapeHtml(r.reason || 'Superseded by replacement')}</td>
              `;
              retiredTbody.appendChild(rtr);
            });
          }
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

    toggleRetiredFiles() {
      const el = document.getElementById('bulkReplaceRetiredFilesContainer');
      if (el) {
        el.style.display = (el.style.display === 'none' || !el.style.display) ? 'block' : 'none';
      }
    }

    copyErrorDetails(refId) {
      const item = (this.lastFileLogs || []).find(l => l.refId === refId) || { refId, error: 'Details not found' };
      const text = JSON.stringify(item, null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          alert(`Error details (${refId}) copied to clipboard!`);
        }).catch(() => {
          prompt('Copy error details:', text);
        });
      } else {
        prompt('Copy error details:', text);
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

    async promptRepair() {
      const defaultId = this.selectedTargetDesignId || 637;
      const input = prompt('Enter the Target Design ID to attach all files from the previous bulk replacement run:\n\n(Default: Design #637 = Aruvi Bulk Designs 1 / AED-BUL-01)', defaultId);
      if (!input) return;
      const targetDesignId = parseInt(input.trim(), 10);
      if (isNaN(targetDesignId) || targetDesignId <= 0) {
        alert('Please enter a valid numeric Design ID (e.g. 637).');
        return;
      }

      try {
        // 1. Dry run preview
        const previewRes = await fetch('/admin/designs/bulk-replace/repair-last', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'CSRF-Token': this.getCSRF()
          },
          body: JSON.stringify({
            _csrf: this.getCSRF(),
            targetDesignId,
            dryRun: true
          })
        });

        const previewData = await previewRes.json();
        if (!previewData.success) {
          alert('Repair Preview Error: ' + (previewData.message || 'Failed'));
          return;
        }

        const confirmMsg = `${previewData.message}\n\n` +
          `• Images to attach: ${previewData.imagesCount} (First image will become Primary Image)\n` +
          `• ZIPs to attach: ${previewData.zipsCount} (Machine files in Download Files table)\n\n` +
          `Proceed with attaching and verifying all files for Design #${targetDesignId}?`;

        if (!confirm(confirmMsg)) return;

        // 2. Commit repair
        const commitRes = await fetch('/admin/designs/bulk-replace/repair-last', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'CSRF-Token': this.getCSRF()
          },
          body: JSON.stringify({
            _csrf: this.getCSRF(),
            targetDesignId,
            dryRun: false
          })
        });

        const commitData = await commitRes.json();
        if (commitData.success) {
          alert(commitData.message || 'Repair successfully executed! Design files and thumbnails are now active and verified.');
          window.location.reload();
        } else {
          alert('Repair Failed: ' + (commitData.message || 'Unknown error'));
        }
      } catch (err) {
        alert('Network error during repair: ' + err.message);
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
