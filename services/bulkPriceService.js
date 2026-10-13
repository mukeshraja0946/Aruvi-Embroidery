const XLSX = require('xlsx');
const db = require('../config/db');
const ActivityLog = require('../models/ActivityLog');

class BulkPriceService {
  /**
   * Normalize strings for comparison (lowercase, trimmed, strip hyphens/spaces/underscores)
   */
  normalizeKey(str) {
    if (!str) return '';
    return String(str).toLowerCase().trim().replace(/[\s\-_]+/g, '');
  }

  /**
   * Helper to round prices based on chosen rounding strategy
   * @param {number} price
   * @param {string} option 'none' | 'nearest_1' | 'nearest_5' | 'end_with_9'
   */
  applyRounding(price, option) {
    if (price === null || price === undefined || isNaN(price)) return 0;
    price = Number(price);
    if (option === 'nearest_1') {
      return Math.max(1, Math.round(price));
    } else if (option === 'nearest_5') {
      return Math.max(5, Math.round(price / 5) * 5);
    } else if (option === 'end_with_9') {
      if (price <= 9) return 9;
      // Psychological pricing ending in 9 (e.g. 49, 99, 149)
      return Math.max(9, Math.round((price - 9) / 10) * 10 + 9);
    }
    // 'none' or default: round to 2 decimals
    return Math.round(price * 100) / 100;
  }

  /**
   * Calculates a single updated price value with method, rounding, and min/max guards
   */
  calculateSinglePrice({ currentPrice, mrp, method, value, rounding, minGuard, maxGuard }) {
    let oldVal = Number(currentPrice || 0);
    let mrpVal = Number(mrp || 0);
    let val = Number(value || 0);
    let calculated = oldVal;

    switch (method) {
      case 'fixed':
        calculated = val;
        break;
      case 'percentage':
        calculated = oldVal * (1 + val / 100);
        break;
      case 'amount':
        calculated = oldVal + val;
        break;
      case 'discount_off_mrp':
        calculated = mrpVal * (1 - val / 100);
        break;
      default:
        calculated = oldVal;
    }

    // Apply rounding
    calculated = this.applyRounding(calculated, rounding);

    // Apply Min/Max Guards if configured
    if (minGuard !== undefined && minGuard !== null && minGuard !== '' && !isNaN(minGuard)) {
      if (calculated < Number(minGuard)) {
        return oldVal; // Guard triggered: retain old price
      }
    }
    if (maxGuard !== undefined && maxGuard !== null && maxGuard !== '' && !isNaN(maxGuard)) {
      if (calculated > Number(maxGuard)) {
        return oldVal; // Guard triggered: retain old price
      }
    }

    return Math.round(calculated * 100) / 100;
  }

  /**
   * Construct SQL WHERE clause for design targeting
   */
  buildTargetFilterSql(filters = {}, selectedIds = []) {
    const { scope, categoryIds, status, formats, minPrice, maxPrice, skuRange, search } = filters;
    const whereClauses = ['d.is_active >= 0'];
    const params = [];

    if (scope === 'selected') {
      if (Array.isArray(selectedIds) && selectedIds.length > 0) {
        whereClauses.push(`d.id IN (${selectedIds.map(() => '?').join(',')})`);
        params.push(...selectedIds.map(Number));
      } else {
        whereClauses.push('1 = 0'); // Empty selection
      }
      return { whereSql: 'WHERE ' + whereClauses.join(' AND '), params };
    }

    if (scope === 'all') {
      // All active/draft designs
      return { whereSql: 'WHERE ' + whereClauses.join(' AND '), params };
    }

    // Custom filtering
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

    if (minPrice !== undefined && minPrice !== null && minPrice !== '' && !isNaN(minPrice)) {
      whereClauses.push('(COALESCE(d.sale_price, d.price) >= ?)');
      params.push(Number(minPrice));
    }

    if (maxPrice !== undefined && maxPrice !== null && maxPrice !== '' && !isNaN(maxPrice)) {
      whereClauses.push('(COALESCE(d.sale_price, d.price) <= ?)');
      params.push(Number(maxPrice));
    }

    const searchQuery = skuRange || search;
    if (searchQuery && String(searchQuery).trim()) {
      const trimmed = String(searchQuery).trim();
      // Check if user entered a range like "AED 1 - AED 50" or "1-50"
      const rangeMatch = trimmed.match(/^([a-zA-Z\s]*?)(\d+)\s*(?:-|to)\s*([a-zA-Z\s]*?)(\d+)$/i);
      if (rangeMatch) {
        const startNum = parseInt(rangeMatch[2], 10);
        const endNum = parseInt(rangeMatch[4], 10);
        const prefix = (rangeMatch[1] || '').trim();
        if (!isNaN(startNum) && !isNaN(endNum) && startNum <= endNum) {
          whereClauses.push('d.id >= ? AND d.id <= ?');
          params.push(startNum, endNum);
        }
      } else {
        whereClauses.push('(d.sku LIKE ? OR d.title LIKE ?)');
        params.push(`%${trimmed}%`, `%${trimmed}%`);
      }
    }

    return { whereSql: 'WHERE ' + whereClauses.join(' AND '), params };
  }

