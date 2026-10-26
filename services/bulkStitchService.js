const XLSX = require('xlsx');
const db = require('../config/db');
const ActivityLog = require('../models/ActivityLog');
const Design = require('../models/Design');

// Persistent in-memory audit logs for local offline fallback mode
const fallbackLogs = [];
const fallbackLogItems = [];

class BulkStitchService {
  /**
   * Normalize strings for comparison (lowercase, trimmed, strip hyphens/spaces/underscores/special chars)
   */
  normalizeKey(str) {
    if (!str) return '';
    return String(str).toLowerCase().trim().replace(/[\s\-_.:/\\()[\]{}]+/g, '');
  }

  /**
   * Parse and validate a stitch count number
   * Accepts numbers or strings with commas (e.g. "12,500").
   * Returns:
   *   { valid: true, value: number | null } or
   *   { valid: false, error: string }
   */
  parseStitchNumber(raw, fieldName = 'Stitch count') {
    if (raw === undefined || raw === null || raw === '') {
      return { valid: true, value: null };
    }

    let str = String(raw).trim();
    if (str === '') {
      return { valid: true, value: null };
    }

    // Strip thousand separator commas
    str = str.replace(/,/g, '');

    // Must be valid non-negative integer
    if (!/^\d+$/.test(str)) {
      return { valid: false, error: `${fieldName} must be a whole positive number (got "${raw}").` };
    }

    const num = parseInt(str, 10);
    if (isNaN(num) || num < 0) {
      return { valid: false, error: `${fieldName} cannot be negative.` };
    }
    if (num > 10000000) {
      return { valid: false, error: `${fieldName} cannot exceed 10,000,000.` };
    }

    return { valid: true, value: num };
  }

  /**
   * Generate official Excel template (.xlsx) for stitch counts
   */
  generateTemplate() {
    const exampleRows = [
      {
        'SKU': 'AED-BLO-01',
        'Front': '',
        'Back': '',
        'Sleeve': '',
        'Total': ''
      },
      {
        'SKU': 'AED-BOR-02',
        'Front': '',
        'Back': '',
        'Sleeve': '',
        'Total': ''
      },
      {
        'SKU': 'AED-MN-03',
        'Front': '',
        'Back': '',
        'Sleeve': '',
        'Total': ''
      }
    ];

    const instructionRows = [
      { 'Column': 'SKU', 'Required': 'YES', 'Description': 'Design Code or SKU (e.g. AED-BLO-01). Case-insensitive.' },
      { 'Column': 'Front', 'Required': 'NO', 'Description': 'Front stitch count (whole number: 0 - 10,000,000). Accepts commas like "12,500".' },
      { 'Column': 'Back', 'Required': 'NO', 'Description': 'Back stitch count (whole number: 0 - 10,000,000).' },
      { 'Column': 'Sleeve', 'Required': 'NO', 'Description': 'Sleeve stitch count (whole number: 0 - 10,000,000).' },
      { 'Column': 'Total', 'Required': 'NO (Auto)', 'Description': 'Total stitches. If empty, automatically calculated as Front + Back + Sleeve. If provided, saves as manual override.' },
      { 'Column': 'Notes', 'Required': '-', 'Description': 'Empty cells leave existing stitch values untouched unless "Treat empty as clear/NULL" is selected in the update modal.' }
    ];

    const wb = XLSX.utils.book_new();
    const wsData = XLSX.utils.json_to_sheet(exampleRows);
    const wsGuide = XLSX.utils.json_to_sheet(instructionRows);

    // Set column widths
    wsData['!cols'] = [
      { wch: 18 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 16 }
    ];

    wsGuide['!cols'] = [
      { wch: 14 },
      { wch: 16 },
      { wch: 60 }
    ];

    XLSX.utils.book_append_sheet(wb, wsData, 'Stitch Counts');
    XLSX.utils.book_append_sheet(wb, wsGuide, 'Instructions & Notes');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Parse uploaded CSV or XLSX file
   */
  parseSpreadsheet(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (!rawRows || rawRows.length === 0) {
      throw new Error('The uploaded spreadsheet contains no data rows.');
    }

    // Header aliases (trimmed, lowercase, non-alphanumeric stripped)
    const skuAliases = [
      'sku', 'design code', 'designcode', 'code', 'item code', 'itemcode', 'product code', 'id', 'product id', 'design code / sku', 'design code/sku', 'design sku', 'code / sku'
    ];
    const frontAliases = [
      'stitch front', 'front stitch', 'stitch_count_front', 'front', 'front stitches', 'front stitch count', 'front count', 'stitchfront', 'stitch count front', 'stitch count (front)'
    ];
    const backAliases = [
      'stitch back', 'back stitch', 'stitch_count_back', 'back', 'back stitches', 'back stitch count', 'back count', 'stitchback', 'stitch count back', 'stitch count (back)'
    ];
    const sleeveAliases = [
      'stitch sleeve', 'sleeve stitch', 'stitch_count_sleeve', 'sleeve', 'sleeves', 'sleeve stitches', 'sleeve stitch count', 'stitchsleeve', 'stitch count sleeve', 'stitch count (sleeve)'
    ];
    const totalAliases = [
      'total stitches', 'total stitch', 'total', 'stitch total', 'stitch_count_total', 'stitch_count', 'total stitch count', 'stitchtotal', 'stitches', 'total stitches count'
    ];

    const getVal = (row, aliases) => {
      for (const alias of aliases) {
        const normAlias = this.normalizeKey(alias);
        for (const rowKey of Object.keys(row)) {
          if (this.normalizeKey(rowKey) === normAlias) {
            const val = row[rowKey];
            return val !== undefined && val !== null ? String(val).trim() : '';
          }
        }
      }
      return '';
    };

    const parsedItems = [];
    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const skuVal = getVal(row, skuAliases);
      const frontVal = getVal(row, frontAliases);
      const backVal = getVal(row, backAliases);
      const sleeveVal = getVal(row, sleeveAliases);
      const totalVal = getVal(row, totalAliases);

      // Skip completely empty rows
      if (!skuVal && !frontVal && !backVal && !sleeveVal && !totalVal) continue;

      parsedItems.push({
        rowNum: i + 2,
        sku: skuVal,
        frontRaw: frontVal,
        backRaw: backVal,
        sleeveRaw: sleeveVal,
        totalRaw: totalVal
      });
    }

    if (parsedItems.length === 0) {
      throw new Error('No valid rows found in the uploaded file.');
    }

    return parsedItems;
  }

