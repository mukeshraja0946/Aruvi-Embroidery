const db = require('../config/db');

const fallbackCategories = [
  { id: 1, name: 'Animals & Birds Design', slug: 'animals-birds-designs', description: '400+ Designs', image_url: '/public/images/cat_traditional.jpg', display_order: 1 },
  { id: 2, name: 'Blouse Designs', slug: 'blouse-designs', description: '300+ Designs', image_url: '/public/images/cat_blouse.jpg', display_order: 2 },
  { id: 3, name: 'Saree Designs', slug: 'saree-designs', description: '350+ Designs', image_url: '/public/images/cat_border.jpg', display_order: 3 },
  { id: 4, name: 'Shirt Designs', slug: 'shirt-designs', description: '250+ Designs', image_url: '/public/images/cat_floral.jpg', display_order: 4 },
  { id: 5, name: 'Shirt Logo Designs', slug: 'shirt-logo-designs', description: '300+ Designs', image_url: '/public/images/cat_monogram.jpg', display_order: 5 },
  { id: 6, name: 'T-Shirt Designs', slug: 't-shirt-designs', description: '500+ Designs', image_url: '/public/images/cat_kids.jpg', display_order: 6 }
];

class Category {
  static async getAll({ sort = null, search = null, status = null } = {}) {
    if (db.isConnected()) {
      try {
        let whereClauses = [];
        let params = [];
        if (status === 'active') {
          whereClauses.push('c.is_active = 1');
        } else if (status === 'inactive') {
          whereClauses.push('c.is_active = 0');
        }
        if (search && search.trim()) {
          const q = `%${search.trim()}%`;
          whereClauses.push('(c.name LIKE ? OR c.description LIKE ?)');
          params.push(q, q);
        }
        const whereClause = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

        let orderSql = 'ORDER BY c.display_order ASC, c.name ASC';
        if (sort === 'name') orderSql = 'ORDER BY c.name ASC';
        else if (sort === 'count') orderSql = 'ORDER BY design_count DESC';
        else if (sort === 'newest') orderSql = 'ORDER BY c.id DESC';

        const sql = `SELECT c.*, COUNT(d.id) as design_count FROM categories c LEFT JOIN designs d ON c.id = d.category_id ${whereClause} GROUP BY c.id ${orderSql}`;
        const rows = await db.query(sql, params);
        if (rows && Array.isArray(rows)) return rows;
      } catch (err) {
        console.error('Category.getAll DB error:', err.message);
      }
    }
    let list = fallbackCategories.map(cat => ({ ...cat, is_active: cat.is_active !== undefined ? cat.is_active : 1, design_count: 0 }));
    if (status === 'active') list = list.filter(c => c.is_active === 1);
    else if (status === 'inactive') list = list.filter(c => c.is_active === 0);
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(c => (c.name && c.name.toLowerCase().includes(q)) || (c.description && c.description.toLowerCase().includes(q)));
    }
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
    if (db.isConnected()) {
      try {
        const rows = await db.query('SELECT * FROM categories WHERE slug = ? LIMIT 1', [slug]);
        if (rows && rows[0]) return rows[0];
      } catch (err) {
        console.error('Category.getBySlug DB error:', err.message);
      }
    }
    return fallbackCategories.find(c => c.slug === slug) || null;
  }

  static async create({ name, slug, description, image_url, display_order = 0 }) {
    if (db.isConnected()) {
      const res = await db.query(
        'INSERT INTO categories (name, slug, description, image_url, display_order) VALUES (?, ?, ?, ?, ?)',
        [name, slug, description, image_url, display_order]
      );
      return res.insertId;
    }
    const newId = fallbackCategories.length + 1;
    const item = { id: newId, name, slug, description, image_url, display_order };
    fallbackCategories.push(item);
    return newId;
  }

  static async update(id, { name, slug, description, image_url, display_order }) {
    if (db.isConnected()) {
      await db.query(
        'UPDATE categories SET name = ?, slug = ?, description = ?, image_url = COALESCE(?, image_url), display_order = ? WHERE id = ?',
        [name, slug, description, image_url, display_order, id]
      );
      return true;
    }
    const cat = fallbackCategories.find(c => c.id == id);
    if (cat) {
      cat.name = name;
      cat.slug = slug;
      cat.description = description;
      if (image_url) cat.image_url = image_url;
      cat.display_order = display_order;
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
