const db = require('../config/db');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');

const availablePreviewImages = [
  '/public/uploads/previews/design_file-1791042254214-185248588.png',
  '/public/uploads/previews/design_file-1791042328059-900556097.png',
  '/public/uploads/previews/design_file-1791043703946-812496920.png',
  '/public/uploads/previews/design_file-1791044351993-377176697.png',
  '/public/uploads/previews/design_file-1791044401396-730712576.png',
  '/public/uploads/previews/design_file-1791044451199-587612069.png',
  '/public/uploads/previews/design_file-1791044497412-293209124.png',
  '/public/uploads/previews/design_file-1791044530255-613750965.png',
  '/public/uploads/previews/design_file-1791044568469-573511633.png',
  '/public/uploads/previews/design_file-1791212506592-922941743.png'
];

const categoryMetaMap = {
  1: { id: 1, name: 'Animals & Birds Design', slug: 'animals-birds-designs' },
  2: { id: 2, name: 'Blouse Designs', slug: 'blouse-designs' },
  3: { id: 3, name: 'Saree Designs', slug: 'saree-designs' },
  4: { id: 4, name: 'Shirt Designs', slug: 'shirt-designs' },
  5: { id: 5, name: 'Shirt Logo Designs', slug: 'shirt-logo-designs' },
  6: { id: 6, name: 'T-Shirt Designs', slug: 't-shirt-designs' }
};