  /**
   * Construct SQL WHERE clause for design targeting
   */
  buildTargetFilterSql(filters = {}, selectedIds = []) {
    const { scope, categoryIds, status, formats, stitchFilter, search } = filters;
    const whereClauses = ['d.is_active >= 0'];
    const params = [];

    if (scope === 'selected') {
      if (Array.isArray(selectedIds) && selectedIds.length > 0) {
        whereClauses.push(`d.id IN (${selectedIds.map(() => '?').join(',')})`);
        params.push(...selectedIds.map(Number));
      } else {
        whereClauses.push('1 = 0');
      }
      return { whereSql: 'WHERE ' + whereClauses.join(' AND '), params };
    }

    if (categoryIds && categoryIds.length > 0) {
      const catList = Array.isArray(categoryIds) ? categoryIds : [categoryIds];
      const validCats = catList.map(c => Number(c)).filter(c => !isNaN(c) && c > 0);
      if (validCats.length > 0) {
        whereClauses.push(`d.category_id IN (${validCats.map(() => '?').join(',')})`);
        params.push(...validCats);
      }
    }

    if (status === 'active') {
      whereClauses.push('d.is_active = 1');
    } else if (status === 'inactive' || status === 'draft') {
      whereClauses.push('d.is_active = 0');
    }

    if (formats && formats.length > 0) {
      const fmtList = Array.isArray(formats) ? formats : [formats];
      const fmtConditions = [];
      for (const fmt of fmtList) {
        if (fmt && fmt.trim()) {
          fmtConditions.push('d.formats LIKE ?');
          params.push(`%${fmt.trim()}%`);
        }
      }
      if (fmtConditions.length > 0) {
        whereClauses.push(`(${fmtConditions.join(' OR ')})`);
      }
    }

    if (stitchFilter === 'missing') {
      whereClauses.push('(d.stitch_count_total IS NULL AND d.stitch_count IS NULL)');
    } else if (stitchFilter === 'has_stitch') {
      whereClauses.push('(d.stitch_count_total IS NOT NULL OR d.stitch_count IS NOT NULL)');
    }

    if (search && String(search).trim()) {
      const trimmed = String(search).trim();
      whereClauses.push('(d.sku LIKE ? OR d.title LIKE ?)');
      params.push(`%${trimmed}%`, `%${trimmed}%`);
    }

    return { whereSql: 'WHERE ' + whereClauses.join(' AND '), params };
  }

