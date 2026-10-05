const db = require('../config/db');

const fallbackDesigns = [
  {
    id: 1,
    title: 'Rose Floral Design',
    sku: 'ARV-FL-001',
    slug: 'rose-floral-design',
    price: 399.00,
    sale_price: 299.00,
    discount_pct: 25,
    category_id: 1,
    category_name: 'Floral Designs',
    category_slug: 'floral-designs',
    hoop_size: '5x7 inch (130x180 mm)',
    stitch_count: 24800,
    dimensions: '140mm x 180mm',
    formats: 'DST, PES, JEF, EXP',
    is_featured: 1,
    is_trending: 1,
    is_active: 1,
    download_count: 256,
    tags: 'rose, floral, blouse, saree, flower',
    total_sales: 120,
    average_rating: 4.80,
    reviews_count: 120,
    primary_image: '/public/images/cat_floral.jpg',
    images: [{ id: 1, image_url: '/public/images/cat_floral.jpg', is_primary: 1 }],
    files: [
      { id: 1, file_name: 'rose_design.dst', file_path: '/public/uploads/designs/sample_peacock.zip', file_format: 'DST', file_size: 2400000 },
      { id: 2, file_name: 'rose_design.pes', file_path: '/public/uploads/designs/sample_peacock.zip', file_format: 'PES', file_size: 1800000 },
      { id: 3, file_name: 'rose_design.jef', file_path: '/public/uploads/designs/sample_peacock.zip', file_format: 'JEF', file_size: 1600000 },
      { id: 4, file_name: 'rose_design.exp', file_path: '/public/uploads/designs/sample_peacock.zip', file_format: 'EXP', file_size: 2100000 }
    ]
  },
  {
    id: 2,
    title: 'Lotus Mandala',
    sku: 'ARV-TM-002',
    slug: 'lotus-mandala',
    price: 449.00,
    sale_price: 349.00,
    discount_pct: 22,
    category_id: 4,
    category_name: 'Traditional Designs',
    category_slug: 'traditional-designs',
    hoop_size: '7x7 inch (180x180 mm)',
    stitch_count: 31200,
    dimensions: '170mm x 170mm',
    formats: 'DST, PES, JEF, EXP',
    is_featured: 1,
    is_trending: 0,
    is_active: 1,
    download_count: 185,
    tags: 'lotus, mandala, traditional, saree',
    total_sales: 85,
    average_rating: 4.90,
    reviews_count: 85,
    primary_image: '/public/images/cat_traditional.jpg',
    images: [{ id: 2, image_url: '/public/images/cat_traditional.jpg', is_primary: 1 }],
    files: [{ id: 5, file_name: 'Lotus_Mandala.zip', file_path: '/public/uploads/designs/sample_ganesha.zip', file_format: 'ZIP', file_size: 1890432 }]
  },
  {
    id: 3,
    title: 'Butterfly Floral',
    sku: 'ARV-KD-003',
    slug: 'butterfly-floral',
    price: 299.00,
    sale_price: 249.00,
    discount_pct: 17,
    category_id: 3,
    category_name: 'Kids Designs',
    category_slug: 'kids-designs',
    hoop_size: '6x6 inch (150x150 mm)',
    stitch_count: 19500,
    dimensions: '145mm x 145mm',
    formats: 'DST, PES, JEF, EXP',
    is_featured: 1,
    is_trending: 1,
    is_active: 1,
    download_count: 140,
    tags: 'butterfly, kids, floral, dress',
    total_sales: 64,
    average_rating: 4.70,
    reviews_count: 64,
    primary_image: '/public/images/cat_kids.jpg',
    images: [{ id: 3, image_url: '/public/images/cat_kids.jpg', is_primary: 1 }],
    files: [{ id: 6, file_name: 'Butterfly_Floral.zip', file_path: '/public/uploads/designs/sample_lotus.zip', file_format: 'ZIP', file_size: 1420980 }]
  },
  {
    id: 4,
    title: 'Letter A Monogram',
    sku: 'ARV-MG-004',
    slug: 'letter-a-monogram',
    price: 249.00,
    sale_price: 199.00,
    discount_pct: 20,
    category_id: 2,
    category_name: 'Monogram Designs',
    category_slug: 'monogram-designs',
    hoop_size: '4x4 inch (100x100 mm)',
    stitch_count: 12400,
    dimensions: '95mm x 95mm',
    formats: 'DST, PES, JEF, EXP',
    is_featured: 1,
    is_trending: 0,
    is_active: 1,
    download_count: 195,
    tags: 'monogram, letter, alphabet, royal',
    total_sales: 95,
    average_rating: 4.90,
    reviews_count: 95,
    primary_image: '/public/images/cat_monogram.jpg',
    images: [{ id: 4, image_url: '/public/images/cat_monogram.jpg', is_primary: 1 }],
    files: [{ id: 7, file_name: 'Letter_A_Monogram.zip', file_path: '/public/uploads/designs/sample_elephant.zip', file_format: 'ZIP', file_size: 1650320 }]
  },
  {
    id: 5,
    title: 'Peacock Design',
    sku: 'ARV-TD-005',
    slug: 'peacock-design',
    price: 499.00,
    sale_price: 399.00,
    discount_pct: 20,
    category_id: 4,
    category_name: 'Traditional Designs',
    category_slug: 'traditional-designs',
    hoop_size: '8x10 inch (200x250 mm)',
    stitch_count: 42500,
    dimensions: '190mm x 240mm',
    formats: 'DST, PES, JEF, EXP',
    is_featured: 1,
    is_trending: 1,
    is_active: 1,
    download_count: 310,
    tags: 'peacock, bridal, traditional, neck',
    total_sales: 142,
    average_rating: 5.00,
    reviews_count: 142,
    primary_image: '/public/images/cat_traditional.jpg',
    images: [{ id: 5, image_url: '/public/images/cat_traditional.jpg', is_primary: 1 }],
    files: [{ id: 8, file_name: 'Peacock_Design.zip', file_path: '/public/uploads/designs/sample_floral.zip', file_format: 'ZIP', file_size: 2980450 }]
  },
  {
    id: 6,
    title: 'Border Pattern',
    sku: 'ARV-BD-006',
    slug: 'border-pattern',
    price: 349.00,
    sale_price: 299.00,
    discount_pct: 14,
    category_id: 5,
    category_name: 'Border Designs',
    category_slug: 'border-designs',
    hoop_size: '5x8 inch (130x200 mm)',
    stitch_count: 22100,
    dimensions: '120mm x 195mm',
    formats: 'DST, PES, JEF, EXP',
    is_featured: 1,
    is_trending: 0,
    is_active: 1,
    download_count: 178,
    tags: 'border, cutwork, saree, dupatta',
    total_sales: 78,
    average_rating: 4.85,
    reviews_count: 78,
    primary_image: '/public/images/cat_border.jpg',
    images: [{ id: 6, image_url: '/public/images/cat_border.jpg', is_primary: 1 }],
    files: [{ id: 9, file_name: 'Border_Pattern.zip', file_path: '/public/uploads/designs/sample_radha.zip', file_format: 'ZIP', file_size: 2110540 }]
  }
];

