const db = require('../config/db');

const fallbackCategories = [
  { id: 1, name: 'Floral Designs', slug: 'floral-designs', description: '500+ Designs', image_url: '/public/images/cat_floral.jpg', display_order: 1 },
  { id: 2, name: 'Monogram Designs', slug: 'monogram-designs', description: '300+ Designs', image_url: '/public/images/cat_monogram.jpg', display_order: 2 },
  { id: 3, name: 'Kids Designs', slug: 'kids-designs', description: '250+ Designs', image_url: '/public/images/cat_kids.jpg', display_order: 3 },
  { id: 4, name: 'Traditional Designs', slug: 'traditional-designs', description: '400+ Designs', image_url: '/public/images/cat_traditional.jpg', display_order: 4 },
  { id: 5, name: 'Border Designs', slug: 'border-designs', description: '350+ Designs', image_url: '/public/images/cat_border.jpg', display_order: 5 },
  { id: 6, name: 'Blouse Designs', slug: 'blouse-designs', description: '300+ Designs', image_url: '/public/images/cat_blouse.jpg', display_order: 6 },
  { id: 7, name: 'Animals & Birds', slug: 'animals-birds', description: '200+ Designs', image_url: '/public/images/cat_traditional.jpg', display_order: 7 },
  { id: 8, name: 'Festival Designs', slug: 'festival-designs', description: '250+ Designs', image_url: '/public/images/cat_floral.jpg', display_order: 8 }
];

class Category {
  static async getAll() {
    if (db.isConnected()) {
      return await db.query('SELECT c.*, COUNT(d.id) as design_count FROM categories c LEFT JOIN designs d ON c.id = d.category_id GROUP BY c.id ORDER BY c.display_order ASC, c.name ASC');
    }
    return fallbackCategories.map(cat => ({ ...cat, design_count: 3 }));
  }

  static async getById(id) {
    if (db.isConnected()) {
      const rows = await db.query('SELECT * FROM categories WHERE id = ? LIMIT 1', [id]);
      return rows[0] || null;
    }
    return fallbackCategories.find(c => c.id == id) || null;
  }

  static async getBySlug(slug) {
    if (db.isConnected()) {
      const rows = await db.query('SELECT * FROM categories WHERE slug = ? LIMIT 1', [slug]);
      return rows[0] || null;
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
}

module.exports = Category;
