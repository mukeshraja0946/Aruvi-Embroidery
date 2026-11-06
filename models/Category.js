const path = require('path');
const fs = require('fs');
const db = require('../config/db');

const fallbackCategories = [
  { id: 1, name: 'Animals & Birds Design', slug: 'animals-birds-designs', description: '400+ Designs', image_url: '/public/images/cat_traditional.jpg', icon: 'fa-solid fa-dove', sort_order: 1, display_order: 1, show_on_home: 1, is_active: 1 },
  { id: 2, name: 'Blouse Designs', slug: 'blouse-designs', description: '300+ Designs', image_url: '/public/images/cat_blouse.jpg', icon: 'fa-solid fa-vest', sort_order: 2, display_order: 2, show_on_home: 1, is_active: 1 },
  { id: 3, name: 'Saree Designs', slug: 'saree-designs', description: '350+ Designs', image_url: '/public/images/cat_border.jpg', icon: 'fa-solid fa-wand-magic-sparkles', sort_order: 3, display_order: 3, show_on_home: 1, is_active: 1 },
  { id: 4, name: 'Shirt Designs', slug: 'shirt-designs', description: '250+ Designs', image_url: '/public/images/placeholder-preview.svg', icon: 'fa-solid fa-shirt', sort_order: 4, display_order: 4, show_on_home: 1, is_active: 1 },
  { id: 5, name: 'Shirt Logo Designs', slug: 'shirt-logo-designs', description: '300+ Designs', image_url: '/public/images/cat_monogram.jpg', icon: 'fa-solid fa-crown', sort_order: 5, display_order: 5, show_on_home: 1, is_active: 1 },
  { id: 6, name: 'T-Shirt Designs', slug: 't-shirt-designs', description: '500+ Designs', image_url: '/public/images/cat_kids.jpg', icon: 'fa-solid fa-shapes', sort_order: 6, display_order: 6, show_on_home: 1, is_active: 1 }
];

