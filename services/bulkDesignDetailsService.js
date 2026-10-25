const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');

const db = require('../config/db');
const Design = require('../models/Design');
const Category = require('../models/Category');
const ActivityLog = require('../models/ActivityLog');

class BulkDesignDetailsService {
  /**
   * Generates a clean Excel template with 'Design Details' sheet + 'Instructions' guide.
   */
  generateTemplateWorkbook() {
    const exampleRows = [
      {
        'Design Code / SKU': 'AED-BLO-01',
        'Design Name': 'Rose Bloom Design',
        'Category': 'Blouse Designs',
        'Front Stitch Count': 12500,
        'Back Stitch Count': 8200,
        'Sleeve Stitch Count': 4500,
        'Description': 'Floral embroidery design with matching front, back, and sleeve patterns.'
      },
      {
        'Design Code / SKU': 'AED-BOR-02',
        'Design Name': 'Peacock Border Motif',
        'Category': 'Border Designs',
        'Front Stitch Count': 9400,
        'Back Stitch Count': 6100,
        'Sleeve Stitch Count': 3200,
        'Description': 'Intricate peacock border pattern suitable for sarees and lehengas.'
      }
    ];

    const instructionRows = [
      { 'Column': 'Design Code / SKU', 'Required': 'YES', 'Rule / Note': 'Unique Design Code / SKU (e.g. AED-BLO-01). Used to match the existing product.' },
      { 'Column': 'Design Name', 'Required': 'NO', 'Rule / Note': 'Optional design title. Leave blank to leave existing design name unchanged.' },
      { 'Column': 'Category', 'Required': 'NO', 'Rule / Note': 'Category name (e.g. Blouse Designs, Floral, Borders). Must match an existing category.' },
      { 'Column': 'Front Stitch Count', 'Required': 'NO', 'Rule / Note': 'Whole number >= 0 (e.g. 12500). Non-negative integers only.' },
      { 'Column': 'Back Stitch Count', 'Required': 'NO', 'Rule / Note': 'Whole number >= 0 (e.g. 8200). Non-negative integers only.' },
      { 'Column': 'Sleeve Stitch Count', 'Required': 'NO', 'Rule / Note': 'Whole number >= 0 (e.g. 4500). Non-negative integers only.' },
      { 'Column': 'Description', 'Required': 'NO', 'Rule / Note': 'Detailed product description. Multi-line text and paragraphs supported.' },
      { 'Column': 'BLANK CELLS', 'Required': '-', 'Rule / Note': 'Leaving a cell empty leaves the existing database value UNCHANGED.' },
      { 'Column': 'CLEARING A FIELD', 'Required': '-', 'Rule / Note': 'Type [CLEAR] in any field to explicitly erase/remove the existing value.' }
    ];

    const wb = XLSX.utils.book_new();
    const wsData = XLSX.utils.json_to_sheet(exampleRows);
    const wsInstructions = XLSX.utils.json_to_sheet(instructionRows);

    // Set auto column widths for neat display
    wsData['!cols'] = [
      { wch: 20 }, // SKU
      { wch: 26 }, // Name
      { wch: 20 }, // Category
      { wch: 20 }, // Front Stitch Count
      { wch: 20 }, // Back Stitch Count
      { wch: 22 }, // Sleeve Stitch Count
      { wch: 60 }  // Description
    ];

    wsInstructions['!cols'] = [
      { wch: 24 },
      { wch: 12 },
      { wch: 65 }
    ];

    XLSX.utils.book_append_sheet(wb, wsData, 'Design Details');
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Helper to clean and normalize a key for flexible header matching
   */
  normalizeHeader(str) {
    return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Helper to check if a value is an explicit clear keyword
   */
  isClearKeyword(val) {
    if (val === null || val === undefined) return false;
    const clean = String(val).trim().toUpperCase();
    return ['[CLEAR]', '__CLEAR__', 'CLEAR', '[EMPTY]', '__EMPTY__'].includes(clean);
  }

  /**
   * Helper to validate a stitch count value as non-negative integer or null
   */
  validateStitch(val, fieldName) {
    if (val === undefined || val === null || String(val).trim() === '') {
      return { valid: true, value: undefined }; // untouched
    }
    if (this.isClearKeyword(val)) {
      return { valid: true, value: null, isClear: true };
    }
    const clean = String(val).replace(/,/g, '').replace(/stitches|pts/gi, '').trim();
    if (!/^\d+$/.test(clean)) {
      return { valid: false, error: `${fieldName} must be a non-negative whole number (e.g. 12500). Got: "${val}"` };
    }
    const num = parseInt(clean, 10);
    if (num < 0) {
      return { valid: false, error: `${fieldName} must be non-negative. Got: "${val}"` };
    }
    return { valid: true, value: num };
  }

  /**
   * Category matcher matching exact, lowercase, or stemmed category names
   */
  matchCategory(rawCatName, existingCategories) {
    if (!rawCatName || !String(rawCatName).trim()) return null;
    const raw = String(rawCatName).trim();
    const lower = raw.toLowerCase();
    const normInput = lower.replace(/[^a-z0-9]/g, '');

    // 1. Exact or lowercase match
    for (const c of existingCategories) {
      if (c.name.toLowerCase() === lower || (c.slug && c.slug.toLowerCase() === lower)) {
        return c;
      }
    }

    // 2. Alphanumeric match
    for (const c of existingCategories) {
      const normName = c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normSlug = (c.slug || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normName === normInput || normSlug === normInput) {
        return c;
      }
    }

    // 3. Substring / Stemmed match
    for (const c of existingCategories) {
      const normName = c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normName.includes(normInput) || normInput.includes(normName)) {
        return c;
      }
    }

    return null;
  }

  /**
   * Main entry point to parse any input source (notes text or file upload)
   */
  async parseRawInput({ file = null, notes = '', clearFieldOption = false }) {
    if (file) {
      const ext = path.extname(file.originalname || '').toLowerCase();
      let buffer = file.buffer;
      if (!buffer && file.path && fs.existsSync(file.path)) {
        buffer = fs.readFileSync(file.path);
      }

      if (!buffer) {
        throw new Error('No uploaded file content received.');
      }

      if (['.xlsx', '.xls'].includes(ext)) {
        return this.parseExcelBuffer(buffer, clearFieldOption);
      } else if (ext === '.txt') {
        const textContent = buffer.toString('utf-8');
        return this.parseStructuredText(textContent, clearFieldOption);
      } else if (ext === '.docx') {
        const result = await mammoth.extractRawText({ buffer });
        if (!result || !result.value || result.value.trim().length === 0) {
          throw new Error('Word document (.docx) does not contain extractable text.');
        }
        return this.parseStructuredText(result.value, clearFieldOption);
      } else if (ext === '.doc') {
        // Legacy Word .doc binary format
        try {
          const result = await mammoth.extractRawText({ buffer });
          if (result && result.value && result.value.trim().length > 10) {
            return this.parseStructuredText(result.value, clearFieldOption);
          }
        } catch (e) {
          // mammoth does not natively support OLE2 binary .doc
        }
        throw new Error('Legacy binary .doc file could not be parsed safely. Please save or export your document as modern Word (.docx), Excel (.xlsx), PDF, or plain text (.txt) and try again.');
      } else if (ext === '.pdf') {
        let pdfData;
        try {
          pdfData = await pdfParse(buffer);
        } catch (pdfErr) {
          throw new Error(`Unable to read PDF file: ${pdfErr.message}`);
        }

        const extractedText = (pdfData && pdfData.text) ? pdfData.text.trim() : '';
        // If PDF contains very little or no text (e.g. scanned image pages), report OCR required as requested
        if (extractedText.length < 15) {
          throw new Error('This PDF appears to be a scanned document or image-only PDF. Direct text extraction is not possible. Optical Character Recognition (OCR) is required to import scanned documents. Please upload a text-based PDF, Word, Excel, or TXT file instead.');
        }

        return this.parseStructuredText(extractedText, clearFieldOption);
      } else {
        throw new Error(`Unsupported file format "${ext}". Supported formats: .xlsx, .xls, .docx, .pdf, and .txt.`);
      }
    }

    if (notes && String(notes).trim().length > 0) {
      return this.parseStructuredText(String(notes), clearFieldOption);
    }

    throw new Error('Please provide text notes or upload a file (.xlsx, .xls, .docx, .pdf, .txt) to proceed.');
  }

  /**
   * Parse Excel Workbook
   */
  parseExcelBuffer(buffer, clearFieldOption) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error('The uploaded spreadsheet contains no sheets.');
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
    if (!rows || rows.length === 0) {
      throw new Error('The spreadsheet is empty or has no data rows.');
    }

    const parsedEntries = [];

    rows.forEach((row, idx) => {
      // Find matching keys by normalized header
      let rawSku = null;
      let rawName = null;
      let rawCategory = null;
      let rawFrontStitch = null;
      let rawBackStitch = null;
      let rawSleeveStitch = null;
      let rawDescription = null;

      for (const [key, val] of Object.entries(row)) {
        const normKey = this.normalizeHeader(key);
        if (/^(designcode(sku)?|sku|code|productcode|itemcode)$/.test(normKey)) {
          rawSku = val;
        } else if (/^(designname|name|title|productname)$/.test(normKey)) {
          rawName = val;
        } else if (/^(category|categoryname)$/.test(normKey)) {
          rawCategory = val;
        } else if (/^(front(stitchcount)?|stitchcountfront|frontstitches?|frontstitch)$/.test(normKey)) {
          rawFrontStitch = val;
        } else if (/^(back(stitchcount)?|stitchcountback|backstitches?|backstitch)$/.test(normKey)) {
          rawBackStitch = val;
        } else if (/^(sleeve(stitchcount)?|stitchcountsleeve|sleevestitches?|sleevestitch)$/.test(normKey)) {
          rawSleeveStitch = val;
        } else if (/^(description|detaileddescription|details|notes)$/.test(normKey)) {
          rawDescription = val;
        }
      }

      // Ignore completely empty rows
      if (!rawSku && !rawName && !rawCategory && rawFrontStitch === null && rawBackStitch === null && rawSleeveStitch === null && !rawDescription) {
        return;
      }

      parsedEntries.push({
        entryIndex: idx + 1,
        rawSku: rawSku !== null && rawSku !== undefined ? String(rawSku).trim() : '',
        rawName: rawName !== null && rawName !== undefined ? String(rawName).trim() : undefined,
        rawCategory: rawCategory !== null && rawCategory !== undefined ? String(rawCategory).trim() : undefined,
        rawFrontStitch: rawFrontStitch !== null && rawFrontStitch !== undefined ? String(rawFrontStitch).trim() : undefined,
        rawBackStitch: rawBackStitch !== null && rawBackStitch !== undefined ? String(rawBackStitch).trim() : undefined,
        rawSleeveStitch: rawSleeveStitch !== null && rawSleeveStitch !== undefined ? String(rawSleeveStitch).trim() : undefined,
        rawDescription: rawDescription !== null && rawDescription !== undefined ? String(rawDescription).trim() : undefined
      });
    });

    if (parsedEntries.length === 0) {
      throw new Error('No valid design rows could be identified in the uploaded Excel file. Please ensure column headers match the template.');
    }

    return parsedEntries;
  }