  /**
   * Return live count of matching designs
   */
  async getLiveCount(filters = {}, selectedIds = []) {
    const isDb = db.isConnected() && db.pool();
    if (!isDb) {
      const all = await Design.getAll({ is_active_only: false });
      let filtered = all.designs || [];
      if (filters.scope === 'selected' && Array.isArray(selectedIds)) {
        filtered = filtered.filter(d => selectedIds.includes(d.id) || selectedIds.includes(String(d.id)));
      }
      return filtered.length;
    }

    const { whereSql, params } = this.buildTargetFilterSql(filters, selectedIds);
    const sql = `SELECT COUNT(*) AS total FROM designs d ${whereSql}`;
    const rows = await db.query(sql, params);
    return rows && rows[0] ? rows[0].total : 0;
  }

  /**
   * Fetch target designs matching criteria
   */
  async getTargetDesigns(filters = {}, selectedIds = []) {
    const isDb = db.isConnected() && db.pool();
    if (!isDb) {
      const all = await Design.getAll({ is_active_only: false, limit: 10000 });
      let list = all.designs || [];
      if (filters.scope === 'selected' && Array.isArray(selectedIds)) {
        list = list.filter(d => selectedIds.includes(d.id) || selectedIds.includes(String(d.id)));
      }
      return list;
    }

    const { whereSql, params } = this.buildTargetFilterSql(filters, selectedIds);
    const sql = `
      SELECT d.id, d.sku, d.title, d.category_id, d.formats, d.is_active,
             d.stitch_count_front, d.stitch_count_back, d.stitch_count_sleeve,
             COALESCE(d.stitch_count_total, d.stitch_count) AS stitch_count_total,
             COALESCE(d.stitch_total_manual, 0) AS stitch_total_manual,
             c.name AS category_name
      FROM designs d
      LEFT JOIN categories c ON d.category_id = c.id
      ${whereSql}
      ORDER BY d.id ASC
    `;
    return await db.query(sql, params) || [];
  }

  /**
   * Helper to recalculate total from components
   */
  computeStitchTotal(front, back, sleeve) {
    const hasFront = front !== null && front !== undefined;
    const hasBack = back !== null && back !== undefined;
    const hasSleeve = sleeve !== null && sleeve !== undefined;

    if (!hasFront && !hasBack && !hasSleeve) {
      return null;
    }

    return (front || 0) + (back || 0) + (sleeve || 0);
  }

  /**
   * Helper to apply arithmetic rule to a stitch number
   */
  applyRuleValue(currentVal, op, val) {
    let cur = currentVal !== null && currentVal !== undefined ? Number(currentVal) : 0;
    val = Number(val || 0);
    let result = cur;

    switch (op) {
      case 'fixed':
        result = val;
        break;
      case 'increase_number':
        result = cur + val;
        break;
      case 'decrease_number':
        result = Math.max(0, cur - val);
        break;
      case 'increase_percent':
        result = Math.round(cur * (1 + val / 100));
        break;
      case 'decrease_percent':
        result = Math.max(0, Math.round(cur * (1 - val / 100)));
        break;
      default:
        result = cur;
    }

    return Math.min(10000000, Math.max(0, Math.round(result)));
  }