  /**
   * Return live count of matching designs for Step 1
   */
  async getLiveCount(filters = {}, selectedIds = []) {
    const { whereSql, params } = this.buildTargetFilterSql(filters, selectedIds);
    const sql = `SELECT COUNT(*) AS total FROM designs d ${whereSql}`;
    const rows = await db.query(sql, params);
    return rows && rows[0] ? rows[0].total : 0;
  }

  /**
   * Fetch target designs matching criteria
   */
  async getTargetDesigns(filters = {}, selectedIds = []) {
    const { whereSql, params } = this.buildTargetFilterSql(filters, selectedIds);
    const sql = `
      SELECT d.id, d.sku, d.title, d.price, d.sale_price, d.category_id, d.formats, d.is_active,
             c.name AS category_name
      FROM designs d
      LEFT JOIN categories c ON d.category_id = c.id
      ${whereSql}
      ORDER BY d.id ASC
    `;
    return await db.query(sql, params) || [];
  }

  /**
   * Parse uploaded CSV/XLSX buffer for individual design prices
   */
  parseSpreadsheet(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (!rawRows || rawRows.length === 0) {
      throw new Error('The uploaded file contains no data rows.');
    }

    // Supported column header aliases
    const skuAliases = ['sku', 'skucode', 'design code', 'designcode', 'code', 'item code', 'itemcode', 'product code', 'id', 'product id'];
    const mrpAliases = ['mrp', 'original price', 'originalprice', 'maximum retail price', 'price', 'list price', 'regular price'];
    const sellingAliases = ['selling price', 'sellingprice', 'sale price', 'saleprice', 'offer price', 'offerprice', 'discount price', 'current price', 'final price'];

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
      const mrpVal = getVal(row, mrpAliases);
      const sellingVal = getVal(row, sellingAliases);

      if (!skuVal && !mrpVal && !sellingVal) continue; // Skip empty rows

      parsedItems.push({
        rowNum: i + 2,
        sku: skuVal,
        mrpRaw: mrpVal,
        sellingRaw: sellingVal
      });
    }