  /**
   * Parse structured text (pasted notes, TXT, DOCX text, text-based PDF)
   */
  parseStructuredText(rawText, clearFieldOption) {
    if (!rawText || !rawText.trim()) {
      throw new Error('No text content available to parse.');
    }

    // Normalize newlines
    const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Split entries by explicit divider line or lookahead for Design Code/SKU:
    let chunks = [];
    const dividerRegex = /(?:^|\n)\s*(?:---|===|\*\*\*|___+)\s*(?:\n|$)/g;
    if (dividerRegex.test(normalized)) {
      chunks = normalized.split(dividerRegex).map(c => c.trim()).filter(Boolean);
    } else {
      // Split on occurrences of "Design Code:" or "SKU:" at the start of a line
      const lookaheadRegex = /(?:^|\n)(?=\s*(?:Design\s*Code(?:\s*\/\s*SKU)?|SKU)\s*:)/gi;
      const splitChunks = normalized.split(lookaheadRegex).map(c => c.trim()).filter(Boolean);
      if (splitChunks.length > 0) {
        chunks = splitChunks;
      } else {
        chunks = [normalized.trim()];
      }
    }

    const parsedEntries = [];

    chunks.forEach((chunk, idx) => {
      if (!chunk.trim()) return;

      let rawSku = '';
      let rawName = undefined;
      let rawCategory = undefined;
      let rawFrontStitch = undefined;
      let rawBackStitch = undefined;
      let rawSleeveStitch = undefined;
      let rawDescription = undefined;

      // Extract SKU
      const skuMatch = chunk.match(/(?:^|\n)\s*(?:Design\s*Code(?:\s*\/\s*SKU)?|SKU|Product\s*Code|Item\s*Code)\s*:\s*([^\n\r]+)/i);
      if (skuMatch) rawSku = skuMatch[1].trim();

      // Extract Name
      const nameMatch = chunk.match(/(?:^|\n)\s*(?:Design\s*Name|Title|Name|Product\s*Name)\s*:\s*([^\n\r]+)/i);
      if (nameMatch) rawName = nameMatch[1].trim();

      // Extract Category
      const catMatch = chunk.match(/(?:^|\n)\s*(?:Category(?:\s*Name)?)\s*:\s*([^\n\r]+)/i);
      if (catMatch) rawCategory = catMatch[1].trim();

      // Extract Front Stitch Count (e.g. "Front Stitch Count: 12500" or "- Front: 12,500 stitches" or "Front: 12500")
      const frontMatch = chunk.match(/(?:^|\n)\s*(?:Front\s*Stitch\s*Count|Stitch\s*Count\s*[-–—:]\s*Front|Front\s*Stitches?|[-*•]?\s*Front)\s*:\s*([^\n\r]+)/i);
      if (frontMatch) rawFrontStitch = frontMatch[1].trim();

      // Extract Back Stitch Count
      const backMatch = chunk.match(/(?:^|\n)\s*(?:Back\s*Stitch\s*Count|Stitch\s*Count\s*[-–—:]\s*Back|Back\s*Stitches?|[-*•]?\s*Back)\s*:\s*([^\n\r]+)/i);
      if (backMatch) rawBackStitch = backMatch[1].trim();

      // Extract Sleeve Stitch Count
      const sleeveMatch = chunk.match(/(?:^|\n)\s*(?:Sleeve\s*Stitch\s*Count|Stitch\s*Count\s*[-–—:]\s*Sleeve|Sleeve\s*Stitches?|[-*•]?\s*Sleeve)\s*:\s*([^\n\r]+)/i);
      if (sleeveMatch) rawSleeveStitch = sleeveMatch[1].trim();

      // Extract Description (everything after "Description:" until the end of entry)
      const descMatch = chunk.match(/(?:^|\n)\s*(?:Detailed\s*Description|Description|Details)\s*:\s*([\s\S]*)$/i);
      if (descMatch) {
        rawDescription = descMatch[1].trim();
      }

      parsedEntries.push({
        entryIndex: idx + 1,
        rawSku,
        rawName,
        rawCategory,
        rawFrontStitch,
        rawBackStitch,
        rawSleeveStitch,
        rawDescription
      });
    });

    if (parsedEntries.length === 0) {
      throw new Error('No structured design entries could be parsed from the text. Please follow the format:\nDesign Code: AED-BLO-01\nDesign Name: Rose Bloom\nFront Stitch Count: 12500\n...');
    }

    return parsedEntries;
  }