class Design {
  static async getAll({
    search = '',
    category_id = null,
    category_slug = null,
    format = null,
    min_price = null,
    max_price = null,
    min_rating = null,
    sort = 'newest',
    page = 1,
    limit = 12,
    is_active_only = true,
    is_featured = null,
    is_trending = null,
    status = null
  } = {}) {
    if (db.isConnected()) {
      let whereClause = [];
      let params = [];

      if (is_active_only) {
        whereClause.push('d.is_active = 1');
      } else if (status === 'active') {
        whereClause.push('d.is_active = 1');
      } else if (status === 'inactive' || status === 'draft') {
        whereClause.push('d.is_active = 0');
      }

      if (is_featured !== null && is_featured !== undefined) {
        whereClause.push('d.is_featured = ?');
        params.push(is_featured ? 1 : 0);
      }

      if (is_trending !== null && is_trending !== undefined) {
        whereClause.push('d.is_trending = ?');
        params.push(is_trending ? 1 : 0);
      }

      if (search) {
        whereClause.push('(d.title LIKE ? OR d.sku LIKE ? OR d.tags LIKE ? OR d.formats LIKE ?)');
        const searchPattern = `%${search}%`;
        params.push(searchPattern, searchPattern, searchPattern, searchPattern);
      }

      if (category_id) {
        whereClause.push('d.category_id = ?');
        params.push(parseInt(category_id));
      } else if (category_slug) {
        whereClause.push('c.slug = ?');
        params.push(category_slug);
      }

      if (format) {
        whereClause.push('d.formats LIKE ?');
        params.push(`%${format}%`);
      }

      if (min_price !== null && min_price !== '') {
        whereClause.push('COALESCE(d.sale_price, d.price) >= ?');
        params.push(parseFloat(min_price));
      }

      if (max_price !== null && max_price !== '') {
        whereClause.push('COALESCE(d.sale_price, d.price) <= ?');
        params.push(parseFloat(max_price));
      }

      if (min_rating !== null && min_rating !== '') {
        whereClause.push('d.average_rating >= ?');
        params.push(parseFloat(min_rating));
      }

      const whereSql = whereClause.length ? 'WHERE ' + whereClause.join(' AND ') : '';

      let orderBy = 'ORDER BY d.created_at DESC, d.id DESC';
      if (sort === 'price_low') orderBy = 'ORDER BY COALESCE(d.sale_price, d.price) ASC';
      else if (sort === 'price_high') orderBy = 'ORDER BY COALESCE(d.sale_price, d.price) DESC';
      else if (sort === 'popular') orderBy = 'ORDER BY COALESCE(d.download_count, d.total_sales) DESC';
      else if (sort === 'rating') orderBy = 'ORDER BY d.average_rating DESC';
      else if (sort === 'oldest') orderBy = 'ORDER BY d.created_at ASC, d.id ASC';

      const offset = (page - 1) * limit;

      const sql = `
        SELECT d.*, c.name as category_name, c.slug as category_slug,
               COALESCE(
                 (SELECT file_path FROM design_files WHERE design_id = d.id AND is_preview = 1 ORDER BY id DESC LIMIT 1),
                 (SELECT image_url FROM design_images WHERE design_id = d.id AND is_primary = 1 ORDER BY id DESC LIMIT 1),
                 (SELECT file_path FROM design_files WHERE design_id = d.id AND file_format IN ('PNG','JPG','JPEG','WEBP') ORDER BY id DESC LIMIT 1),
                 (SELECT image_url FROM design_images WHERE design_id = d.id ORDER BY is_primary DESC, id DESC LIMIT 1)
               ) as primary_image
        FROM designs d
        LEFT JOIN categories c ON d.category_id = c.id
        ${whereSql}
        ${orderBy}
        LIMIT ? OFFSET ?
      `;

      const designs = await db.query(sql, [...params, parseInt(limit), parseInt(offset)]);
      const countSql = `SELECT COUNT(*) as total FROM designs d LEFT JOIN categories c ON d.category_id = c.id ${whereSql}`;
      const countRes = await db.query(countSql, params);

      // Post-process designs to derive formats 100% dynamically from design_files table
      for (const d of designs) {
        const mFiles = await db.query(
          'SELECT file_format, file_name FROM design_files WHERE design_id = ? AND is_preview = 0 AND UPPER(file_format) IN ("DST","PES","JEF","EXP")',
          [d.id]
        );
        if (mFiles && mFiles.length > 0) {
          d.formats = [...new Set(mFiles.map(f => (f.file_format || f.file_name.split('.').pop() || '').toUpperCase()).filter(Boolean))].join(', ');
        } else {
          d.formats = '';
        }
      }

      return {
        designs,
        total: countRes[0].total,
        page: parseInt(page),
        totalPages: Math.ceil((countRes[0].total || 1) / limit)
      };
    }

    // Fallback in-memory
    let filtered = [...fallbackDesigns];
    if (is_active_only || status === 'active') filtered = filtered.filter(d => d.is_active === 1);
    else if (status === 'inactive' || status === 'draft') filtered = filtered.filter(d => d.is_active === 0);

    if (is_featured !== null && is_featured !== undefined) filtered = filtered.filter(d => d.is_featured === (is_featured ? 1 : 0));
    if (is_trending !== null && is_trending !== undefined) filtered = filtered.filter(d => d.is_trending === (is_trending ? 1 : 0));

    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(d => 
        d.title.toLowerCase().includes(q) || 
        (d.tags && d.tags.toLowerCase().includes(q)) ||
        (d.sku && d.sku.toLowerCase().includes(q))
      );
    }