    return parsedItems;
  }

  /**
   * Build preview items and summary stats before applying
   */
  async buildPreview(options = {}, uploadedFile = null) {
    const {
      scope = 'all',
      selectedIds = [],
      categoryIds = [],
      status = 'all',
      formats = [],
      minPrice,
      maxPrice,
      skuRange,
      search,
      targetField = 'sale_price', // 'sale_price' | 'price' | 'both'
      method = 'percentage',      // 'fixed' | 'percentage' | 'amount' | 'discount_off_mrp' | 'file'
      value = 0,
      rounding = 'none',
      minGuard,
      maxGuard,
      autoCapMrp = false
    } = options;

    let previewItems = [];

    if (method === 'file' && uploadedFile) {
      // 1. Process uploaded CSV/XLSX file
      const fileRows = this.parseSpreadsheet(uploadedFile.buffer);

      // Fetch all designs for SKU / ID lookup
      const allDesigns = await db.query(`
        SELECT d.id, d.sku, d.title, d.price, d.sale_price, d.category_id, c.name AS category_name
        FROM designs d
        LEFT JOIN categories c ON d.category_id = c.id
        WHERE d.is_active >= 0
      `) || [];

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
            old_mrp: null,
            old_price: null,
            new_mrp: null,
            new_price: null,
            mrp_change_diff: 0,
            mrp_change_pct: 0,
            price_change_diff: 0,
            price_change_pct: 0,
            is_changed: false,
            status: 'error',
            error_message: `SKU / Design Code "${row.sku}" not found in database.`
          });
          continue;
        }

        const oldMrp = Number(matched.price || 0);
        const oldPrice = Number(matched.sale_price !== null && matched.sale_price !== undefined ? matched.sale_price : matched.price);

        let newMrp = row.mrpRaw !== '' ? Number(row.mrpRaw) : oldMrp;
        let newPrice = row.sellingRaw !== '' ? Number(row.sellingRaw) : oldPrice;

        let rowStatus = 'valid';
        let errorMessage = null;

        if (isNaN(newMrp) || newMrp < 0) {
          rowStatus = 'error';
          errorMessage = 'MRP must be a valid non-negative number.';
        } else if (isNaN(newPrice) || newPrice <= 0) {
          rowStatus = 'error';
          errorMessage = 'Selling price must be a positive number greater than 0.';
        } else if (newPrice > newMrp) {
          if (autoCapMrp) {
            newPrice = newMrp;
            rowStatus = 'warning';
            errorMessage = 'Selling price auto-capped to MRP.';
          } else {
            rowStatus = 'error';
            errorMessage = `Selling price (₹${newPrice}) cannot exceed MRP (₹${newMrp}).`;
          }
        }

        newMrp = Math.round(newMrp * 100) / 100;
        newPrice = Math.round(newPrice * 100) / 100;

        const isChanged = (newMrp !== oldMrp) || (newPrice !== oldPrice);
        if (rowStatus === 'valid' && !isChanged) {
          rowStatus = 'unchanged';
        }

        const mrpDiff = Math.round((newMrp - oldMrp) * 100) / 100;
        const mrpPct = oldMrp > 0 ? Math.round(((newMrp - oldMrp) / oldMrp) * 1000) / 10 : 0;
        const priceDiff = Math.round((newPrice - oldPrice) * 100) / 100;
        const pricePct = oldPrice > 0 ? Math.round(((newPrice - oldPrice) / oldPrice) * 1000) / 10 : 0;

        previewItems.push({
          rowNum: row.rowNum,
          design_id: matched.id,
          sku: matched.sku || `AED-${matched.id}`,
          title: matched.title,
          category_name: matched.category_name || 'General',
          old_mrp: oldMrp,
          old_price: oldPrice,
          new_mrp: newMrp,
          new_price: newPrice,
          mrp_change_diff: mrpDiff,
          mrp_change_pct: mrpPct,
          price_change_diff: priceDiff,
          price_change_pct: pricePct,
          is_changed: isChanged,
          status: rowStatus,
          error_message: errorMessage
        });
      }
    } else {
      // 2. Rule-based Bulk Price Calculation
      const targetDesigns = await this.getTargetDesigns({
        scope, selectedIds, categoryIds, status, formats, minPrice, maxPrice, skuRange, search
      }, selectedIds);

      for (let i = 0; i < targetDesigns.length; i++) {
        const d = targetDesigns[i];
        const oldMrp = Number(d.price || 0);
        const oldPrice = Number(d.sale_price !== null && d.sale_price !== undefined ? d.sale_price : d.price);

        let newMrp = oldMrp;
        let newPrice = oldPrice;

        if (targetField === 'sale_price') {
          newPrice = this.calculateSinglePrice({
            currentPrice: oldPrice,
            mrp: oldMrp,
            method,
            value,
            rounding,
            minGuard,
            maxGuard
          });
        } else if (targetField === 'price') {
          newMrp = this.calculateSinglePrice({
            currentPrice: oldMrp,
            mrp: oldMrp,
            method,
            value,
            rounding,
            minGuard,
            maxGuard
          });
        } else if (targetField === 'both') {
          if (method === 'discount_off_mrp') {
            newMrp = oldMrp;
            newPrice = this.calculateSinglePrice({
              currentPrice: oldPrice,
              mrp: oldMrp,
              method,
              value,
              rounding,
              minGuard,
              maxGuard
            });
          } else {
            newMrp = this.calculateSinglePrice({
              currentPrice: oldMrp,
              mrp: oldMrp,
              method,
              value,
              rounding,
              minGuard,
              maxGuard
            });
            newPrice = this.calculateSinglePrice({
              currentPrice: oldPrice,
              mrp: oldMrp,
              method,
              value,
              rounding,
              minGuard,
              maxGuard
            });
          }
        }

        let rowStatus = 'valid';
        let errorMessage = null;

        if (newPrice <= 0) {
          rowStatus = 'error';
          errorMessage = 'Selling price must be greater than 0.';
        } else if (newMrp <= 0) {
          rowStatus = 'error';
          errorMessage = 'MRP must be greater than 0.';
        } else if (newPrice > newMrp) {
          if (autoCapMrp) {
            newPrice = newMrp;
            rowStatus = 'warning';
            errorMessage = 'Selling price auto-capped to MRP.';
          } else {
            rowStatus = 'error';
            errorMessage = `Selling price (₹${newPrice}) cannot exceed MRP (₹${newMrp}).`;
          }
        }

        newMrp = Math.round(newMrp * 100) / 100;
        newPrice = Math.round(newPrice * 100) / 100;

        const isChanged = (newMrp !== oldMrp) || (newPrice !== oldPrice);
        if (rowStatus === 'valid' && !isChanged) {
          rowStatus = 'unchanged';
        }

        const mrpDiff = Math.round((newMrp - oldMrp) * 100) / 100;
        const mrpPct = oldMrp > 0 ? Math.round(((newMrp - oldMrp) / oldMrp) * 1000) / 10 : 0;
        const priceDiff = Math.round((newPrice - oldPrice) * 100) / 100;
        const pricePct = oldPrice > 0 ? Math.round(((newPrice - oldPrice) / oldPrice) * 1000) / 10 : 0;

        previewItems.push({
          rowNum: i + 1,
          design_id: d.id,
          sku: d.sku || `AED-${d.id}`,
          title: d.title,
          category_name: d.category_name || 'General',
          old_mrp: oldMrp,
          old_price: oldPrice,
          new_mrp: newMrp,
          new_price: newPrice,
          mrp_change_diff: mrpDiff,
          mrp_change_pct: mrpPct,
          price_change_diff: priceDiff,
          price_change_pct: pricePct,
          is_changed: isChanged,
          status: rowStatus,
          error_message: errorMessage
        });
      }
    }

    // Summary calculation
    const validItems = previewItems.filter(i => i.status === 'valid' || i.status === 'warning');
    const errorItems = previewItems.filter(i => i.status === 'error');
    const unchangedItems = previewItems.filter(i => i.status === 'unchanged');

    let sumOldPrice = 0;
    let sumNewPrice = 0;
    let sumOldMrp = 0;
    let sumNewMrp = 0;

    for (const item of validItems) {
      sumOldPrice += item.old_price;
      sumNewPrice += item.new_price;
      sumOldMrp += item.old_mrp;
      sumNewMrp += item.new_mrp;
    }

    const count = validItems.length;
    const avgOldPrice = count > 0 ? Math.round((sumOldPrice / count) * 100) / 100 : 0;
    const avgNewPrice = count > 0 ? Math.round((sumNewPrice / count) * 100) / 100 : 0;
    const avgOldMrp = count > 0 ? Math.round((sumOldMrp / count) * 100) / 100 : 0;
    const avgNewMrp = count > 0 ? Math.round((sumNewMrp / count) * 100) / 100 : 0;

    const priceChangePct = avgOldPrice > 0 ? Math.round(((avgNewPrice - avgOldPrice) / avgOldPrice) * 1000) / 10 : 0;

    return {
      summary: {
        totalDesigns: previewItems.length,
        validCount: validItems.length,
        errorCount: errorItems.length,
        unchangedCount: unchangedItems.length,
        avgOldPrice,
        avgNewPrice,
        avgOldMrp,
        avgNewMrp,
        priceChangePct
      },
      items: previewItems
    };
  }

  /**
   * Apply validated price updates safely in database transaction batches of 500
   */
  async applyPriceUpdate({ items, excludedIds = [], filterSummary = '', methodSummary = '', adminUser = null }) {
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error('No items provided for price update.');
    }

    const excludedSet = new Set((excludedIds || []).map(id => Number(id)));
    // Filter to valid/warning changed items that are not excluded
    const applicableItems = items.filter(i =>
      i.design_id &&
      !excludedSet.has(Number(i.design_id)) &&
      (i.status === 'valid' || i.status === 'warning') &&
      i.is_changed
    );

    if (applicableItems.length === 0) {
      throw new Error('No valid changed designs to update.');
    }

    const pool = db.pool();
    if (!pool) {
      throw new Error('Database pool unavailable.');
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // 1. Insert master log entry in price_update_logs
      const adminId = adminUser ? adminUser.id : null;
      const adminEmail = adminUser ? adminUser.email : 'Admin';

      const [logResult] = await connection.query(
        `INSERT INTO price_update_logs (admin_id, admin_email, filter_summary, method_summary, total_affected)
         VALUES (?, ?, ?, ?, ?)`,
        [adminId, adminEmail, filterSummary, methodSummary, applicableItems.length]
      );
      const logId = logResult.insertId;

      // 2. Process in batches of 500
      const BATCH_SIZE = 500;
      for (let i = 0; i < applicableItems.length; i += BATCH_SIZE) {
        const batch = applicableItems.slice(i, i + BATCH_SIZE);

        // A. Insert log items
        const itemValues = [];
        const itemPlaceholders = [];
        for (const item of batch) {
          itemPlaceholders.push('(?, ?, ?, ?, ?, ?, ?)');
          itemValues.push(
            logId,
            item.design_id,
            item.sku || null,
            item.old_mrp,
            item.old_price,
            item.new_mrp,
            item.new_price
          );
        }

        const logItemsSql = `
          INSERT INTO price_update_log_items (log_id, design_id, sku, old_mrp, old_price, new_mrp, new_price)
          VALUES ${itemPlaceholders.join(', ')}
        `;
        await connection.query(logItemsSql, itemValues);

        // B. Update designs table
        for (const item of batch) {
          await connection.query(
            `UPDATE designs
             SET price = ?, sale_price = ?, updated_at = NOW()
             WHERE id = ?`,
            [item.new_mrp, item.new_price, item.design_id]
          );
        }
      }

      await connection.commit();

      // Log in ActivityLog
      await ActivityLog.log({
        userId: adminId,
        adminName: adminEmail,
        action: 'bulk_price_update',
        entityType: 'design',
        entityId: logId,
        details: `Updated prices for ${applicableItems.length} design(s). Method: ${methodSummary}`
      });

      return {
        success: true,
        logId,
        totalAffected: applicableItems.length
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Undo a past price update
   * Restores old MRP and selling prices, checking if prices were changed since
   */
  async undoPriceUpdate(logId, adminUser = null, force = false) {
    const logRows = await db.query('SELECT * FROM price_update_logs WHERE id = ?', [logId]);
    if (!logRows || logRows.length === 0) {
      throw new Error(`Price update log #${logId} not found.`);
    }

    const log = logRows[0];
    if (log.is_undone) {
      throw new Error(`This price update (#${logId}) has already been undone on ${log.undone_at}.`);
    }

    const items = await db.query('SELECT * FROM price_update_log_items WHERE log_id = ?', [logId]) || [];
    if (items.length === 0) {
      throw new Error(`No item records found for price update log #${logId}.`);
    }

    // Check for conflict: has current price changed since this update?
    const designIds = items.map(it => it.design_id);
    const currentDesigns = await db.query(
      `SELECT id, sku, title, price, sale_price FROM designs WHERE id IN (${designIds.map(() => '?').join(',')})`,
      designIds
    ) || [];

    const currentMap = new Map();
    for (const d of currentDesigns) {
      currentMap.set(d.id, d);
    }

    const conflicts = [];
    for (const item of items) {
      const cur = currentMap.get(item.design_id);
      if (cur) {
        const curMrp = Number(cur.price);
        const curPrice = Number(cur.sale_price !== null && cur.sale_price !== undefined ? cur.sale_price : cur.price);
        const expectedMrp = Number(item.new_mrp);
        const expectedPrice = Number(item.new_price);

        if (curMrp !== expectedMrp || curPrice !== expectedPrice) {
          conflicts.push({
            design_id: item.design_id,
            sku: cur.sku,
            title: cur.title,
            current_mrp: curMrp,
            current_price: curPrice,
            log_new_mrp: expectedMrp,
            log_new_price: expectedPrice
          });
        }
      }
    }

    if (conflicts.length > 0 && !force) {
      return {
        success: false,
        requiresConfirmation: true,
        conflictCount: conflicts.length,
        conflicts,
        message: `${conflicts.length} design(s) have been modified by subsequent price updates or manual edits. Do you still want to force restore the previous prices?`
      };
    }

    const pool = db.pool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Restore old prices
      for (const item of items) {
        await connection.query(
          `UPDATE designs
           SET price = ?, sale_price = ?, updated_at = NOW()
           WHERE id = ?`,
          [item.old_mrp, item.old_price, item.design_id]
        );
      }

      // Mark log as undone
      await connection.query(
        'UPDATE price_update_logs SET is_undone = 1, undone_at = NOW() WHERE id = ?',
        [logId]
      );

      await connection.commit();

      const adminEmail = adminUser ? adminUser.email : 'Admin';
      await ActivityLog.log({
        userId: adminUser ? adminUser.id : null,
        adminName: adminEmail,
        action: 'undo_price_update',
        entityType: 'design',
        entityId: logId,
        details: `Reverted price update #${logId} for ${items.length} design(s).`
      });

      return {
        success: true,
        message: `Successfully restored previous prices for ${items.length} design(s).`,
        restoredCount: items.length
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Get paginated price update history
   */
  async getHistory({ page = 1, limit = 15 } = {}) {
    const offset = (page - 1) * limit;
    const countRes = await db.query('SELECT COUNT(*) AS total FROM price_update_logs');
    const total = countRes && countRes[0] ? countRes[0].total : 0;
    const totalPages = Math.ceil(total / limit) || 1;

    const logs = await db.query(
      `SELECT * FROM price_update_logs
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    ) || [];

    return {
      logs,
      total,
      totalPages,
      currentPage: page
    };
  }

  /**
   * Get details of a single price update log including item rows
   */
  async getHistoryDetail(logId) {
    const logRows = await db.query('SELECT * FROM price_update_logs WHERE id = ?', [logId]);
    if (!logRows || logRows.length === 0) {
      throw new Error(`Log #${logId} not found.`);
    }

    const items = await db.query(
      `SELECT li.*, d.title, d.price AS current_mrp, d.sale_price AS current_price
       FROM price_update_log_items li
       LEFT JOIN designs d ON li.design_id = d.id
       WHERE li.log_id = ?
       ORDER BY li.id ASC`,
      [logId]
    ) || [];

    return {
      log: logRows[0],
      items
    };
  }

  /**
   * Export price update log items as CSV
   */
  async exportHistoryCsv(logId) {
    const { log, items } = await this.getHistoryDetail(logId);

    const headers = [
      'Design ID',
      'SKU',
      'Design Title',
      'Old MRP (₹)',
      'Old Selling Price (₹)',
      'New MRP (₹)',
      'New Selling Price (₹)',
      'Price Change (₹)',
      'Price Change (%)',
      'Updated At'
    ];

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const lines = [headers.join(',')];

    for (const item of items) {
      const priceDiff = Math.round((item.new_price - item.old_price) * 100) / 100;
      const pricePct = item.old_price > 0 ? Math.round(((item.new_price - item.old_price) / item.old_price) * 1000) / 10 : 0;

      lines.push([
        escapeCsv(item.design_id),
        escapeCsv(item.sku || `AED-${item.design_id}`),
        escapeCsv(item.title || ''),
        escapeCsv(item.old_mrp),
        escapeCsv(item.old_price),
        escapeCsv(item.new_mrp),
        escapeCsv(item.new_price),
        escapeCsv(priceDiff >= 0 ? `+${priceDiff}` : priceDiff),
        escapeCsv(`${pricePct}%`),
        escapeCsv(item.created_at ? new Date(item.created_at).toISOString() : '')
      ].join(','));
    }

    return {
      filename: `price_update_log_${logId}_${Date.now()}.csv`,
      csv: lines.join('\r\n')
    };
  }
}

module.exports = new BulkPriceService();