  /**
   * Build preview items and summary stats before applying
   */
  async buildPreview(options = {}, uploadedFile = null) {
    const {
      method = 'spreadsheet', // 'spreadsheet' | 'rule' | 'recalculate'
      scope = 'all',
      selectedIds = [],
      categoryIds = [],
      status = 'all',
      formats = [],
      stitchFilter = 'all',
      search = '',
      treatEmptyAsClear = false,
      // For 'rule' method:
      targetField = 'stitch_count_front', // 'stitch_count_front' | 'stitch_count_back' | 'stitch_count_sleeve' | 'stitch_count_total' | 'all'
      operation = 'fixed',               // 'fixed' | 'increase_number' | 'decrease_number' | 'increase_percent' | 'decrease_percent'
      value = 0,
      // For 'recalculate' method:
      includeManualTotals = false
    } = options;

    const targetBuffer = (uploadedFile && uploadedFile.buffer) ? uploadedFile.buffer :
                         (uploadedFile && Buffer.isBuffer(uploadedFile) ? uploadedFile :
                         (options.fileBuffer ? options.fileBuffer :
                         (options.file && options.file.buffer ? options.file.buffer : null)));

    let previewItems = [];

    if (method === 'spreadsheet' && targetBuffer) {
      const fileRows = this.parseSpreadsheet(targetBuffer);

      // Load designs for SKU/ID matching
      let allDesigns = [];
      const isDb = db.isConnected() && db.pool();
      if (isDb) {
        allDesigns = await db.query(`
          SELECT d.id, d.sku, d.title, d.category_id,
                 d.stitch_count_front, d.stitch_count_back, d.stitch_count_sleeve,
                 COALESCE(d.stitch_count_total, d.stitch_count) AS stitch_count_total,
                 COALESCE(d.stitch_total_manual, 0) AS stitch_total_manual,
                 c.name AS category_name
          FROM designs d
          LEFT JOIN categories c ON d.category_id = c.id
          WHERE d.is_active >= 0
        `) || [];
      } else {
        const res = await Design.getAll({ is_active_only: false, limit: 10000 });
        allDesigns = res.designs || [];
      }

      const designMapBySku = new Map();
      const designMapById = new Map();
      for (const d of allDesigns) {
        if (d.sku) designMapBySku.set(this.normalizeKey(d.sku), d);
        designMapById.set(String(d.id), d);
      }

      for (const row of fileRows) {
        const normSku = this.normalizeKey(row.sku);
        const matched = designMapBySku.get(normSku) || designMapById.get(row.sku);

        if (!matched) {
          previewItems.push({
            rowNum: row.rowNum,
            design_id: null,
            sku: row.sku || 'N/A',
            title: 'Not Found',
            category_name: '-',
            old_front: null,
            old_back: null,
            old_sleeve: null,
            old_total: null,
            old_manual: 0,
            new_front: null,
            new_back: null,
            new_sleeve: null,
            new_total: null,
            new_manual: 0,
            is_changed: false,
            status: 'not_found',
            error: `SKU / Design Code "${row.sku}" not found in database.`,
            error_message: `SKU / Design Code "${row.sku}" not found in database.`
          });
          continue;
        }

        const oldFront = matched.stitch_count_front !== null && matched.stitch_count_front !== undefined ? Number(matched.stitch_count_front) : null;
        const oldBack = matched.stitch_count_back !== null && matched.stitch_count_back !== undefined ? Number(matched.stitch_count_back) : null;
        const oldSleeve = matched.stitch_count_sleeve !== null && matched.stitch_count_sleeve !== undefined ? Number(matched.stitch_count_sleeve) : null;
        const oldTotal = matched.stitch_count_total !== null && matched.stitch_count_total !== undefined ? Number(matched.stitch_count_total) : null;
        const oldManual = matched.stitch_total_manual ? 1 : 0;

        let rowErrors = [];

        // Parse Front
        let newFront = oldFront;
        if (row.frontRaw !== '') {
          const res = this.parseStitchNumber(row.frontRaw, 'Front');
          if (res.valid) newFront = res.value;
          else rowErrors.push(res.error);
        } else if (treatEmptyAsClear) {
          newFront = null;
        }

        // Parse Back
        let newBack = oldBack;
        if (row.backRaw !== '') {
          const res = this.parseStitchNumber(row.backRaw, 'Back');
          if (res.valid) newBack = res.value;
          else rowErrors.push(res.error);
        } else if (treatEmptyAsClear) {
          newBack = null;
        }

        // Parse Sleeve
        let newSleeve = oldSleeve;
        if (row.sleeveRaw !== '') {
          const res = this.parseStitchNumber(row.sleeveRaw, 'Sleeve');
          if (res.valid) newSleeve = res.value;
          else rowErrors.push(res.error);
        } else if (treatEmptyAsClear) {
          newSleeve = null;
        }

        // Parse Total / Mode
        let newTotal = oldTotal;
        let newManual = oldManual;

        if (row.totalRaw !== '') {
          const res = this.parseStitchNumber(row.totalRaw, 'Total');
          if (res.valid) {
            newTotal = res.value;
            newManual = 1; // Explicit total provided in spreadsheet = manual override
          } else {
            rowErrors.push(res.error);
          }
        } else {
          // Total not explicitly given in row: auto recalculate if components were touched or if treatEmptyAsClear
          if (row.frontRaw !== '' || row.backRaw !== '' || row.sleeveRaw !== '' || treatEmptyAsClear) {
            newTotal = this.computeStitchTotal(newFront, newBack, newSleeve);
            newManual = 0; // Auto mode
          }
        }

        let rowStatus = 'ok';
        let errorMessage = null;

        if (rowErrors.length > 0) {
          rowStatus = 'invalid';
          errorMessage = rowErrors.join(' ');
        }

        const isChanged = (
          newFront !== oldFront ||
          newBack !== oldBack ||
          newSleeve !== oldSleeve ||
          newTotal !== oldTotal ||
          newManual !== oldManual
        );

        if (rowStatus === 'ok' && !isChanged) {
          rowStatus = 'unchanged';
        }

        previewItems.push({
          rowNum: row.rowNum,
          design_id: matched.id,
          sku: matched.sku || `AED-${matched.id}`,
          title: matched.title,
          category_name: matched.category_name || 'General',
          old_front: oldFront,
          old_back: oldBack,
          old_sleeve: oldSleeve,
          old_total: oldTotal,
          old_manual: oldManual,
          new_front: newFront,
          new_back: newBack,
          new_sleeve: newSleeve,
          new_total: newTotal,
          new_manual: newManual,
          is_changed: isChanged,
          status: rowStatus,
          error: errorMessage,
          error_message: errorMessage
        });
      }
    } else if (method === 'rule') {
      // Rule-based bulk stitch update on targeted designs
      const targetDesigns = await this.getTargetDesigns({
        scope, selectedIds, categoryIds, status, formats, stitchFilter, search
      }, selectedIds);

      for (let i = 0; i < targetDesigns.length; i++) {
        const d = targetDesigns[i];
        const oldFront = d.stitch_count_front !== null && d.stitch_count_front !== undefined ? Number(d.stitch_count_front) : null;
        const oldBack = d.stitch_count_back !== null && d.stitch_count_back !== undefined ? Number(d.stitch_count_back) : null;
        const oldSleeve = d.stitch_count_sleeve !== null && d.stitch_count_sleeve !== undefined ? Number(d.stitch_count_sleeve) : null;
        const oldTotal = d.stitch_count_total !== null && d.stitch_count_total !== undefined ? Number(d.stitch_count_total) : null;
        const oldManual = d.stitch_total_manual ? 1 : 0;

        let newFront = oldFront;
        let newBack = oldBack;
        let newSleeve = oldSleeve;
        let newTotal = oldTotal;
        let newManual = oldManual;

        if (targetField === 'stitch_count_front') {
          newFront = this.applyRuleValue(oldFront, operation, value);
          newTotal = this.computeStitchTotal(newFront, newBack, newSleeve);
          newManual = 0;
        } else if (targetField === 'stitch_count_back') {
          newBack = this.applyRuleValue(oldBack, operation, value);
          newTotal = this.computeStitchTotal(newFront, newBack, newSleeve);
          newManual = 0;
        } else if (targetField === 'stitch_count_sleeve') {
          newSleeve = this.applyRuleValue(oldSleeve, operation, value);
          newTotal = this.computeStitchTotal(newFront, newBack, newSleeve);
          newManual = 0;
        } else if (targetField === 'stitch_count_total') {
          newTotal = this.applyRuleValue(oldTotal, operation, value);
          newManual = 1; // Direct update on total sets manual mode
        } else if (targetField === 'all') {
          // Adjust all 3 components proportionally
          newFront = this.applyRuleValue(oldFront, operation, value);
          newBack = this.applyRuleValue(oldBack, operation, value);
          newSleeve = this.applyRuleValue(oldSleeve, operation, value);
          newTotal = this.computeStitchTotal(newFront, newBack, newSleeve);
          newManual = 0;
        }

        const isChanged = (
          newFront !== oldFront ||
          newBack !== oldBack ||
          newSleeve !== oldSleeve ||
          newTotal !== oldTotal ||
          newManual !== oldManual
        );

        previewItems.push({
          rowNum: i + 1,
          design_id: d.id,
          sku: d.sku || `AED-${d.id}`,
          title: d.title,
          category_name: d.category_name || 'General',
          old_front: oldFront,
          old_back: oldBack,
          old_sleeve: oldSleeve,
          old_total: oldTotal,
          old_manual: oldManual,
          new_front: newFront,
          new_back: newBack,
          new_sleeve: newSleeve,
          new_total: newTotal,
          new_manual: newManual,
          is_changed: isChanged,
          status: isChanged ? 'valid' : 'unchanged',
          error_message: null
        });
      }
    } else if (method === 'recalculate') {
      // Recalculate totals = front + back + sleeve
      const targetDesigns = await this.getTargetDesigns({
        scope, selectedIds, categoryIds, status, formats, stitchFilter, search
      }, selectedIds);

      for (let i = 0; i < targetDesigns.length; i++) {
        const d = targetDesigns[i];
        const oldFront = d.stitch_count_front !== null && d.stitch_count_front !== undefined ? Number(d.stitch_count_front) : null;
        const oldBack = d.stitch_count_back !== null && d.stitch_count_back !== undefined ? Number(d.stitch_count_back) : null;
        const oldSleeve = d.stitch_count_sleeve !== null && d.stitch_count_sleeve !== undefined ? Number(d.stitch_count_sleeve) : null;
        const oldTotal = d.stitch_count_total !== null && d.stitch_count_total !== undefined ? Number(d.stitch_count_total) : null;
        const oldManual = d.stitch_total_manual ? 1 : 0;

        // Skip manual totals unless "includeManualTotals" is ticked
        if (oldManual === 1 && !includeManualTotals) {
          previewItems.push({
            rowNum: i + 1,
            design_id: d.id,
            sku: d.sku || `AED-${d.id}`,
            title: d.title,
            category_name: d.category_name || 'General',
            old_front: oldFront,
            old_back: oldBack,
            old_sleeve: oldSleeve,
            old_total: oldTotal,
            old_manual: oldManual,
            new_front: oldFront,
            new_back: oldBack,
            new_sleeve: oldSleeve,
            new_total: oldTotal,
            new_manual: oldManual,
            is_changed: false,
            status: 'unchanged',
            error_message: 'Skipped (manual total override preserved).'
          });
          continue;
        }

        const newTotal = this.computeStitchTotal(oldFront, oldBack, oldSleeve);
        const newManual = 0; // Reset to auto mode

        const isChanged = (newTotal !== oldTotal || newManual !== oldManual);

        previewItems.push({
          rowNum: i + 1,
          design_id: d.id,
          sku: d.sku || `AED-${d.id}`,
          title: d.title,
          category_name: d.category_name || 'General',
          old_front: oldFront,
          old_back: oldBack,
          old_sleeve: oldSleeve,
          old_total: oldTotal,
          old_manual: oldManual,
          new_front: oldFront,
          new_back: oldBack,
          new_sleeve: oldSleeve,
          new_total: newTotal,
          new_manual: newManual,
          is_changed: isChanged,
          status: isChanged ? 'valid' : 'unchanged',
          error_message: null
        });
      }
    }

    const validItems = previewItems.filter(i => (i.status === 'valid' || i.status === 'ok') && i.is_changed);
    const errorItems = previewItems.filter(i => i.status === 'error' || i.status === 'invalid' || i.status === 'not_found');
    const unchangedItems = previewItems.filter(i => i.status === 'unchanged' || !i.is_changed);

    return {
      success: true,
      summary: {
        totalDesigns: previewItems.length,
        totalRows: previewItems.length,
        validCount: validItems.length,
        okCount: validItems.length,
        changedCount: validItems.length,
        errorCount: errorItems.length,
        unchangedCount: unchangedItems.length
      },
      items: previewItems
    };
  }