class Category {
  static async getAll({ sort = null, search = null, status = null, showOnHomeOnly = false, hideEmpty = false, parent = null } = {}) {
    if (db.isConnected()) {
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
        else if (sort === 'count') orderSql = 'ORDER BY design_count DESC, c.name ASC';
        else if (sort === 'newest') orderSql = 'ORDER BY c.id DESC';

        // Count ONLY active designs (d.is_active = 1) in a single grouped query
        const sql = `
          SELECT 
            c.*,
            COALESCE(c.sort_order, c.display_order, c.id, 0) AS final_order,
            (SELECT COUNT(*) FROM categories child WHERE child.parent_id = c.id) AS children_count,
            COUNT(DISTINCT d.id) AS design_count
          FROM categories c
          LEFT JOIN categories sub ON sub.parent_id = c.id
          LEFT JOIN designs d ON (d.category_id = c.id OR d.category_id = sub.id) AND d.is_active = 1
          ${whereClause}
          GROUP BY c.id
          ${orderSql}
        `;
        const rows = await db.query(sql, params);
        if (rows && Array.isArray(rows)) {
          let mapped = rows.map(r => ({
            ...r,
            icon: r.icon || 'fa-solid fa-shapes',
            card_image_key: r.card_image_key || null,
            image_url: r.card_image_key || r.image_url || null,
            sort_order: r.sort_order !== undefined ? r.sort_order : (r.display_order || r.id || 0),
            show_on_home: r.show_on_home !== undefined ? (r.show_on_home === 1 || r.show_on_home === true || r.show_on_home === '1') : true,
            is_active: r.is_active !== undefined ? (r.is_active === 1 || r.is_active === true || r.is_active === '1') : true,
            children_count: parseInt(r.children_count || 0, 10),
            has_children: parseInt(r.children_count || 0, 10) > 0,
            design_count: parseInt(r.design_count || 0, 10)
          }));
          if (hideEmpty) {
            mapped = mapped.filter(r => r.design_count > 0);
          }
          return mapped;
        }
      } catch (err) {
        console.warn('[Category.getAll] Primary query notice, falling back to minimal resilient query:', err.message);
        try {
          let minWhere = [];
          let minParams = [];
          if (search && search.trim()) {
            minWhere.push('c.name LIKE ?');
            minParams.push(`%${search.trim()}%`);
          }
          const whereStr = minWhere.length > 0 ? 'WHERE ' + minWhere.join(' AND ') : '';
          const minRows = await db.query(
            `SELECT c.id, c.name, c.slug, c.image_url, COUNT(d.id) AS design_count 
             FROM categories c 
             LEFT JOIN designs d ON c.id = d.category_id AND d.is_active = 1 
             ${whereStr} 
             GROUP BY c.id ORDER BY c.id ASC`,
            minParams
          );
          if (minRows && Array.isArray(minRows)) {
            let mappedMin = minRows.map(r => ({
              ...r,
              icon: 'fa-solid fa-shapes',
              show_on_home: true,
              is_active: true,
              children_count: 0,
              has_children: false,
              design_count: parseInt(r.design_count || 0, 10)
            }));
            if (hideEmpty) {
              mappedMin = mappedMin.filter(r => r.design_count > 0);
            }
            return mappedMin;
          }
        } catch (minErr) {
          console.error('[Category.getAll] Minimal fallback query failed:', minErr.message);
        }
      }
    }

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
    if (db.isConnected()) {
      try {
        const rows = await db.query('SELECT * FROM categories WHERE id = ? LIMIT 1', [id]);
        if (rows && rows[0]) return rows[0];
      } catch (err) {
        console.error('Category.getById DB error:', err.message);
      }
    }
    return fallbackCategories.find(c => c.id == id) || null;
  }

  static async getBySlug(slug) {
    if (!slug) return null;
    const cleanSlug = String(slug).trim().toLowerCase();
    if (db.isConnected()) {
      try {
        // 1. Direct exact slug match
        const exact = await db.query('SELECT * FROM categories WHERE slug = ? LIMIT 1', [cleanSlug]);
        if (exact && exact[0]) return exact[0];

        // 2. Flexible match for slug variants or category name
        const variations = await db.query(`
          SELECT * FROM categories 
          WHERE slug = ? 
             OR slug = ? 
             OR slug = ?
             OR slug LIKE ?
             OR LOWER(name) = ?
             OR LOWER(name) LIKE ?
          ORDER BY 
            (slug = ?) DESC,
            (slug = ?) DESC,
            (slug = ?) DESC,
            COALESCE(sort_order, display_order, id, 0) ASC
          LIMIT 1
        `, [
          cleanSlug,
          `${cleanSlug}-embroidery`,
          `${cleanSlug}-designs`,
          `${cleanSlug}%`,
          cleanSlug,
          `%${cleanSlug}%`,
          cleanSlug,
          `${cleanSlug}-embroidery`,
          `${cleanSlug}-designs`
        ]);
        if (variations && variations[0]) return variations[0];
      } catch (err) {
        console.error('Category.getBySlug DB error:', err.message);
      }
    }
    return fallbackCategories.find(c => 
      c.slug === cleanSlug || 
      c.slug === `${cleanSlug}-designs` ||
      c.slug === `${cleanSlug}-embroidery` ||
      (c.name && c.name.toLowerCase().includes(cleanSlug))
    ) || null;
  }

  static async create({ name, slug, description, image_url, card_image_key, icon = 'fa-solid fa-shapes', sort_order = 0, display_order = 0, show_on_home = 1, is_active = 1, parent_id = null }) {
    const finalOrder = parseInt(sort_order || display_order, 10) || 0;
    const isHome = (show_on_home === 0 || show_on_home === false || show_on_home === '0') ? 0 : 1;
    const activeVal = (is_active === 0 || is_active === false || is_active === '0') ? 0 : 1;
    const parentVal = (parent_id && !isNaN(parseInt(parent_id, 10)) && parseInt(parent_id, 10) > 0) ? parseInt(parent_id, 10) : null;

    if (db.isConnected()) {
      try {
        const res = await db.query(
          'INSERT INTO categories (name, slug, description, image_url, card_image_key, icon, sort_order, display_order, show_on_home, is_active, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [name, slug, description, image_url, card_image_key || image_url, icon || 'fa-solid fa-shapes', finalOrder, finalOrder, isHome, activeVal, parentVal]
        );
        return res.insertId;
      } catch (err) {
        try {
          const res = await db.query(
            'INSERT INTO categories (name, slug, description, image_url, icon, display_order, show_on_home) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, slug, description, image_url, icon || 'fa-solid fa-shapes', finalOrder, isHome]
          );
          return res.insertId;
        } catch (innerErr) {
          const res = await db.query(
            'INSERT INTO categories (name, slug, description, image_url, display_order) VALUES (?, ?, ?, ?, ?)',
            [name, slug, description, image_url, finalOrder]
          );
          return res.insertId;
        }
      }
    }
    const newId = fallbackCategories.length + 1;
    const item = { id: newId, name, slug, description, image_url, card_image_key, icon, sort_order: finalOrder, display_order: finalOrder, show_on_home: isHome, is_active: activeVal, parent_id: parentVal };
    fallbackCategories.push(item);
    return newId;
  }

  static async update(id, { name, slug, description, image_url, card_image_key, icon, sort_order, display_order, show_on_home, is_active, parent_id }) {
    const isHome = (show_on_home === 0 || show_on_home === false || show_on_home === '0') ? 0 : 1;
    const finalOrder = (sort_order !== undefined || display_order !== undefined) ? (parseInt(sort_order !== undefined ? sort_order : display_order, 10) || 0) : null;
    const activeVal = is_active !== undefined ? ((is_active === 0 || is_active === false || is_active === '0') ? 0 : 1) : null;
    const parentVal = parent_id !== undefined ? ((parent_id && !isNaN(parseInt(parent_id, 10)) && parseInt(parent_id, 10) > 0) ? parseInt(parent_id, 10) : null) : undefined;

    if (db.isConnected()) {
      try {
        await db.query(
          `UPDATE categories SET 
            name = ?, 
            slug = ?, 
            description = ?, 
            image_url = COALESCE(?, image_url), 
            card_image_key = COALESCE(?, card_image_key), 
            icon = COALESCE(?, icon), 
            sort_order = COALESCE(?, sort_order), 
            display_order = COALESCE(?, display_order), 
            show_on_home = ?, 
            is_active = COALESCE(?, is_active)
           WHERE id = ?`,
          [name, slug, description, image_url, card_image_key || image_url, icon || 'fa-solid fa-shapes', finalOrder, finalOrder, isHome, activeVal, id]
        );
        return true;
      } catch (err) {
        try {
          await db.query(
            'UPDATE categories SET name = ?, slug = ?, description = ?, image_url = COALESCE(?, image_url), icon = ?, display_order = COALESCE(?, display_order), show_on_home = ? WHERE id = ?',
            [name, slug, description, image_url, icon || 'fa-solid fa-shapes', finalOrder, isHome, id]
          );
          return true;
        } catch (innerErr) {
          await db.query(
            'UPDATE categories SET name = ?, slug = ?, description = ?, image_url = COALESCE(?, image_url), display_order = COALESCE(?, display_order) WHERE id = ?',
            [name, slug, description, image_url, finalOrder, id]
          );
          return true;
        }
      }
    }
    const cat = fallbackCategories.find(c => c.id == id);
    if (cat) {
      cat.name = name;
      cat.slug = slug;
      cat.description = description;
      if (image_url) cat.image_url = image_url;
      if (card_image_key) cat.card_image_key = card_image_key;
      if (icon) cat.icon = icon;
      if (finalOrder !== null) {
        cat.sort_order = finalOrder;
        cat.display_order = finalOrder;
      }
      if (show_on_home !== undefined) cat.show_on_home = isHome;
      if (activeVal !== null) cat.is_active = activeVal;
    }
    return true;
  }

  static async reorder(id, direction) {
    if (!['up', 'down'].includes(direction)) return false;
    if (db.isConnected()) {
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
        return true;
      } catch (err) {
        console.error('Category.reorder DB error:', err.message);
      }
    }
    const idx = fallbackCategories.findIndex(c => c.id == id);
    if (idx !== -1) {
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx >= 0 && swapIdx < fallbackCategories.length) {
        const tmp = fallbackCategories[idx];
        fallbackCategories[idx] = fallbackCategories[swapIdx];
        fallbackCategories[swapIdx] = tmp;
      }
    }
    return true;
  }

  static async delete(id) {
    if (db.isConnected()) {
      await db.query('DELETE FROM categories WHERE id = ?', [id]);
      return true;
    }
    const index = fallbackCategories.findIndex(c => c.id == id);
    if (index !== -1) fallbackCategories.splice(index, 1);
    return true;
  }

  static async toggleStatus(id) {
    if (db.isConnected()) {
      await db.query('UPDATE categories SET is_active = NOT is_active WHERE id = ?', [id]);
      const [row] = await db.query('SELECT is_active, name FROM categories WHERE id = ?', [id]);
      return row ? row.is_active : false;
    }
    const cat = fallbackCategories.find(c => c.id == id);
    if (cat) {
      cat.is_active = cat.is_active ? 0 : 1;
      return cat.is_active;
    }
    return false;
  }
}

module.exports = Category;
