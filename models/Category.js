const path = require('path');
const fs = require('fs');
const db = require('../config/db');

const fallbackCategories = [
  { id: 1, name: 'Animals & Birds Design', slug: 'animals-birds-designs', description: '400+ Designs', image_url: null, icon: 'fa-solid fa-dove', sort_order: 1, display_order: 1, show_on_home: 1, is_active: 1 },
  { id: 2, name: 'Blouse Designs', slug: 'blouse-designs', description: '300+ Designs', image_url: null, icon: 'fa-solid fa-vest', sort_order: 2, display_order: 2, show_on_home: 1, is_active: 1 },
  { id: 3, name: 'Saree Designs', slug: 'saree-designs', description: '350+ Designs', image_url: null, icon: 'fa-solid fa-wand-magic-sparkles', sort_order: 3, display_order: 3, show_on_home: 1, is_active: 1 },
  { id: 4, name: 'Shirt Designs', slug: 'shirt-designs', description: '250+ Designs', image_url: null, icon: 'fa-solid fa-shirt', sort_order: 4, display_order: 4, show_on_home: 1, is_active: 1 },
  { id: 5, name: 'Shirt Logo Designs', slug: 'shirt-logo-designs', description: '300+ Designs', image_url: null, icon: 'fa-solid fa-crown', sort_order: 5, display_order: 5, show_on_home: 1, is_active: 1 },
  { id: 6, name: 'T-Shirt Designs', slug: 't-shirt-designs', description: '500+ Designs', image_url: null, icon: 'fa-solid fa-shapes', sort_order: 6, display_order: 6, show_on_home: 1, is_active: 1 }
];

// In-Memory 60-Second Cache for Categories & Aggregated Counts
const categoryMemoryCache = new Map();
const CATEGORY_CACHE_TTL_MS = 60000; // 60 seconds

class Category {
  static invalidateCache() {
    categoryMemoryCache.clear();
  }