  async generatePreview(options = {}, uploadedFile = null) {
    return await this.buildPreview(options, uploadedFile);
  }

  /**
   * Apply validated stitch updates safely in database transaction batches of 500
   */
  async applyStitchUpdate({ items, excludedIds = [], excludedSkus = [], filterSummary = '', methodSummary = '', adminUser = null }) {
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error('No items provided for stitch update.');
    }

    const excludedIdSet = new Set((excludedIds || []).map(id => Number(id)));
    const excludedSkuSet = new Set((excludedSkus || []).map(sku => this.normalizeKey(sku)));

    const applicableItems = items.filter(i =>
      i.design_id &&
      !excludedIdSet.has(Number(i.design_id)) &&
      !excludedSkuSet.has(this.normalizeKey(i.sku)) &&
      (i.status === undefined || i.status === 'valid' || i.status === 'ok') &&
      (i.is_changed !== false)
    );

    if (applicableItems.length === 0) {
      throw new Error('No valid changed designs to update.');
    }

    const adminId = adminUser ? adminUser.id : null;
    const adminEmail = adminUser ? (adminUser.email || adminUser.username || 'Admin') : 'Admin';

    const pool = db.pool();
    const isDb = db.isConnected() && pool;

    let logId = Date.now();

    if (!isDb) {
      fallbackLogs.unshift({
        id: logId,
        admin_id: adminId,
        admin_email: adminEmail,
        filter_summary: filterSummary,
        method_summary: methodSummary,
        total_affected: applicableItems.length,
        is_undone: 0,
        undone_at: null,
        created_at: new Date()
      });
      for (const item of applicableItems) {
        fallbackLogItems.push({
          id: fallbackLogItems.length + 1,
          log_id: logId,
          design_id: item.design_id,
          sku: item.sku || null,
          old_front: item.old_front,
          old_back: item.old_back,
          old_sleeve: item.old_sleeve,
          old_total: item.old_total,
          old_manual: item.old_manual || 0,
          new_front: item.new_front,
          new_back: item.new_back,
          new_sleeve: item.new_sleeve,
          new_total: item.new_total,
          new_manual: item.new_manual || 0,
          created_at: new Date()
        });
      }
    } else {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // 1. Insert master log entry in stitch_update_logs
        const [logResult] = await connection.query(
          `INSERT INTO stitch_update_logs (admin_id, admin_email, filter_summary, method_summary, total_affected)
           VALUES (?, ?, ?, ?, ?)`,
          [adminId, adminEmail, filterSummary, methodSummary, applicableItems.length]
        );
        logId = logResult.insertId;

        // 2. Process in batches of 500
        const BATCH_SIZE = 500;
        for (let i = 0; i < applicableItems.length; i += BATCH_SIZE) {
          const batch = applicableItems.slice(i, i + BATCH_SIZE);

          // A. Insert audit log items
          const itemPlaceholders = [];
          const itemValues = [];
          for (const item of batch) {
            itemPlaceholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
            itemValues.push(
              logId,
              item.design_id,
              item.sku || null,
              item.old_front,
              item.old_back,
              item.old_sleeve,
              item.old_total,
              item.old_manual || 0,
              item.new_front,
              item.new_back,
              item.new_sleeve,
              item.new_total,
              item.new_manual || 0
            );
          }

          const logItemsSql = `
            INSERT INTO stitch_update_log_items
              (log_id, design_id, sku, old_front, old_back, old_sleeve, old_total, old_manual,
               new_front, new_back, new_sleeve, new_total, new_manual)
            VALUES ${itemPlaceholders.join(', ')}
          `;
          await connection.query(logItemsSql, itemValues);

          // B. Update designs table
          for (const item of batch) {
            await connection.query(
              `UPDATE designs
               SET stitch_count_front = ?,
                   stitch_count_back = ?,
                   stitch_count_sleeve = ?,
                   stitch_count_total = ?,
                   stitch_count = ?,
                   stitch_total_manual = ?,
                   updated_at = NOW()
               WHERE id = ?`,
              [
                item.new_front,
                item.new_back,
                item.new_sleeve,
                item.new_total,
                item.new_total,
                item.new_manual || 0,
                item.design_id
              ]
            );
          }
        }

        await connection.commit();
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    }