    if (category_id) filtered = filtered.filter(d => d.category_id == category_id);
    if (category_slug) filtered = filtered.filter(d => d.category_slug === category_slug);

    // Compute dynamic formats for fallback designs
    for (const d of filtered) {
      const mFiles = (d.files || []).filter(f => !f.is_preview && !['PNG','JPG','JPEG','WEBP','IMAGE'].includes((f.file_format||'').toUpperCase()));
      if (mFiles.length > 0) {
        d.formats = [...new Set(mFiles.map(f => (f.file_format || f.file_name.split('.').pop() || '').toUpperCase()).filter(Boolean))].join(', ');
      } else {
        d.formats = '';
      }
    }

    const total = filtered.length;
    const startIndex = (page - 1) * limit;
    const paginated = filtered.slice(startIndex, startIndex + limit);

    return {
      designs: paginated,
      total,
      page: parseInt(page),
      totalPages: Math.ceil((total || 1) / limit)
    };
  }

  static async syncDesignFormats(designId) {
    if (!db.isConnected()) return;
    const files = await db.query('SELECT file_format, file_name, is_preview FROM design_files WHERE design_id = ?', [designId]);
    if (!files) return;
    const machineFiles = files.filter(f => !f.is_preview && ['DST', 'PES', 'JEF', 'EXP'].includes((f.file_format || f.file_name.split('.').pop() || '').toUpperCase()));
    const formatsStr = [...new Set(machineFiles.map(f => (f.file_format || f.file_name.split('.').pop() || '').toUpperCase()).filter(Boolean))].join(', ');
    await db.query('UPDATE designs SET formats = ? WHERE id = ?', [formatsStr, designId]);
  }

  static async getBySlug(slug) {
    if (db.isConnected()) {
      try {
        const sql = `
          SELECT d.*, c.name as category_name, c.slug as category_slug
          FROM designs d
          LEFT JOIN categories c ON d.category_id = c.id
          WHERE d.slug = ? OR d.id = ? LIMIT 1
        `;
        const rows = await db.query(sql, [slug, isNaN(slug) ? 0 : parseInt(slug)]);
        if (rows && rows[0]) {
          const design = rows[0];
          design.images = await db.query('SELECT * FROM design_images WHERE design_id = ? ORDER BY is_primary DESC, display_order ASC, id ASC', [design.id]) || [];
          design.files = await db.query('SELECT * FROM design_files WHERE design_id = ? ORDER BY id ASC', [design.id]) || [];

          // Determine primary image
          const previewFile = design.files.find(f => f.is_preview === 1 || f.is_preview === true);
          const primaryImg = design.images.find(img => img.is_primary === 1 || img.is_primary === true);

          if (previewFile) {
            design.primary_image = previewFile.file_path;
          } else if (primaryImg) {
            design.primary_image = primaryImg.image_url;
          } else if (design.images.length > 0) {
            design.primary_image = design.images[0].image_url;
          } else {
            const imgFile = design.files.find(f => ['PNG', 'JPG', 'JPEG', 'WEBP'].includes((f.file_format || '').toUpperCase()));
            design.primary_image = imgFile ? imgFile.file_path : null;
          }

          // Sync dynamic available formats 100% from uploaded machine files in design_files
          const machineFiles = design.files.filter(f => !f.is_preview && ['DST', 'PES', 'JEF', 'EXP'].includes((f.file_format || f.file_name.split('.').pop() || '').toUpperCase()));
          design.formats = [...new Set(machineFiles.map(f => (f.file_format || f.file_name.split('.').pop() || '').toUpperCase()).filter(Boolean))].join(', ');

          return design;
        }
      } catch (err) {
        console.error('Design getBySlug error:', err.message);
      }
    }

    const d = fallbackDesigns.find(item => item.slug === slug || item.id == slug);
    if (!d) return null;
    const machineFiles = (d.files || []).filter(f => !f.is_preview && !['PNG', 'JPG', 'JPEG', 'WEBP', 'IMAGE'].includes((f.file_format || '').toUpperCase()));
    d.formats = [...new Set(machineFiles.map(f => (f.file_format || f.file_name.split('.').pop() || '').toUpperCase()).filter(Boolean))].join(', ');
    return d;
  }

  static async incrementDownloadCount(id) {
    if (db.isConnected()) {
      try {
        await db.query('UPDATE designs SET download_count = download_count + 1 WHERE id = ?', [id]);
      } catch (e) {}
    } else {
      const d = fallbackDesigns.find(item => item.id == id);
      if (d) d.download_count = (d.download_count || 0) + 1;
    }
  }

  static async getById(id) {
    return await this.getBySlug(id);
  }

  static async getFeatured(limit = 6) {
    const res = await this.getAll({ is_active_only: true, is_featured: true, limit });
    return res.designs;
  }

  static async getTrending(limit = 6) {
    const res = await this.getAll({ is_active_only: true, is_trending: true, limit });
    return res.designs;
  }

  static async getNewArrivals(limit = 6) {
    const res = await this.getAll({ is_active_only: true, sort: 'newest', limit });
    return res.designs;
  }

  static async getRelated(categoryId, currentDesignId, limit = 4) {
    const sql = `
      SELECT d.*, c.name as category_name,
             COALESCE(
               (SELECT file_path FROM design_files WHERE design_id = d.id AND is_preview = 1 ORDER BY id DESC LIMIT 1),
               (SELECT image_url FROM design_images WHERE design_id = d.id AND is_primary = 1 ORDER BY id DESC LIMIT 1),
               (SELECT file_path FROM design_files WHERE design_id = d.id AND file_format IN ('PNG','JPG','JPEG','WEBP') ORDER BY id DESC LIMIT 1),
               (SELECT image_url FROM design_images WHERE design_id = d.id ORDER BY is_primary DESC, id DESC LIMIT 1)
             ) as primary_image
      FROM designs d
      LEFT JOIN categories c ON d.category_id = c.id
      WHERE d.category_id = ? AND d.id != ? AND d.is_active = 1
      ORDER BY d.created_at DESC LIMIT ?
    `;
    return await db.query(sql, [categoryId, currentDesignId, parseInt(limit)]);
  }

  static async create(data) {
    const {
      title, sku, slug, price, sale_price, category_id,
      hoop_size, stitch_count, dimensions, formats, is_featured, is_trending, is_active, download_count, tags
    } = data;

    const res = await db.query(
      `INSERT INTO designs (title, sku, slug, price, sale_price, category_id, hoop_size, stitch_count, dimensions, formats, is_featured, is_trending, is_active, download_count, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        sku || null,
        slug,
        price,
        sale_price || null,
        category_id || null,
        hoop_size || '5x7 inch (130x180 mm)',
        stitch_count || 24800,
        dimensions || '140mm x 180mm',
        formats || '',
        is_featured ? 1 : 0,
        is_trending ? 1 : 0,
        is_active ? 1 : 0,
        download_count ? parseInt(download_count) : 0,
        tags || null
      ]
    );
    return res.insertId;
  }

  static async update(id, data) {
    const {
      title, sku, slug, price, sale_price, category_id,
      hoop_size, stitch_count, dimensions, formats, is_featured, is_trending, is_active, download_count, tags
    } = data;

    await db.query(
      `UPDATE designs SET 
        title=?, sku=?, slug=?, price=?, sale_price=?, category_id=?,
        hoop_size=?, stitch_count=?, dimensions=?, formats=?, is_featured=?, is_trending=?, is_active=?, download_count=?, tags=?
       WHERE id=?`,
      [
        title,
        sku || null,
        slug,
        price,
        sale_price !== undefined && sale_price !== null && sale_price !== '' ? sale_price : null,
        category_id || null,
        hoop_size || '5x7 inch (130x180 mm)',
        stitch_count || 24800,
        dimensions || '140mm x 180mm',
        formats || '',
        is_featured ? 1 : 0,
        is_trending ? 1 : 0,
        is_active ? 1 : 0,
        download_count ? parseInt(download_count) : 0,
        tags || null,
        id
      ]
    );
    return true;
  }

  static async updateStatus(id, is_active) {
    await db.query('UPDATE designs SET is_active = ? WHERE id = ?', [is_active ? 1 : 0, id]);
    return true;
  }

  static async delete(id) {
    try {
      await db.query('DELETE FROM designs WHERE id = ?', [id]);
    } catch (err) {
      console.warn(`[Design Delete] Hard delete failed (referenced in orders). Soft-deactivating design #${id}`);
      await db.query('UPDATE designs SET is_active = 0 WHERE id = ?', [id]);
    }
    return true;
  }

  static async addImage(designId, imageUrl, isPrimary = 0, displayOrder = 0) {
    if (isPrimary) {
      await db.query('UPDATE design_images SET is_primary = 0 WHERE design_id = ?', [designId]);
      await db.query('UPDATE design_files SET is_preview = 0 WHERE design_id = ?', [designId]);
    }
    await db.query('INSERT INTO design_images (design_id, image_url, is_primary, display_order) VALUES (?, ?, ?, ?)', [designId, imageUrl, isPrimary, displayOrder]);
    
    // Ensure it exists in design_files as preview image
    const existingFile = await db.query('SELECT id FROM design_files WHERE design_id = ? AND file_path = ?', [designId, imageUrl]);
    if (existingFile && existingFile.length > 0) {
      await db.query('UPDATE design_files SET is_preview = ? WHERE id = ?', [isPrimary ? 1 : 0, existingFile[0].id]);
    } else {
      const fileName = imageUrl.split('/').pop();
      const ext = fileName.split('.').pop().toUpperCase();
      await db.query('INSERT INTO design_files (design_id, file_name, file_path, file_format, file_size, is_preview) VALUES (?, ?, ?, ?, ?, ?)', [designId, fileName, imageUrl, ext, 0, isPrimary ? 1 : 0]);
    }
    return true;
  }

  static async deleteImage(imageId) {
    const imgs = await db.query('SELECT * FROM design_images WHERE id = ?', [imageId]);
    if (imgs && imgs.length > 0) {
      const { design_id, image_url, is_primary } = imgs[0];
      await db.query('DELETE FROM design_images WHERE id = ?', [imageId]);
      await db.query('DELETE FROM design_files WHERE design_id = ? AND file_path = ?', [design_id, image_url]);

      if (is_primary) {
        const remaining = await db.query('SELECT id, image_url FROM design_images WHERE design_id = ? ORDER BY id ASC LIMIT 1', [design_id]);
        if (remaining && remaining.length > 0) {
          await db.query('UPDATE design_images SET is_primary = 1 WHERE id = ?', [remaining[0].id]);
          await db.query('UPDATE design_files SET is_preview = 1 WHERE design_id = ? AND file_path = ?', [design_id, remaining[0].image_url]);
        }
      }
      await this.syncDesignFormats(design_id);
    }
    return true;
  }

  static async setPrimaryImage(imageId) {
    const imgs = await db.query('SELECT design_id, image_url FROM design_images WHERE id = ?', [imageId]);
    if (imgs && imgs.length > 0) {
      const { design_id, image_url } = imgs[0];
      await db.query('UPDATE design_images SET is_primary = 0 WHERE design_id = ?', [design_id]);
      await db.query('UPDATE design_images SET is_primary = 1 WHERE id = ?', [imageId]);
      await db.query('UPDATE design_files SET is_preview = 0 WHERE design_id = ?', [design_id]);
      await db.query('UPDATE design_files SET is_preview = 1 WHERE design_id = ? AND file_path = ?', [design_id, image_url]);
    }
    return true;
  }

  static async addFile(designId, fileName, filePath, fileFormat = 'ZIP', fileSize = 0, isPreview = 0) {
    const isImage = ['PNG', 'JPG', 'JPEG', 'WEBP'].includes((fileFormat || '').toUpperCase());
    const finalPreview = (isPreview || isImage) ? 1 : 0;

    if (finalPreview === 1) {
      await db.query('UPDATE design_files SET is_preview = 0 WHERE design_id = ? AND is_preview = 1', [designId]);
      await db.query('UPDATE design_images SET is_primary = 0 WHERE design_id = ?', [designId]);
    }

    await db.query(
      'INSERT INTO design_files (design_id, file_name, file_path, file_format, file_size, is_preview) VALUES (?, ?, ?, ?, ?, ?)',
      [designId, fileName, filePath, fileFormat, fileSize, finalPreview]
    );

    if (isImage) {
      await db.query(
        'INSERT INTO design_images (design_id, image_url, is_primary, display_order) VALUES (?, ?, ?, ?)',
        [designId, filePath, finalPreview, 1]
      );
    }

    await this.syncDesignFormats(designId);
    return true;
  }

  static async deleteFile(fileId) {
    const files = await db.query('SELECT * FROM design_files WHERE id = ?', [fileId]);
    if (files && files.length > 0) {
      const { design_id, file_path, file_format, is_preview } = files[0];
      await db.query('DELETE FROM design_files WHERE id = ?', [fileId]);

      const isImg = is_preview || ['PNG', 'JPG', 'JPEG', 'WEBP'].includes((file_format || '').toUpperCase());
      if (isImg) {
        await db.query('DELETE FROM design_images WHERE design_id = ? AND image_url = ?', [design_id, file_path]);
      }

      if (is_preview || isImg) {
        const remainingImages = await db.query('SELECT * FROM design_images WHERE design_id = ? ORDER BY id ASC', [design_id]);
        if (remainingImages && remainingImages.length > 0) {
          const nextImg = remainingImages[0];
          await db.query('UPDATE design_images SET is_primary = 1 WHERE id = ?', [nextImg.id]);
          await db.query('UPDATE design_files SET is_preview = 1 WHERE design_id = ? AND file_path = ?', [design_id, nextImg.image_url]);
        } else {
          const remainingFiles = await db.query('SELECT * FROM design_files WHERE design_id = ? AND file_format IN ("PNG","JPG","JPEG","WEBP")', [design_id]);
          if (remainingFiles && remainingFiles.length > 0) {
            await db.query('UPDATE design_files SET is_preview = 1 WHERE id = ?', [remainingFiles[0].id]);
          }
        }
      }
      await this.syncDesignFormats(design_id);
    }
    return true;
  }

  static async count() {
    const res = await db.query('SELECT COUNT(*) as total FROM designs');
    return res[0].total;
  }

  static async countActive() {
    const res = await db.query('SELECT COUNT(*) as total FROM designs WHERE is_active = 1');
    return res[0].total;
  }

  static async countInactive() {
    const res = await db.query('SELECT COUNT(*) as total FROM designs WHERE is_active = 0');
    return res[0].total;
  }

  static async countActive() {
    if (db.isConnected()) {
      const res = await db.query('SELECT COUNT(*) as total FROM designs WHERE is_active = 1');
      return res[0].total;
    }
    return fallbackDesigns.filter(d => d.is_active === 1).length;
  }

  static async countInactive() {
    if (db.isConnected()) {
      const res = await db.query('SELECT COUNT(*) as total FROM designs WHERE is_active = 0');
      return res[0].total;
    }
    return fallbackDesigns.filter(d => d.is_active === 0).length;
  }
}

module.exports = Design;