const fallbackDesigns = Array.from({ length: 5 }, (_, idx) => {
  const num = idx + 1;
  const catId = 2; // Blouse Designs (5 designs: AED 1, AED 2, AED 3, AED 4, AED 5 matching production)
  const catMeta = categoryMetaMap[catId];
  const imgUrl = availablePreviewImages[(num - 1) % availablePreviewImages.length];

  return {
    id: num,
    title: `AED ${num}`,
    sku: `AED ${num}`,
    slug: `aed-${num}`,
    price: 399.00,
    sale_price: 299.00,
    discount_pct: 25,
    category_id: catMeta.id,
    category_name: catMeta.name,
    category_slug: catMeta.slug,
    hoop_size: '5x7 inch (130x180 mm)',
    stitch_count: 24800,
    dimensions: '140mm x 180mm',
    formats: 'DST, PES, JEF, EXP',
    is_featured: num <= 6 ? 1 : 0,
    is_trending: num <= 10 ? 1 : 0,
    is_active: 1,
    download_count: 256,
    primary_image: imgUrl,
    images: [{ id: num, image_url: imgUrl, is_primary: 1 }],
    files: [{
      id: num,
      file_name: `AED ${num}.zip`,
      file_path: '/public/uploads/designs/sample_peacock.zip',
      file_format: 'ZIP',
      file_size: 2450123,
      is_preview: 0
    }]
  };
});

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
      try {
        let whereClause = [];
        let params = [];

        if (is_active_only) {
          whereClause.push('d.is_active = 1');
        } else if (status === 'active') {
          whereClause.push('d.is_active = 1');
        } else if (status === 'inactive' || status === 'draft') {
          whereClause.push('d.is_active = 0');
        } else {
          whereClause.push('d.is_active >= 0');
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

        if (designs && Array.isArray(designs)) {
          // Post-process designs to derive formats 100% dynamically from design_files table
          for (const d of designs) {
            try {
              const mFiles = await db.query(
                'SELECT file_format, file_name FROM design_files WHERE design_id = ? AND is_preview = 0 AND UPPER(file_format) IN ("DST","PES","JEF","EXP")',
                [d.id]
              );
              if (mFiles && mFiles.length > 0) {
                d.formats = [...new Set(mFiles.map(f => (f.file_format || f.file_name.split('.').pop() || '').toUpperCase()).filter(Boolean))].join(', ');
              } else {
                d.formats = '';
              }
            } catch (fErr) {
              d.formats = d.formats || '';
            }
          }

          const totalNum = (countRes && countRes[0] && countRes[0].total !== undefined) ? countRes[0].total : designs.length;
          return {
            designs,
            total: totalNum,
            page: parseInt(page),
            totalPages: Math.ceil((totalNum || 1) / limit)
          };
        }
      } catch (err) {
        console.error('Design.getAll DB error:', err.message);
      }
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
    const files = await db.query('SELECT file_format, file_name, file_path, is_preview FROM design_files WHERE design_id = ? AND is_preview = 0', [designId]);
    if (!files || files.length === 0) {
      return;
    }

    let detected = [];
    const zipFile = files.find(f => (f.file_format || '').toUpperCase() === 'ZIP' || (f.file_name || '').toLowerCase().endsWith('.zip'));
    if (zipFile && zipFile.file_path) {
      let relPath = zipFile.file_path.startsWith('/') ? zipFile.file_path.substring(1) : zipFile.file_path;
      const fullPath = path.join(__dirname, '..', relPath);
      if (fs.existsSync(fullPath)) {
        try {
          const zip = new AdmZip(fullPath);
          const entries = zip.getEntries();
          const machineEntries = entries.filter(e => {
            if (e.isDirectory) return false;
            const ext = path.extname(e.entryName).toLowerCase().replace('.', '').toUpperCase();
            return ['DST', 'PES', 'JEF', 'EXP'].includes(ext);
          });
          if (machineEntries.length > 0) {
            detected = [...new Set(machineEntries.map(e => path.extname(e.entryName).toLowerCase().replace('.', '').toUpperCase()))];
          }
        } catch (e) {}
      }
    }

    if (detected.length === 0) {
      detected = [...new Set(files.map(f => (f.file_format || f.file_name.split('.').pop() || '').toUpperCase()))].filter(f => ['DST', 'PES', 'JEF', 'EXP'].includes(f) && f !== 'ZIP');
    }

    if (detected.length > 0) {
      const formatsStr = detected.join(', ');
      await db.query('UPDATE designs SET formats = ? WHERE id = ?', [formatsStr, designId]);
    }
  }

  static attachZipPackage(design) {
    if (!design) return design;

    const files = design.files || [];
    const machineFiles = files.filter(f => !f.is_preview);

    if (machineFiles.length > 0) {
      const zipFile = machineFiles.find(f => (f.file_format || '').toUpperCase() === 'ZIP' || (f.file_name || '').toLowerCase().endsWith('.zip')) || machineFiles[0];

      let fileCount = machineFiles.length;
      let detectedFormats = [];

      if (zipFile && zipFile.file_path) {
        let relPath = zipFile.file_path.startsWith('/') ? zipFile.file_path.substring(1) : zipFile.file_path;
        const fullZipPath = path.join(__dirname, '..', relPath);

        if (fs.existsSync(fullZipPath) && zipFile.file_name && zipFile.file_name.toLowerCase().endsWith('.zip')) {
          try {
            const zip = new AdmZip(fullZipPath);
            const entries = zip.getEntries();
            const machineEntries = entries.filter(e => {
              if (e.isDirectory) return false;
              const ext = path.extname(e.entryName).toLowerCase().replace('.', '').toUpperCase();
              return ['DST', 'PES', 'JEF', 'EXP'].includes(ext);
            });

            if (machineEntries.length > 0) {
              fileCount = machineEntries.length;
              detectedFormats = [...new Set(machineEntries.map(e => path.extname(e.entryName).toLowerCase().replace('.', '').toUpperCase()))];
            } else {
              fileCount = entries.filter(e => !e.isDirectory).length || 1;
            }
          } catch (zipErr) {
            console.warn('[ZIP INSPECT WARN]:', zipErr.message);
          }
        }
      }

      if (detectedFormats.length === 0) {
        detectedFormats = [...new Set(machineFiles.map(f => (f.file_format || (f.file_name ? f.file_name.split('.').pop() : '') || '').toUpperCase()))].filter(f => ['DST', 'PES', 'JEF', 'EXP'].includes(f));
        if (detectedFormats.length === 0 && design.formats) {
          detectedFormats = design.formats.split(',').map(s => s.trim().toUpperCase()).filter(s => Boolean(s) && s !== 'ZIP');
        }
      }

      if (detectedFormats.length === 0) {
        detectedFormats = ['DST', 'PES', 'JEF', 'EXP'];
      }

      const rawPkgName = zipFile.file_name && zipFile.file_name.toLowerCase().endsWith('.zip')
        ? zipFile.file_name
        : `${design.title || design.sku || ('AED ' + design.id)}.zip`;

      design.zipPackage = {
        id: zipFile.id || design.id,
        packageName: rawPkgName,
        fileCount: fileCount || 1,
        formats: detectedFormats,
        file_path: zipFile.file_path || '/public/uploads/designs/sample_peacock.zip',
        file_size: zipFile.file_size || 2450123
      };

      design.formats = detectedFormats.join(', ');
    } else {
      const existingFmts = (design.formats && design.formats !== 'ZIP' && design.formats.trim() !== '')
        ? design.formats.split(',').map(s => s.trim().toUpperCase()).filter(s => Boolean(s) && s !== 'ZIP')
        : ['DST', 'PES', 'JEF', 'EXP'];

      design.zipPackage = {
        id: design.id,
        packageName: `${design.title || design.sku || ('AED ' + design.id)}.zip`,
        fileCount: existingFmts.length || 1,
        formats: existingFmts,
        file_path: design.file_path || '/public/uploads/designs/sample_peacock.zip',
        file_size: 2450123
      };
      design.formats = existingFmts.join(', ');
    }

    return design;
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

          // Attach zipPackage metadata & sync formats
          this.attachZipPackage(design);

          return design;
        }
      } catch (err) {
        console.error('Design getBySlug error:', err.message);
      }
    }

    const d = fallbackDesigns.find(item => item.slug === slug || item.id == slug);
    if (!d) return null;
    this.attachZipPackage(d);
    return d;
  }

  static async getById(id) {
    return this.getBySlug(id);
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

  static async getFeatured(limit = 6) {
    const res = await this.getAll({ is_active_only: true, is_featured: true, limit });
    return (res && Array.isArray(res.designs)) ? res.designs : [];
  }

  static async getTrending(limit = 6) {
    const res = await this.getAll({ is_active_only: true, is_trending: true, limit });
    return (res && Array.isArray(res.designs)) ? res.designs : [];
  }

  static async getNewArrivals(limit = 6) {
    const res = await this.getAll({ is_active_only: true, sort: 'newest', limit });
    return (res && Array.isArray(res.designs)) ? res.designs : [];
  }

  static async getRelated(categoryId, currentDesignId, limit = 4) {
    if (db.isConnected()) {
      try {
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
        const rows = await db.query(sql, [categoryId, currentDesignId, parseInt(limit)]);
        if (rows && Array.isArray(rows)) return rows;
      } catch (err) {
        console.error('Design.getRelated DB error:', err.message);
      }
    }
    return fallbackDesigns.filter(d => d.category_id == categoryId && d.id != currentDesignId).slice(0, limit);
  }

  static normalizeSlug(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  static async generateUniqueSlug(baseTitleOrSlug, currentDesignId = null) {
    let baseSlug = this.normalizeSlug(baseTitleOrSlug);
    if (!baseSlug) {
      baseSlug = currentDesignId ? `design-${currentDesignId}` : `design-${Date.now()}`;
    }

    let candidateSlug = baseSlug;
    let counter = 1;

    if (db.isConnected()) {
      try {
        while (counter <= 100) {
          let sql = 'SELECT id FROM designs WHERE slug = ?';
          let params = [candidateSlug];

          if (currentDesignId) {
            sql += ' AND id != ?';
            params.push(parseInt(currentDesignId));
          }

          sql += ' LIMIT 1';

          const existing = await db.query(sql, params);
          if (!existing || existing.length === 0) {
            return candidateSlug;
          }

          counter++;
          candidateSlug = `${baseSlug}-${counter}`;
        }
      } catch (err) {
        console.error('[generateUniqueSlug DB Error]:', err.message);
      }
    }

    // Fallback in-memory check
    counter = 1;
    candidateSlug = baseSlug;
    while (counter <= 100) {
      const duplicate = fallbackDesigns.find(d => 
        d.slug === candidateSlug && (!currentDesignId || d.id != currentDesignId)
      );
      if (!duplicate) {
        return candidateSlug;
      }
      counter++;
      candidateSlug = `${baseSlug}-${counter}`;
    }

    return `${baseSlug}-${Date.now()}`;
  }

  static async repairInvalidDatabaseSlugs() {
    if (!db.isConnected()) return;
    try {
      // 1. Repair empty or NULL slugs
      const invalidRows = await db.query(
        "SELECT id, title, sku FROM designs WHERE slug IS NULL OR TRIM(slug) = ''"
      );

      if (invalidRows && invalidRows.length > 0) {
        console.log(`[SLUG REPAIR] Found ${invalidRows.length} design(s) with empty/invalid slugs. Repairing...`);
        for (const row of invalidRows) {
          const baseName = row.title || row.sku || `design-${row.id}`;
          const uniqueSlug = await this.generateUniqueSlug(baseName, row.id);
          await db.query('UPDATE designs SET slug = ? WHERE id = ?', [uniqueSlug, row.id]);
          console.log(`[SLUG REPAIR SUCCESS] Design #${row.id} ("${row.title}") updated with valid slug: "${uniqueSlug}"`);
        }
      }

      // 2. Resolve duplicate non-empty slugs
      const duplicateSlugRows = await db.query(
        "SELECT slug, COUNT(*) as cnt FROM designs WHERE slug IS NOT NULL AND TRIM(slug) != '' GROUP BY slug HAVING cnt > 1"
      );

      if (duplicateSlugRows && duplicateSlugRows.length > 0) {
        console.log(`[SLUG REPAIR] Found ${duplicateSlugRows.length} duplicate slug group(s). Resolving...`);
        for (const dup of duplicateSlugRows) {
          const matchingDesigns = await db.query(
            "SELECT id, title, sku FROM designs WHERE slug = ? ORDER BY id ASC",
            [dup.slug]
          );
          for (let i = 1; i < matchingDesigns.length; i++) {
            const target = matchingDesigns[i];
            const baseName = target.title || target.sku || `design-${target.id}`;
            const newSlug = await this.generateUniqueSlug(baseName, target.id);
            await db.query('UPDATE designs SET slug = ? WHERE id = ?', [newSlug, target.id]);
            console.log(`[SLUG DUPLICATE RESOLVED] Design #${target.id} slug updated to "${newSlug}"`);
          }
        }
      }
    } catch (err) {
      console.error('[SLUG REPAIR ERROR]:', err.message);
    }
  }

  static async create(data) {
    const {
      title, sku, slug, price, sale_price, category_id,
      hoop_size, stitch_count, dimensions, formats, is_featured, is_trending, is_active, download_count, tags,
      average_rating, reviews_count
    } = data;

    // Ensure slug is non-empty and unique
    const finalSlug = slug ? slug : await this.generateUniqueSlug(title);

    const avgRatingVal = (average_rating !== undefined && average_rating !== null && average_rating !== '') ? parseFloat(average_rating) : 4.80;
    const revCountVal = (reviews_count !== undefined && reviews_count !== null && reviews_count !== '') ? parseInt(reviews_count) : 0;

    let insertedId = null;

    if (db.isConnected()) {
      try {
        const res = await db.query(
          `INSERT INTO designs (title, sku, slug, price, sale_price, category_id, hoop_size, stitch_count, dimensions, formats, is_featured, is_trending, is_active, download_count, tags, average_rating, reviews_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            title,
            sku || null,
            finalSlug,
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
            tags || null,
            avgRatingVal,
            revCountVal
          ]
        );
        if (res && res.insertId) insertedId = res.insertId;
      } catch (err) {
        console.error('[Design.create DB Error]:', err.message);
      }
    }

    if (!insertedId) {
      insertedId = fallbackDesigns.length > 0 ? Math.max(...fallbackDesigns.map(d => d.id)) + 1 : 1;
    }

    // Always maintain fallback store synchronization
    const newDesign = {
      id: insertedId,
      title,
      sku: sku || `AED ${insertedId}`,
      slug: finalSlug,
      price: parseFloat(price),
      sale_price: sale_price ? parseFloat(sale_price) : null,
      category_id: category_id ? parseInt(category_id) : 6,
      category_name: 'Blouse Designs',
      category_slug: 'blouse-designs',
      hoop_size: hoop_size || '5x7 inch (130x180 mm)',
      stitch_count: stitch_count || 24800,
      dimensions: dimensions || '140mm x 180mm',
      formats: formats || 'DST, PES, JEF, EXP',
      is_featured: is_featured ? 1 : 0,
      is_trending: is_trending ? 1 : 0,
      is_active: is_active ? 1 : 0,
      download_count: download_count ? parseInt(download_count) : 0,
      tags: tags || null,
      average_rating: avgRatingVal,
      reviews_count: revCountVal,
      primary_image: '/public/images/logo.jpg',
      images: [],
      files: []
    };

    const existingIdx = fallbackDesigns.findIndex(d => d.id == insertedId);
    if (existingIdx !== -1) {
      fallbackDesigns[existingIdx] = newDesign;
    } else {
      fallbackDesigns.unshift(newDesign);
    }

    return insertedId;
  }

  static async update(id, data) {
    const {
      title, sku, slug, price, sale_price, category_id,
      hoop_size, stitch_count, dimensions, formats, is_featured, is_trending, is_active, download_count, tags,
      average_rating, reviews_count
    } = data;

    // Ensure slug is valid & unique excluding current design ID
    let finalSlug = slug;
    if (!finalSlug || finalSlug.trim() === '') {
      finalSlug = await this.generateUniqueSlug(title || `design-${id}`, id);
    }

    const avgRatingVal = (average_rating !== undefined && average_rating !== null && average_rating !== '') ? parseFloat(average_rating) : undefined;
    const revCountVal = (reviews_count !== undefined && reviews_count !== null && reviews_count !== '') ? parseInt(reviews_count) : undefined;

    if (db.isConnected()) {
      try {
        let updateFields = [
          'title=?', 'sku=?', 'slug=?', 'price=?', 'sale_price=?', 'category_id=?',
          'hoop_size=?', 'stitch_count=?', 'dimensions=?', 'formats=?', 'is_featured=?', 'is_trending=?', 'is_active=?', 'download_count=?', 'tags=?'
        ];
        let updateParams = [
          title,
          sku || null,
          finalSlug,
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
          tags || null
        ];

        if (avgRatingVal !== undefined) {
          updateFields.push('average_rating=?');
          updateParams.push(avgRatingVal);
        }
        if (revCountVal !== undefined) {
          updateFields.push('reviews_count=?');
          updateParams.push(revCountVal);
        }

        updateParams.push(id);

        await db.query(
          `UPDATE designs SET ${updateFields.join(', ')} WHERE id=?`,
          updateParams
        );
      } catch (err) {
        console.error('[Design.update DB Error]:', err.message);
      }
    }

    // Always maintain fallback store synchronization
    const target = fallbackDesigns.find(d => d.id == id);
    if (target) {
      if (title !== undefined) target.title = title;
      if (sku !== undefined) target.sku = sku;
      if (finalSlug !== undefined) target.slug = finalSlug;
      if (price !== undefined) target.price = parseFloat(price);
      if (sale_price !== undefined) target.sale_price = sale_price !== null && sale_price !== '' ? parseFloat(sale_price) : null;
      if (category_id !== undefined) target.category_id = parseInt(category_id);
      if (hoop_size !== undefined) target.hoop_size = hoop_size;
      if (stitch_count !== undefined) target.stitch_count = parseInt(stitch_count);
      if (dimensions !== undefined) target.dimensions = dimensions;
      if (formats !== undefined) target.formats = formats;
      if (is_featured !== undefined) target.is_featured = is_featured ? 1 : 0;
      if (is_trending !== undefined) target.is_trending = is_trending ? 1 : 0;
      if (is_active !== undefined) target.is_active = is_active ? 1 : 0;
      if (download_count !== undefined) target.download_count = parseInt(download_count);
      if (tags !== undefined) target.tags = tags;
      if (avgRatingVal !== undefined) target.average_rating = avgRatingVal;
      if (revCountVal !== undefined) target.reviews_count = revCountVal;
    }
    return true;
  }

  static async updateStatus(id, is_active) {
    if (db.isConnected()) {
      try {
        await db.query('UPDATE designs SET is_active = ? WHERE id = ?', [is_active ? 1 : 0, id]);
      } catch (e) {}
    }
    const target = fallbackDesigns.find(d => d.id == id);
    if (target) target.is_active = is_active ? 1 : 0;
    return true;
  }

  static async delete(id) {
    if (!id) return false;
    if (db.isConnected()) {
      try {
        const files = await db.query('SELECT * FROM design_files WHERE design_id = ?', [id]) || [];
        for (const f of files) {
          if (f.file_path) {
            let relPath = f.file_path.startsWith('/') ? f.file_path.substring(1) : f.file_path;
            const fullPath = path.join(__dirname, '..', relPath);
            if (fs.existsSync(fullPath)) {
              try { fs.unlinkSync(fullPath); } catch (e) {}
            }
          }
        }
        await db.query('DELETE FROM design_files WHERE design_id = ?', [id]);
        await db.query('DELETE FROM design_images WHERE design_id = ?', [id]);
        await db.query('DELETE FROM cart_items WHERE design_id = ?', [id]);
        await db.query('DELETE FROM wishlist WHERE design_id = ?', [id]);

        const orderItemsRes = await db.query('SELECT COUNT(*) as cnt FROM order_items WHERE design_id = ?', [id]);
        const hasPurchases = orderItemsRes && orderItemsRes[0] && orderItemsRes[0].cnt > 0;
        if (hasPurchases) {
          await db.query('UPDATE designs SET is_active = -1 WHERE id = ?', [id]);
        } else {
          await db.query('DELETE FROM designs WHERE id = ?', [id]);
        }
      } catch (err) {
        console.error('Design.delete DB error:', err.message);
      }
    }

    const idx = fallbackDesigns.findIndex(d => d.id == id);
    if (idx !== -1) {
      fallbackDesigns.splice(idx, 1);
    }
    return true;
  }

  static async addImage(designId, imageUrl, isPrimary = 0, displayOrder = 0) {
    if (db.isConnected()) {
      try {
        if (isPrimary) {
          await db.query('UPDATE design_images SET is_primary = 0 WHERE design_id = ?', [designId]);
          await db.query('UPDATE design_files SET is_preview = 0 WHERE design_id = ?', [designId]);
        }
        await db.query('INSERT INTO design_images (design_id, image_url, is_primary, display_order) VALUES (?, ?, ?, ?)', [designId, imageUrl, isPrimary, displayOrder]);
        const existingFile = await db.query('SELECT id FROM design_files WHERE design_id = ? AND file_path = ?', [designId, imageUrl]);
        if (existingFile && existingFile.length > 0) {
          await db.query('UPDATE design_files SET is_preview = ? WHERE id = ?', [isPrimary ? 1 : 0, existingFile[0].id]);
        } else {
          const fileName = imageUrl.split('/').pop();
          const ext = fileName.split('.').pop().toUpperCase();
          await db.query('INSERT INTO design_files (design_id, file_name, file_path, file_format, file_size, is_preview) VALUES (?, ?, ?, ?, ?, ?)', [designId, fileName, imageUrl, ext, 0, isPrimary ? 1 : 0]);
        }
      } catch (e) {
        console.error('addImage DB error:', e.message);
      }
    }

    const target = fallbackDesigns.find(d => d.id == designId);
    if (target) {
      if (!target.images) target.images = [];
      if (isPrimary) {
        target.primary_image = imageUrl;
        target.images.forEach(img => img.is_primary = 0);
      }
      target.images.unshift({ id: Date.now(), image_url: imageUrl, is_primary: isPrimary });
    }

    return true;
  }

  static async deleteImage(imageId) {
    if (db.isConnected()) {
      try {
        const imgs = await db.query('SELECT * FROM design_images WHERE id = ?', [imageId]);
        if (imgs && imgs.length > 0) {
          const { design_id, image_url, is_primary } = imgs[0];
          await db.query('DELETE FROM design_images WHERE id = ?', [imageId]);
          await db.query('DELETE FROM design_files WHERE design_id = ? AND file_path = ?', [design_id, image_url]);
          if (is_primary) {
            const remaining = await db.query('SELECT id, image_url FROM design_images WHERE design_id = ? ORDER BY id ASC LIMIT 1', [design_id]);
            if (remaining && remaining.length > 0) {
              await db.query('UPDATE design_images SET is_primary = 1 WHERE id = ?', [remaining[0].id]);
            }
          }
          await this.syncDesignFormats(design_id);
        }
      } catch (e) {}
    }
    return true;
  }

  static async setPrimaryImage(imageId) {
    if (db.isConnected()) {
      try {
        const imgs = await db.query('SELECT design_id, image_url FROM design_images WHERE id = ?', [imageId]);
        if (imgs && imgs.length > 0) {
          const { design_id, image_url } = imgs[0];
          await db.query('UPDATE design_images SET is_primary = 0 WHERE design_id = ?', [design_id]);
          await db.query('UPDATE design_images SET is_primary = 1 WHERE id = ?', [imageId]);
          await db.query('UPDATE design_files SET is_preview = 0 WHERE design_id = ?', [design_id]);
          await db.query('UPDATE design_files SET is_preview = 1 WHERE design_id = ? AND file_path = ?', [design_id, image_url]);
        }
      } catch (e) {}
    }
    return true;
  }

  static async addFile(designId, fileName, filePath, fileFormat = 'ZIP', fileSize = 0, isPreview = 0) {
    const isImage = ['PNG', 'JPG', 'JPEG', 'WEBP'].includes((fileFormat || '').toUpperCase());
    const finalPreview = (isPreview || isImage) ? 1 : 0;

    if (db.isConnected()) {
      try {
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
      } catch (e) {
        console.error('addFile DB error:', e.message);
      }
    }

    const target = fallbackDesigns.find(d => d.id == designId);
    if (target) {
      if (!target.files) target.files = [];
      if (!target.images) target.images = [];
      if (finalPreview === 1) {
        target.primary_image = filePath;
        target.files.forEach(f => f.is_preview = 0);
      }
      target.files.unshift({
        id: Date.now(),
        file_name: fileName,
        file_path: filePath,
        file_format: fileFormat,
        file_size: fileSize,
        is_preview: finalPreview
      });
      if (isImage) {
        target.images.unshift({ id: Date.now(), image_url: filePath, is_primary: finalPreview });
      }
      this.attachZipPackage(target);
    }
    return true;
  }

  static async deleteFile(fileId) {
    const files = await db.query('SELECT * FROM design_files WHERE id = ?', [fileId]);
    if (files && files.length > 0) {
      const { design_id, file_path, file_format, is_preview } = files[0];

      if (file_path) {
        let relPath = file_path;
        if (relPath.startsWith('/')) relPath = relPath.substring(1);
        const fullPath = path.join(__dirname, '..', relPath);
        if (fs.existsSync(fullPath)) {
          try { fs.unlinkSync(fullPath); } catch (e) { console.warn('Could not delete file from disk:', fullPath); }
        }
      }

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

  static async deleteAllMachineFiles(designId) {
    if (!designId) return false;
    if (db.isConnected()) {
      try {
        const files = await db.query(
          'SELECT * FROM design_files WHERE design_id = ? AND is_preview = 0 AND UPPER(file_format) NOT IN ("PNG","JPG","JPEG","WEBP")',
          [designId]
        ) || [];

        for (const f of files) {
          if (f.file_path) {
            let relPath = f.file_path;
            if (relPath.startsWith('/')) relPath = relPath.substring(1);
            const fullPath = path.join(__dirname, '..', relPath);
            if (fs.existsSync(fullPath)) {
              try { fs.unlinkSync(fullPath); } catch (e) { console.warn('Could not delete physical file from disk:', fullPath, e.message); }
            }
          }
        }

        await db.query(
          'DELETE FROM design_files WHERE design_id = ? AND is_preview = 0 AND UPPER(file_format) NOT IN ("PNG","JPG","JPEG","WEBP")',
          [designId]
        );

        await this.syncDesignFormats(designId);
        return true;
      } catch (err) {
        console.error('Design.deleteAllMachineFiles DB error:', err.message);
        throw err;
      }
    }

    const d = fallbackDesigns.find(item => item.id == designId);
    if (d && d.files) {
      d.files = d.files.filter(f => f.is_preview || ['PNG','JPG','JPEG','WEBP','IMAGE'].includes((f.file_format||'').toUpperCase()));
      d.formats = '';
    }
    return true;
  }

  static async count() {
    if (db.isConnected()) {
      try {
        const res = await db.query('SELECT COUNT(*) as total FROM designs');
        if (res && res[0] && res[0].total !== undefined) return res[0].total;
      } catch (e) {}
    }
    return fallbackDesigns.length;
  }

  static async countActive() {
    if (db.isConnected()) {
      try {
        const res = await db.query('SELECT COUNT(*) as total FROM designs WHERE is_active = 1');
        if (res && res[0] && res[0].total !== undefined) return res[0].total;
      } catch (e) {}
    }
    return fallbackDesigns.filter(d => d.is_active === 1).length;
  }

  static async countInactive() {
    if (db.isConnected()) {
      try {
        const res = await db.query('SELECT COUNT(*) as total FROM designs WHERE is_active = 0');
        if (res && res[0] && res[0].total !== undefined) return res[0].total;
      } catch (e) {}
    }
    return fallbackDesigns.filter(d => d.is_active === 0).length;
  }

  static async delete(id) {
    if (!id) return false;
    if (db.isConnected()) {
      try {
        // 1. Get associated design_files to clean up physical machine & preview files on disk
        const files = await db.query('SELECT * FROM design_files WHERE design_id = ?', [id]) || [];
        for (const f of files) {
          if (f.file_path) {
            let relPath = f.file_path;
            if (relPath.startsWith('/')) relPath = relPath.substring(1);
            const fullPath = path.join(__dirname, '..', relPath);
            if (fs.existsSync(fullPath)) {
              try { fs.unlinkSync(fullPath); } catch (e) { console.warn('Could not delete physical file:', fullPath, e.message); }
            }
          }
        }

        // 2. Get associated design_images to clean up physical preview images on disk
        const images = await db.query('SELECT * FROM design_images WHERE design_id = ?', [id]) || [];
        for (const img of images) {
          if (img.image_url) {
            let relPath = img.image_url;
            if (relPath.startsWith('/')) relPath = relPath.substring(1);
            const fullPath = path.join(__dirname, '..', relPath);
            if (fs.existsSync(fullPath)) {
              try { fs.unlinkSync(fullPath); } catch (e) { console.warn('Could not delete physical image:', fullPath, e.message); }
            }
          }
        }

        // 3. Clean up database child records (files, images, cart_items, wishlist)
        await db.query('DELETE FROM design_files WHERE design_id = ?', [id]);
        await db.query('DELETE FROM design_images WHERE design_id = ?', [id]);
        await db.query('DELETE FROM cart_items WHERE design_id = ?', [id]);
        await db.query('DELETE FROM wishlist WHERE design_id = ?', [id]);

        // 4. Safely handle designs referenced in completed/paid customer orders
        const orderItemsRes = await db.query('SELECT COUNT(*) as cnt FROM order_items WHERE design_id = ?', [id]);
        const hasPurchases = orderItemsRes && orderItemsRes[0] && orderItemsRes[0].cnt > 0;

        if (hasPurchases) {
          // Soft-delete to preserve financial/order history and satisfy MySQL FK ON DELETE RESTRICT
          await db.query('UPDATE designs SET is_active = -1 WHERE id = ?', [id]);
        } else {
          // Hard-delete row if design was never purchased
          await db.query('DELETE FROM designs WHERE id = ?', [id]);
        }

        return true;
      } catch (err) {
        console.error('Design.delete DB error:', err.message);
        throw err;
      }
    }

    // Fallback array handling
    const idx = fallbackDesigns.findIndex(d => d.id == id);
    if (idx !== -1) {
      fallbackDesigns.splice(idx, 1);
    }
    return true;
  }

  static async deleteAll() {
    if (db.isConnected()) {
      try {
        const designs = await db.query('SELECT id FROM designs') || [];
        for (const d of designs) {
          await db.query('DELETE FROM design_files WHERE design_id = ?', [d.id]);
          await db.query('DELETE FROM design_images WHERE design_id = ?', [d.id]);
          await db.query('DELETE FROM cart_items WHERE design_id = ?', [d.id]);
          await db.query('DELETE FROM wishlist WHERE design_id = ?', [d.id]);
          await db.query('DELETE FROM order_items WHERE design_id = ?', [d.id]);
          await db.query('DELETE FROM designs WHERE id = ?', [d.id]);
        }
        await db.query('TRUNCATE TABLE design_files');
        await db.query('TRUNCATE TABLE design_images');
        await db.query('DELETE FROM designs');
      } catch (err) {
        console.error('Design.deleteAll DB error:', err.message);
        throw err;
      }
    }
    fallbackDesigns.length = 0;
    return true;
  }

  static async deleteBulk(ids) {
    if (!ids || !Array.isArray(ids) || ids.length === 0) return true;
    for (const id of ids) {
      await this.delete(id);
    }
    return true;
  }
}

module.exports = Design;