    // Always update fallbackDesigns and in-memory stores so everything stays in sync
    for (const item of applicableItems) {
      await Design.update(item.design_id, {
        stitch_count_front: item.new_front,
        stitch_count_back: item.new_back,
        stitch_count_sleeve: item.new_sleeve,
        stitch_count_total: item.new_total,
        stitch_total_manual: item.new_manual || 0
      });
    }

    // Log Activity
    try {
      await ActivityLog.log({
        userId: adminId,
        adminName: adminEmail,
        action: 'bulk_stitch_update',
        entityType: 'design',
        entityId: logId,
        details: `Updated stitch counts for ${applicableItems.length} design(s). Method: ${methodSummary}`
      });
    } catch (actErr) {
      // Non-fatal
    }

    return {
      success: true,
      logId,
      totalAffected: applicableItems.length,
      updatedCount: applicableItems.length
    };
  }

  async applyBulkUpdate(args = {}) {
    return await this.applyStitchUpdate({
      items: args.items,
      excludedIds: args.excludedIds || [],
      excludedSkus: args.excludedSkus || [],
      filterSummary: args.filterSummary || '',
      methodSummary: args.methodSummary || args.method || '',
      adminUser: args.adminUser || args.admin || null
    });
  }

  /**
   * Get paginated update logs history
   */
  async getHistory({ page = 1, limit = 20 }) {
    const offset = (page - 1) * limit;
    const isDb = db.isConnected() && db.pool();

    if (!isDb) {
      const slice = fallbackLogs.slice(offset, offset + limit);
      return {
        logs: slice,
        pagination: {
          total: fallbackLogs.length,
          page,
          limit,
          totalPages: Math.ceil(fallbackLogs.length / limit) || 1
        }
      };
    }

    const countRows = await db.query('SELECT COUNT(*) AS total FROM stitch_update_logs');
    const totalLogs = countRows && countRows[0] ? countRows[0].total : 0;
    const totalPages = Math.ceil(totalLogs / limit) || 1;

    const logs = await db.query(
      `SELECT * FROM stitch_update_logs ORDER BY id DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    ) || [];

    return {
      logs,
      pagination: {
        currentPage: page,
        totalPages,
        totalLogs
      }
    };
  }

  /**
   * Get single history log details with items
   */
  async getHistoryDetail(logId) {
    const isDb = db.isConnected() && db.pool();
    if (!isDb) {
      const log = fallbackLogs.find(l => l.id == logId);
      const items = fallbackLogItems.filter(i => i.log_id == logId);
      return { log: log || null, items };
    }

    const logRows = await db.query('SELECT * FROM stitch_update_logs WHERE id = ?', [logId]);
    if (!logRows || logRows.length === 0) return null;

    const log = logRows[0];
    const items = await db.query(`
      SELECT sli.*, d.title AS design_title
      FROM stitch_update_log_items sli
      LEFT JOIN designs d ON sli.design_id = d.id
      WHERE sli.log_id = ?
      ORDER BY sli.id ASC
    `, [logId]) || [];

    return {
      log,
      items
    };
  }

  /**
   * Undo a past stitch update
   */
  async undoStitchUpdate(logId, adminUser = null) {
    const isDb = db.isConnected() && db.pool();
    if (!isDb) {
      const log = fallbackLogs.find(l => l.id == logId);
      if (!log) throw new Error(`Stitch update log #${logId} not found.`);
      if (log.is_undone) throw new Error(`This stitch update (#${logId}) has already been undone.`);
      const items = fallbackLogItems.filter(i => i.log_id == logId);
      for (const item of items) {
        await Design.update(item.design_id, {
          stitch_count_front: item.old_front,
          stitch_count_back: item.old_back,
          stitch_count_sleeve: item.old_sleeve,
          stitch_count_total: item.old_total,
          stitch_total_manual: item.old_manual || 0
        });
      }
      log.is_undone = 1;
      log.undone_at = new Date();
      return {
        success: true,
        logId,
        totalRestored: items.length,
        restoredCount: items.length,
        undoneCount: items.length
      };
    }

    const logRows = await db.query('SELECT * FROM stitch_update_logs WHERE id = ?', [logId]);
    if (!logRows || logRows.length === 0) {
      throw new Error(`Stitch update log #${logId} not found.`);
    }

    const log = logRows[0];
    if (log.is_undone) {
      throw new Error(`This stitch update (#${logId}) has already been undone on ${log.undone_at}.`);
    }

    const items = await db.query('SELECT * FROM stitch_update_log_items WHERE log_id = ?', [logId]) || [];
    if (items.length === 0) {
      throw new Error(`No item records found for stitch update log #${logId}.`);
    }

    const pool = db.pool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Restore old stitch counts
      for (const item of items) {
        await connection.query(
          `UPDATE designs
           SET stitch_count_front = ?,
               stitch_count_back = ?,
               stitch_count_sleeve = ?,
               stitch_count_total = ?,
               stitch_count = ?,
               stitch_total_manual = ?,
               updated_at = NOW()
           WHERE id = ?`,
          [
            item.old_front,
            item.old_back,
            item.old_sleeve,
            item.old_total,
            item.old_total,
            item.old_manual || 0,
            item.design_id
          ]
        );

        // Also sync fallback designs
        await Design.update(item.design_id, {
          stitch_count_front: item.old_front,
          stitch_count_back: item.old_back,
          stitch_count_sleeve: item.old_sleeve,
          stitch_count_total: item.old_total,
          stitch_total_manual: item.old_manual || 0
        });
      }

      // Mark log as undone
      await connection.query(
        'UPDATE stitch_update_logs SET is_undone = 1, undone_at = NOW() WHERE id = ?',
        [logId]
      );

      await connection.commit();

      const adminEmail = adminUser ? (adminUser.email || adminUser.username || 'Admin') : 'Admin';
      await ActivityLog.log({
        userId: adminUser ? adminUser.id : null,
        adminName: adminEmail,
        action: 'undo_stitch_update',
        entityType: 'design',
        entityId: logId,
        details: `Reverted stitch update #${logId} for ${items.length} design(s).`
      });

      return {
        success: true,
        logId,
        totalRestored: items.length,
        restoredCount: items.length,
        undoneCount: items.length
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Export history log items as CSV
   */
  async exportHistoryCsv(logId) {
    const isDb = db.isConnected() && db.pool();
    if (!isDb) {
      return 'SKU,Old Front,Old Back,Old Sleeve,Old Total,New Front,New Back,New Sleeve,New Total\n';
    }

    const items = await db.query(`
      SELECT sli.*, d.title
      FROM stitch_update_log_items sli
      LEFT JOIN designs d ON sli.design_id = d.id
      WHERE sli.log_id = ?
      ORDER BY sli.id ASC
    `, [logId]) || [];

    const headers = [
      'SKU', 'Title', 'Old Front', 'Old Back', 'Old Sleeve', 'Old Total',
      'New Front', 'New Back', 'New Sleeve', 'New Total', 'Updated At'
    ];

    const rows = items.map(item => [
      `"${(item.sku || '').replace(/"/g, '""')}"`,
      `"${(item.title || '').replace(/"/g, '""')}"`,
      item.old_front !== null ? item.old_front : '',
      item.old_back !== null ? item.old_back : '',
      item.old_sleeve !== null ? item.old_sleeve : '',
      item.old_total !== null ? item.old_total : '',
      item.new_front !== null ? item.new_front : '',
      item.new_back !== null ? item.new_back : '',
      item.new_sleeve !== null ? item.new_sleeve : '',
      item.new_total !== null ? item.new_total : '',
      item.created_at ? new Date(item.created_at).toISOString() : ''
    ]);

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }
}

module.exports = new BulkStitchService();