  /**
   * Retrieves all categories with active design counts and hierarchical subcategory aggregation.
   */
  static async getAll({ sort = null, search = null, status = null, showOnHomeOnly = false, hideEmpty = false, parent = null } = {}) {
    const cacheKey = JSON.stringify({ sort, search, status, showOnHomeOnly, hideEmpty, parent });
    const cachedEntry = categoryMemoryCache.get(cacheKey);
    const now = Date.now();

    if (cachedEntry && (now - cachedEntry.timestamp < CATEGORY_CACHE_TTL_MS)) {
      return [...cachedEntry.data];
    }

    try {
      let whereClauses = [];
      let params = [];
      if (status === 'active') {
        whereClauses.push('(c.is_active = 1 OR c.is_active IS NULL)');
      } else if (status === 'inactive') {
        whereClauses.push('c.is_active = 0');
      }
      if (showOnHomeOnly) {
        whereClauses.push('(c.show_on_home = 1 OR c.show_on_home IS NULL)');
      }
      if (parent === 'top') {
        whereClauses.push('(c.parent_id IS NULL OR c.parent_id = 0)');
      } else if (parent && !isNaN(parseInt(parent, 10))) {
        whereClauses.push('c.parent_id = ?');
        params.push(parseInt(parent, 10));
      } else if (parent && typeof parent === 'string') {
        whereClauses.push('c.parent_id = (SELECT p.id FROM categories p WHERE p.slug = ? LIMIT 1)');
        params.push(parent.trim());
      }
      if (search && search.trim()) {
        const q = `%${search.trim()}%`;
        whereClauses.push('(c.name LIKE ? OR c.description LIKE ?)');
        params.push(q, q);
      }
      const whereClause = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

      let orderSql = 'ORDER BY COALESCE(c.sort_order, c.display_order, c.id, 0) ASC, c.name ASC';
      if (sort === 'name') orderSql = 'ORDER BY c.name ASC';
      else if (sort === 'count') orderSql = 'ORDER BY c.name ASC'; // Sorted in JS after count aggregation
      else if (sort === 'newest') orderSql = 'ORDER BY c.id DESC';

      // 1. Fetch categories table
      const sql = `
        SELECT 
          c.*,
          COALESCE(c.sort_order, c.display_order, c.id, 0) AS final_order,
          (SELECT COUNT(*) FROM categories child WHERE child.parent_id = c.id) AS children_count
        FROM categories c
        ${whereClause}
        ${orderSql}
      `;
      const catRows = await db.query(sql, params, { timeout: 6000 });

      // 2. Fetch active design counts in ONE single indexed group query
      let countMap = new Map();
      try {
        const countRows = await db.query(
          `SELECT category_id, COUNT(*) AS cnt 
           FROM designs 
           WHERE (is_active = 1 OR is_active IS NULL) 
             AND deleted_at IS NULL 
             AND category_id IS NOT NULL 
           GROUP BY category_id`,
          [],
          { timeout: 4000 }
        );
        if (Array.isArray(countRows)) {
          countRows.forEach(r => countMap.set(Number(r.category_id), Number(r.cnt)));
        }
      } catch (countErr) {
        console.warn('[Category.getAll] Design count notice:', countErr.message);
      }

      if (catRows && Array.isArray(catRows) && catRows.length > 0) {
        // Pre-map child categories for fast hierarchical count rollup
        const childrenMap = new Map();
        catRows.forEach(c => {
          if (c.parent_id) {
            const pid = Number(c.parent_id);
            if (!childrenMap.has(pid)) childrenMap.set(pid, []);
            childrenMap.get(pid).push(Number(c.id));
          }
        });

        let mapped = catRows.map(r => {
          const catId = Number(r.id);
          let totalDesigns = countMap.get(catId) || 0;

          // Include subcategory designs if present
          const childIds = childrenMap.get(catId);
          if (childIds && Array.isArray(childIds)) {
            childIds.forEach(cid => {
              totalDesigns += (countMap.get(cid) || 0);
            });
          }

          return {
            ...r,
            icon: r.icon || 'fa-solid fa-shapes',
            card_image_key: r.card_image_key || null,
            image_url: r.card_image_key || r.image_url || null,
            sort_order: r.sort_order !== undefined ? r.sort_order : (r.display_order || r.id || 0),
            show_on_home: r.show_on_home !== undefined ? (r.show_on_home === 1 || r.show_on_home === true || r.show_on_home === '1') : true,
            is_active: r.is_active !== undefined ? (r.is_active === 1 || r.is_active === true || r.is_active === '1') : true,
            children_count: parseInt(r.children_count || 0, 10),
            has_children: parseInt(r.children_count || 0, 10) > 0,
            design_count: totalDesigns
          };
        });

        if (sort === 'count') {
          mapped.sort((a, b) => b.design_count - a.design_count);
        }

        if (hideEmpty) {
          mapped = mapped.filter(r => r.design_count > 0);
        }

        // Cache database results in memory
        categoryMemoryCache.set(cacheKey, { timestamp: now, data: mapped });
        return mapped;
      }
    } catch (err) {
      console.warn('[Category.getAll] Database query notice, checking stale cache / fallback:', err.message);
      if (cachedEntry) {
        return [...cachedEntry.data];
      }
    }

    // Fallback mode ONLY when DB is completely unreachable
    let fallbackCounts = {};
    try {
      const fbPath = path.join(__dirname, '..', 'public', 'uploads', 'fallback_designs.json');
      if (fs.existsSync(fbPath)) {
        const raw = fs.readFileSync(fbPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach(d => {
            const cid = d.category_id;
            if (cid) fallbackCounts[cid] = (fallbackCounts[cid] || 0) + 1;
          });
        }
      }
    } catch (_) {}

    let list = fallbackCategories.map(cat => ({
      ...cat,
      icon: cat.icon || 'fa-solid fa-shapes',
      card_image_key: cat.card_image_key || null,
      sort_order: cat.sort_order || cat.display_order || cat.id,
      show_on_home: cat.show_on_home !== undefined ? cat.show_on_home : 1,
      is_active: cat.is_active !== undefined ? cat.is_active : 1,
      children_count: 0,
      has_children: false,
      design_count: fallbackCounts[cat.id] || 0
    }));
    if (status === 'active') list = list.filter(c => c.is_active === 1);
    else if (status === 'inactive') list = list.filter(c => c.is_active === 0);
    if (showOnHomeOnly) list = list.filter(c => c.show_on_home === 1 || c.show_on_home === true);
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(c => (c.name && c.name.toLowerCase().includes(q)) || (c.description && c.description.toLowerCase().includes(q)));
    }
    if (hideEmpty) list = list.filter(c => (c.design_count || 0) > 0);
    if (sort === 'name') list.sort((a,b) => (a.name || '').localeCompare(b.name || ''));
    else if (sort === 'count') list.sort((a,b) => (b.design_count || 0) - (a.design_count || 0));
    else if (sort === 'newest') list.sort((a,b) => (b.id || 0) - (a.id || 0));
    return list;
  }

  static async getById(id) {
    if (!id) return null;
    try {
      const rows = await db.query('SELECT * FROM categories WHERE id = ? LIMIT 1', [id]);
      if (rows && rows[0]) return rows[0];
    } catch (err) {
      console.warn('Category.getById DB notice:', err.message);
    }
    return fallbackCategories.find(c => c.id == id) || null;
  }

  static async getBySlug(slug) {
    if (!slug) return null;
    const cleanSlug = String(slug).trim().toLowerCase();
    try {
      const rows = await db.query('SELECT * FROM categories WHERE slug = ? LIMIT 1', [cleanSlug]);
      if (rows && rows[0]) return rows[0];
    } catch (err) {
      console.warn('Category.getBySlug DB notice:', err.message);
    }
    return fallbackCategories.find(c => 
      c.slug === cleanSlug || 
      c.slug === `${cleanSlug}-designs` ||
      c.slug === `${cleanSlug}-embroidery` ||
      (c.name && c.name.toLowerCase().includes(cleanSlug))
    ) || null;
  }

  /**
   * Retrieves 301 SEO redirect destination if slug has changed.
   */
  static async getRedirectSlug(oldSlug) {
    if (!oldSlug) return null;
    try {
      const rows = await db.query(
        'SELECT new_slug FROM category_slug_redirects WHERE old_slug = ? LIMIT 1',
        [oldSlug.trim().toLowerCase()]
      );
      if (rows && rows[0] && rows[0].new_slug) {
        return rows[0].new_slug;
      }
    } catch (_) {}
    return null;
  }

  /**
   * Checks whether a slug is already in use by another category.
   */
  static async isSlugTaken(slug, excludeId = null) {
    if (!slug) return false;
    try {
      let sql = 'SELECT id FROM categories WHERE slug = ?';
      let params = [slug.trim().toLowerCase()];
      if (excludeId) {
        sql += ' AND id != ?';
        params.push(parseInt(excludeId, 10));
      }
      const rows = await db.query(sql, params);
      return Array.isArray(rows) && rows.length > 0;
    } catch (_) {
      return false;
    }
  }

  /**
   * Counts active designs linked to a specific category.
   */
  static async getDesignCount(categoryId) {
    if (!categoryId) return 0;
    try {
      const rows = await db.query(
        'SELECT COUNT(*) as cnt FROM designs WHERE category_id = ? AND deleted_at IS NULL',
        [categoryId]
      );
      return (rows && rows[0] && rows[0].cnt) ? parseInt(rows[0].cnt, 10) : 0;
    } catch (_) {
      return 0;
    }
  }

  /**
   * Reassigns all designs from one category to another.
   */
  static async reassignDesigns(fromCategoryId, toCategoryId) {
    const fromId = parseInt(fromCategoryId, 10);
    const toId = parseInt(toCategoryId, 10);
    if (!fromId || !toId || fromId === toId) return 0;
    try {
      const res = await db.query(
        'UPDATE designs SET category_id = ? WHERE category_id = ?',
        [toId, fromId]
      );
      Category.invalidateCache();
      return res.affectedRows || 0;
    } catch (err) {
      console.error('Error reassigning designs:', err);
      throw err;
    }
  }

  static async create({ name, slug, description, image_url, card_image_key, icon = 'fa-solid fa-shapes', sort_order = 0, display_order = 0, show_on_home = 1, is_active = 1, parent_id = null }) {
    const finalOrder = parseInt(sort_order || display_order, 10) || 0;
    const isHome = (show_on_home === 0 || show_on_home === false || show_on_home === '0') ? 0 : 1;
    const activeVal = (is_active === 0 || is_active === false || is_active === '0') ? 0 : 1;
    const parentVal = (parent_id && !isNaN(parseInt(parent_id, 10)) && parseInt(parent_id, 10) > 0) ? parseInt(parent_id, 10) : null;

    try {
      const res = await db.query(
        'INSERT INTO categories (name, slug, description, image_url, card_image_key, icon, sort_order, display_order, show_on_home, is_active, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [name, slug, description, image_url, card_image_key || image_url, icon || 'fa-solid fa-shapes', finalOrder, finalOrder, isHome, activeVal, parentVal]
      );
      Category.invalidateCache();
      return res.insertId;
    } catch (err) {
      try {
        const res = await db.query(
          'INSERT INTO categories (name, slug, description, image_url, icon, display_order, show_on_home) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [name, slug, description, image_url, icon || 'fa-solid fa-shapes', finalOrder, isHome]
        );
        Category.invalidateCache();
        return res.insertId;
      } catch (innerErr) {
        const res = await db.query(
          'INSERT INTO categories (name, slug, description, image_url, display_order) VALUES (?, ?, ?, ?, ?)',
          [name, slug, description, image_url, finalOrder]
        );
        Category.invalidateCache();
        return res.insertId;
      }
    }
  }

  static async update(id, { name, slug, description, image_url, card_image_key, icon, sort_order, display_order, show_on_home, is_active, parent_id }) {
    const isHome = (show_on_home === 0 || show_on_home === false || show_on_home === '0') ? 0 : 1;
    const finalOrder = (sort_order !== undefined || display_order !== undefined) ? (parseInt(sort_order !== undefined ? sort_order : display_order, 10) || 0) : null;
    const activeVal = is_active !== undefined ? ((is_active === 0 || is_active === false || is_active === '0') ? 0 : 1) : null;

    // Track old values for 301 SEO redirects and image cleanup
    let oldCategory = null;
    try {
      oldCategory = await this.getById(id);
    } catch (_) {}

    let imageClause = '';
    let imageParams = [];
    if (image_url === '__REMOVE__' || image_url === '') {
      imageClause = 'image_url = NULL, card_image_key = NULL,';
    } else if (image_url !== undefined && image_url !== null) {
      imageClause = 'image_url = ?, card_image_key = ?,';
      imageParams.push(image_url, card_image_key || image_url);
    }

    try {
      await db.query(
        `UPDATE categories SET 
          name = ?, 
          slug = ?, 
          description = ?, 
          ${imageClause}
          icon = COALESCE(?, icon), 
          sort_order = COALESCE(?, sort_order), 
          display_order = COALESCE(?, display_order), 
          show_on_home = ?, 
          is_active = COALESCE(?, is_active)
         WHERE id = ?`,
        [name, slug, description, ...imageParams, icon || 'fa-solid fa-shapes', finalOrder, finalOrder, isHome, activeVal, id]
      );

      // Handle 301 slug redirect when slug changes
      if (oldCategory && oldCategory.slug && slug && oldCategory.slug.toLowerCase() !== slug.toLowerCase()) {
        try {
          await db.query(
            `INSERT INTO category_slug_redirects (category_id, old_slug, new_slug) 
             VALUES (?, ?, ?) 
             ON DUPLICATE KEY UPDATE new_slug = VALUES(new_slug)`,
            [id, oldCategory.slug.toLowerCase(), slug.toLowerCase()]
          );
          // Chain existing redirects to new slug
          await db.query(
            'UPDATE category_slug_redirects SET new_slug = ? WHERE new_slug = ?',
            [slug.toLowerCase(), oldCategory.slug.toLowerCase()]
          );
        } catch (redirErr) {
          console.warn('[Category.update] Redirect tracking notice:', redirErr.message);
        }
      }

      Category.invalidateCache();
      return {
        success: true,
        oldImageToRetire: (oldCategory && oldCategory.image_url && image_url !== undefined && oldCategory.image_url !== image_url) ? oldCategory.image_url : null
      };
    } catch (err) {
      try {
        let fallbackImageClause = '';
        let fallbackImageParams = [];
        if (image_url === '__REMOVE__' || image_url === '') {
          fallbackImageClause = 'image_url = NULL,';
        } else if (image_url !== undefined && image_url !== null) {
          fallbackImageClause = 'image_url = ?,';
          fallbackImageParams.push(image_url);
        }
        await db.query(
          `UPDATE categories SET name = ?, slug = ?, description = ?, ${fallbackImageClause} icon = ?, display_order = COALESCE(?, display_order), show_on_home = ? WHERE id = ?`,
          [name, slug, description, ...fallbackImageParams, icon || 'fa-solid fa-shapes', finalOrder, isHome, id]
        );
        Category.invalidateCache();
        return { success: true, oldImageToRetire: null };
      } catch (innerErr) {
        await db.query(
          'UPDATE categories SET name = ?, slug = ?, description = ?, display_order = COALESCE(?, display_order) WHERE id = ?',
          [name, slug, description, finalOrder, id]
        );
        Category.invalidateCache();
        return { success: true, oldImageToRetire: null };
      }
    }
  }

  static async reorder(id, direction) {
    if (!['up', 'down'].includes(direction)) return false;
    try {
      const rows = await db.query(
        'SELECT id, COALESCE(sort_order, display_order, id, 0) AS ord FROM categories ORDER BY ord ASC, id ASC'
      );
      if (!rows || rows.length === 0) return false;
      const targetId = parseInt(id, 10);
      const currentIndex = rows.findIndex(r => r.id === targetId);
      if (currentIndex === -1) return false;

      const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (swapIndex < 0 || swapIndex >= rows.length) return false;

      const currentCat = rows[currentIndex];
      const swapCat = rows[swapIndex];

      let ordCurrent = currentCat.ord;
      let ordSwap = swapCat.ord;

      if (ordCurrent === ordSwap) {
        ordCurrent = currentIndex * 10;
        ordSwap = swapIndex * 10;
      }

      await db.query('UPDATE categories SET sort_order = ?, display_order = ? WHERE id = ?', [ordSwap, ordSwap, currentCat.id]);
      await db.query('UPDATE categories SET sort_order = ?, display_order = ? WHERE id = ?', [ordCurrent, ordCurrent, swapCat.id]);
      Category.invalidateCache();
      return true;
    } catch (err) {
      console.error('Category.reorder DB error:', err.message);
      return false;
    }
  }

  static async delete(id) {
    try {
      await db.query('DELETE FROM categories WHERE id = ?', [id]);
      try {
        await db.query('DELETE FROM category_slug_redirects WHERE category_id = ?', [id]);
      } catch (_) {}
      Category.invalidateCache();
      return true;
    } catch (err) {
      console.error('Category.delete error:', err);
      throw err;
    }
  }

  static async toggleStatus(id) {
    try {
      await db.query('UPDATE categories SET is_active = NOT COALESCE(is_active, 1) WHERE id = ?', [id]);
      const rows = await db.query('SELECT is_active FROM categories WHERE id = ?', [id]);
      Category.invalidateCache();
      return rows && rows[0] ? (rows[0].is_active === 1 || rows[0].is_active === true) : false;
    } catch (err) {
      console.error('Category.toggleStatus error:', err);
      return false;
    }
  }

  static async toggleHome(id) {
    try {
      await db.query('UPDATE categories SET show_on_home = NOT COALESCE(show_on_home, 1) WHERE id = ?', [id]);
      const rows = await db.query('SELECT show_on_home FROM categories WHERE id = ?', [id]);
      Category.invalidateCache();
      return rows && rows[0] ? (rows[0].show_on_home === 1 || rows[0].show_on_home === true) : false;
    } catch (err) {
      console.error('Category.toggleHome error:', err);
      return false;
    }
  }
}

module.exports = Category;
