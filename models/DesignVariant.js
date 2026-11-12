const db = require('../config/db');

class DesignVariant {
  /**
   * Retrieves all active variants for a design (used for customer display, cart, and checkout)
   */
  static async getByDesignId(designId) {
    if (!designId) return [];
    if (db.isConnected()) {
      try {
        const sql = `
          SELECT dfv.*, df.storage_key as file_storage_key, df.file_path, df.file_name as file_actual_name
          FROM design_file_variants dfv
          LEFT JOIN design_files df ON dfv.file_id = df.id
          WHERE dfv.design_id = ? AND dfv.is_active = 1
          ORDER BY dfv.sort_order ASC, dfv.id ASC
        `;
        const rows = await db.query(sql, [designId]);
        return Array.isArray(rows) ? rows : [];
      } catch (err) {
        console.error('[DesignVariant.getByDesignId Error]:', err.message);
        return [];
      }
    }
    return [];
  }

  /**
   * Retrieves all variants (including inactive) for admin design edit form
   */
  static async getAllByDesignId(designId) {
    if (!designId) return [];
    if (db.isConnected()) {
      try {
        const sql = `
          SELECT dfv.*, df.storage_key as file_storage_key, df.file_path, df.file_name as file_actual_name
          FROM design_file_variants dfv
          LEFT JOIN design_files df ON dfv.file_id = df.id
          WHERE dfv.design_id = ?
          ORDER BY dfv.sort_order ASC, dfv.id ASC
        `;
        const rows = await db.query(sql, [designId]);
        return Array.isArray(rows) ? rows : [];
      } catch (err) {
        console.error('[DesignVariant.getAllByDesignId Error]:', err.message);
        return [];
      }
    }
    return [];
  }

  /**
   * Retrieves a single variant by its primary key
   */
  static async getById(id) {
    if (!id) return null;
    if (db.isConnected()) {
      try {
        const rows = await db.query(
          `SELECT dfv.*, df.storage_key as file_storage_key, df.file_path, df.file_name as file_actual_name
           FROM design_file_variants dfv
           LEFT JOIN design_files df ON dfv.file_id = df.id
           WHERE dfv.id = ? LIMIT 1`,
          [id]
        );
        return rows[0] || null;
      } catch (err) {
        console.error('[DesignVariant.getById Error]:', err.message);
        return null;
      }
    }
    return null;
  }

  /**
   * Creates a new variant record
   */
  static async create({
    design_id,
    variant_name,
    variant_group = null,
    file_id = null,
    storage_key = null,
    file_name = null,
    original_name = null,
    file_size = 0,
    file_format = null,
    sort_order = 0,
    is_active = 1
  }) {
    if (db.isConnected()) {
      const res = await db.query(
        `INSERT INTO design_file_variants 
         (design_id, variant_name, variant_group, file_id, storage_key, file_name, original_name, file_size, file_format, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          design_id,
          variant_name,
          variant_group || null,
          file_id || null,
          storage_key || null,
          file_name || null,
          original_name || null,
          file_size || 0,
          file_format || null,
          sort_order || 0,
          is_active ? 1 : 0
        ]
      );
      return { id: res.insertId, insertId: res.insertId };
    }
    return null;
  }

  /**
   * Updates an existing variant record
   */
  static async update(id, data) {
    if (!id || !db.isConnected()) return false;
    const fields = [];
    const params = [];

    const allowed = [
      'variant_name', 'variant_group', 'file_id', 'storage_key',
      'file_name', 'original_name', 'file_size', 'file_format',
      'sort_order', 'is_active'
    ];

    for (const key of allowed) {
      if (data[key] !== undefined) {
        fields.push(`\`${key}\` = ?`);
        params.push(data[key]);
      }
    }

    if (fields.length === 0) return true;
    params.push(id);
    await db.query(`UPDATE design_file_variants SET ${fields.join(', ')} WHERE id = ?`, params);
    return true;
  }

  /**
   * Deletes a variant by ID
   */
  static async delete(id) {
    if (!id || !db.isConnected()) return false;
    await db.query('DELETE FROM design_file_variants WHERE id = ?', [id]);
    return true;
  }

  /**
   * Deletes all variants for a given design ID
   */
  static async deleteByDesignId(designId) {
    if (!designId || !db.isConnected()) return false;
    await db.query('DELETE FROM design_file_variants WHERE design_id = ?', [designId]);
    return true;
  }
}

module.exports = DesignVariant;