  /**
   * Builds the preview table comparing database values vs proposed values
   */
  async buildPreview(parsedEntries, clearFieldOption = false) {
    const { list, map: skuMap } = await Design.getAllMapBySku();
    const categories = await Category.getAll();

    const items = [];
    let readyCount = 0;
    let noChangeCount = 0;
    let unmatchedCount = 0;
    let invalidCount = 0;

    for (const entry of parsedEntries) {
      const { entryIndex, rawSku, rawName, rawCategory, rawFrontStitch, rawBackStitch, rawSleeveStitch, rawDescription } = entry;

      const errors = [];
      const warnings = [];
      const changes = [];

      // 1. Check SKU presence
      if (!rawSku || !rawSku.trim()) {
        errors.push('Missing Design Code / SKU. A unique SKU is required to match products.');
      }

      // 2. Lookup existing design in DB
      const cleanSku = (rawSku || '').trim().toUpperCase();
      const existingDesign = skuMap.get(cleanSku);

      if (!existingDesign && rawSku) {
        errors.push(`SKU "${rawSku}" does not match any existing design in catalog.`);
      }

      // Existing values snapshot
      const existing = existingDesign ? {
        id: existingDesign.id,
        sku: existingDesign.sku,
        title: existingDesign.title,
        category_id: existingDesign.category_id,
        category_name: existingDesign.category_name || 'Unassigned',
        stitch_count_front: existingDesign.stitch_count_front,
        stitch_count_back: existingDesign.stitch_count_back,
        stitch_count_sleeve: existingDesign.stitch_count_sleeve,
        description: existingDesign.description || ''
      } : {
        id: null,
        sku: rawSku,
        title: 'Unmatched',
        category_id: null,
        category_name: '—',
        stitch_count_front: null,
        stitch_count_back: null,
        stitch_count_sleeve: null,
        description: ''
      };

      const proposed = {
        title: existing.title,
        category_id: existing.category_id,
        category_name: existing.category_name,
        stitch_count_front: existing.stitch_count_front,
        stitch_count_back: existing.stitch_count_back,
        stitch_count_sleeve: existing.stitch_count_sleeve,
        description: existing.description
      };

      // 3. Process Design Name
      if (rawName !== undefined && rawName !== '') {
        if (this.isClearKeyword(rawName) || (clearFieldOption && rawName === '[CLEAR]')) {
          errors.push('Design Name cannot be cleared or set to empty.');
        } else if (rawName !== existing.title) {
          proposed.title = rawName;
          changes.push('Design Name');
        }
      }

      // 4. Process Category
      if (rawCategory !== undefined && rawCategory !== '') {
        if (this.isClearKeyword(rawCategory) || (clearFieldOption && rawCategory === '[CLEAR]')) {
          if (existing.category_id !== null) {
            proposed.category_id = null;
            proposed.category_name = 'Unassigned';
            changes.push('Category');
          }
        } else {
          const matchedCat = this.matchCategory(rawCategory, categories);
          if (!matchedCat) {
            warnings.push(`Category "${rawCategory}" does not exist in database.`);
          } else if (matchedCat.id !== existing.category_id) {
            proposed.category_id = matchedCat.id;
            proposed.category_name = matchedCat.name;
            changes.push('Category');
          }
        }
      }

      // 5. Process Front Stitch Count
      const frontRes = this.validateStitch(rawFrontStitch, 'Front Stitch Count');
      if (!frontRes.valid) {
        errors.push(frontRes.error);
      } else if (frontRes.value !== undefined) {
        const targetVal = frontRes.value;
        if (targetVal !== existing.stitch_count_front) {
          proposed.stitch_count_front = targetVal;
          changes.push('Front Stitch Count');
        }
      }

      // 6. Process Back Stitch Count
      const backRes = this.validateStitch(rawBackStitch, 'Back Stitch Count');
      if (!backRes.valid) {
        errors.push(backRes.error);
      } else if (backRes.value !== undefined) {
        const targetVal = backRes.value;
        if (targetVal !== existing.stitch_count_back) {
          proposed.stitch_count_back = targetVal;
          changes.push('Back Stitch Count');
        }
      }

      // 7. Process Sleeve Stitch Count
      const sleeveRes = this.validateStitch(rawSleeveStitch, 'Sleeve Stitch Count');
      if (!sleeveRes.valid) {
        errors.push(sleeveRes.error);
      } else if (sleeveRes.value !== undefined) {
        const targetVal = sleeveRes.value;
        if (targetVal !== existing.stitch_count_sleeve) {
          proposed.stitch_count_sleeve = targetVal;
          changes.push('Sleeve Stitch Count');
        }
      }

      // 8. Process Description
      if (rawDescription !== undefined && rawDescription !== '') {
        if (this.isClearKeyword(rawDescription) || (clearFieldOption && rawDescription === '[CLEAR]')) {
          if (existing.description) {
            proposed.description = null;
            changes.push('Description');
          }
        } else {
          const cleanDesc = String(rawDescription).trim();
          if (cleanDesc !== (existing.description || '').trim()) {
            proposed.description = cleanDesc;
            changes.push('Description');
          }
        }
      }

      // Calculate proposed Total Stitch Count (Front + Back + Sleeve)
      const effFront = proposed.stitch_count_front !== undefined ? proposed.stitch_count_front : existing.stitch_count_front;
      const effBack = proposed.stitch_count_back !== undefined ? proposed.stitch_count_back : existing.stitch_count_back;
      const effSleeve = proposed.stitch_count_sleeve !== undefined ? proposed.stitch_count_sleeve : existing.stitch_count_sleeve;
      if (effFront !== null && effFront !== undefined && effBack !== null && effBack !== undefined && effSleeve !== null && effSleeve !== undefined) {
        proposed.stitch_count = Number(effFront) + Number(effBack) + Number(effSleeve);
      } else {
        proposed.stitch_count = null;
      }

      // Determine Status
      let status = 'ready';
      if (errors.length > 0) {
        if (!existingDesign) {
          status = 'unmatched';
          unmatchedCount++;
        } else {
          status = 'invalid';
          invalidCount++;
        }
      } else if (changes.length === 0) {
        status = 'no_change';
        noChangeCount++;
      } else {
        status = 'ready';
        readyCount++;
      }

      items.push({
        rowNumber: entryIndex,
        sku: rawSku || '—',
        designId: existing.id,
        designTitle: existing.title,
        existing,
        proposed,
        changes,
        hasChanges: changes.length > 0,
        errors,
        warnings,
        status
      });
    }

    return {
      items,
      total: items.length,
      readyCount,
      noChangeCount,
      unmatchedCount,
      invalidCount,
      canConfirm: readyCount > 0
    };
  }

  /**
   * Executes confirmed updates safely
   */
  async applyBulkUpdate(items, req = null) {
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error('No items provided for update confirmation.');
    }

    let updatedCount = 0;
    let skippedCount = 0;
    let unmatchedCount = 0;
    let failedCount = 0;
    const failedRows = [];

    for (const item of items) {
      // Only process valid rows that have changes and are matched
      if (item.status === 'unmatched') {
        unmatchedCount++;
        failedRows.push({
          row: item.rowNumber,
          sku: item.sku,
          reason: 'Unmatched: SKU does not exist in catalog.'
        });
        continue;
      }

      if (item.status === 'invalid' || (item.errors && item.errors.length > 0)) {
        failedCount++;
        failedRows.push({
          row: item.rowNumber,
          sku: item.sku,
          reason: `Validation Error: ${(item.errors || []).join('; ')}`
        });
        continue;
      }

      if (item.status === 'no_change' || !item.hasChanges || !item.changes || item.changes.length === 0) {
        skippedCount++;
        continue;
      }

      try {
        const updatePayload = {};
        if (item.changes.includes('Design Name') && item.proposed.title) {
          updatePayload.title = item.proposed.title;
        }
        if (item.changes.includes('Category')) {
          updatePayload.category_id = item.proposed.category_id;
        }
        if (item.changes.includes('Front Stitch Count')) {
          updatePayload.stitch_count_front = item.proposed.stitch_count_front;
        }
        if (item.changes.includes('Back Stitch Count')) {
          updatePayload.stitch_count_back = item.proposed.stitch_count_back;
        }
        if (item.changes.includes('Sleeve Stitch Count')) {
          updatePayload.stitch_count_sleeve = item.proposed.stitch_count_sleeve;
        }
        if (item.changes.includes('Description')) {
          updatePayload.description = item.proposed.description;
        }

        // Keep total stitch count synchronized when all three components exist
        const f = updatePayload.stitch_count_front !== undefined ? updatePayload.stitch_count_front : item.existing.stitch_count_front;
        const b = updatePayload.stitch_count_back !== undefined ? updatePayload.stitch_count_back : item.existing.stitch_count_back;
        const s = updatePayload.stitch_count_sleeve !== undefined ? updatePayload.stitch_count_sleeve : item.existing.stitch_count_sleeve;
        if (f !== null && f !== undefined && b !== null && b !== undefined && s !== null && s !== undefined) {
          updatePayload.stitch_count = Number(f) + Number(b) + Number(s);
        } else {
          updatePayload.stitch_count = null;
        }

        await Design.update(item.designId, updatePayload);
        updatedCount++;
      } catch (updateErr) {
        failedCount++;
        failedRows.push({
          row: item.rowNumber,
          sku: item.sku,
          reason: `Database error: ${updateErr.message}`
        });
      }
    }

    // Log Activity
    if (req && updatedCount > 0) {
      try {
        await ActivityLog.logFromReq(
          req,
          'bulk_details_update',
          'design',
          null,
          `Bulk updated details for ${updatedCount} design(s). Skipped: ${skippedCount}, Unmatched: ${unmatchedCount}, Failed: ${failedCount}.`
        );
      } catch (logErr) {
        console.warn('[ActivityLog Error in bulk details]:', logErr.message);
      }
    }

    return {
      success: true,
      updatedCount,
      skippedCount,
      unmatchedCount,
      failedCount,
      failedRows
    };
  }

  /**
   * Generates downloadable CSV / Excel Error Report for failed rows
   */
  generateErrorReport(failedRows) {
    const reportData = (failedRows || []).map(r => ({
      'Row Number': r.row || '—',
      'Design Code / SKU': r.sku || '—',
      'Failure Reason': r.reason || 'Unknown error'
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(reportData.length > 0 ? reportData : [{ 'Message': 'No failed rows. All records processed cleanly.' }]);
    ws['!cols'] = [{ wch: 15 }, { wch: 25 }, { wch: 70 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Failed Rows Report');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }
}

module.exports = new BulkDesignDetailsService();
