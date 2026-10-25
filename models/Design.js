const db = require('../config/db');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const storage = require('../config/storage');

// Persistent empty fallback store (no fake dummy products or fake download counts)
const fallbackDesigns = [];

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
    status = null,
    fileFilter = null,
    file_filter = null
  } = {}) {
    const activeFileFilter = fileFilter || file_filter;
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

        if (activeFileFilter === 'missing_zip') {
          whereClause.push('NOT EXISTS (SELECT 1 FROM design_files df WHERE df.design_id = d.id AND df.is_preview = 0)');
        } else if (activeFileFilter === 'has_zip') {
          whereClause.push('EXISTS (SELECT 1 FROM design_files df WHERE df.design_id = d.id AND df.is_preview = 0)');
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
          whereClause.push('(d.title LIKE ? OR d.sku LIKE ? OR d.tags LIKE ? OR d.formats LIKE ? OR c.name LIKE ?)');
          const searchPattern = `%${search}%`;
          params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
        }

        if (category_id) {
          whereClause.push('d.category_id = ?');
          params.push(parseInt(category_id));
        } else if (category_slug) {
          const cleanSlug = String(category_slug).trim().toLowerCase();
          whereClause.push('(c.slug = ? OR c.slug = ? OR c.slug = ? OR c.slug LIKE ? OR LOWER(c.name) = ? OR LOWER(c.name) LIKE ?)');
          params.push(
            cleanSlug,
            `${cleanSlug}-embroidery`,
            `${cleanSlug}-designs`,
            `${cleanSlug}%`,
            cleanSlug,
            `%${cleanSlug}%`
          );
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
        if (sort === 'price_asc' || sort === 'price_low') {
          orderBy = 'ORDER BY COALESCE(d.sale_price, d.price) ASC, d.id ASC';
        } else if (sort === 'price_desc' || sort === 'price_high') {
          orderBy = 'ORDER BY COALESCE(d.sale_price, d.price) DESC, d.id DESC';
        } else if (sort === 'popular' || sort === 'most_popular') {
          orderBy = 'ORDER BY (COALESCE((SELECT COUNT(*) FROM order_items oi WHERE oi.design_id = d.id), 0) + COALESCE(d.download_count, 0) + COALESCE(d.total_sales, 0)) DESC, d.id DESC';
        } else if (sort === 'top_rated' || sort === 'rating') {
          orderBy = 'ORDER BY (CASE WHEN (SELECT COUNT(r.id) FROM reviews r WHERE r.design_id = d.id AND r.is_approved = 1) > 0 THEN 1 ELSE 0 END) DESC, (SELECT AVG(r.rating) FROM reviews r WHERE r.design_id = d.id AND r.is_approved = 1) DESC, (SELECT COUNT(r.id) FROM reviews r WHERE r.design_id = d.id AND r.is_approved = 1) DESC, d.id DESC';
        } else if (sort === 'oldest') {
          orderBy = 'ORDER BY d.created_at ASC, d.id ASC';
        } else {
          // default: latest
          orderBy = 'ORDER BY d.created_at DESC, d.id DESC';
        }

        const offset = (page - 1) * limit;

        const sql = `
          SELECT d.*, c.name as category_name, c.slug as category_slug,
                 (SELECT AVG(r.rating) FROM reviews r WHERE r.design_id = d.id AND r.is_approved = 1) as real_avg_rating,
                 (SELECT COUNT(r.id) FROM reviews r WHERE r.design_id = d.id AND r.is_approved = 1) as real_reviews_count,
                 COALESCE(
                   (SELECT file_path FROM design_files WHERE design_id = d.id AND is_preview = 1 AND UPPER(file_format) IN ('PNG','JPG','JPEG','WEBP','SVG','AVIF') ORDER BY id DESC LIMIT 1),
                   (SELECT image_url FROM design_images WHERE design_id = d.id AND is_primary = 1 ORDER BY id DESC LIMIT 1),
                   (SELECT file_path FROM design_files WHERE design_id = d.id AND UPPER(file_format) IN ('PNG','JPG','JPEG','WEBP','SVG','AVIF') ORDER BY id DESC LIMIT 1),
                   (SELECT image_url FROM design_images WHERE design_id = d.id ORDER BY is_primary DESC, id DESC LIMIT 1)
                 ) as primary_image,
                 (SELECT df.file_name FROM design_files df WHERE df.design_id = d.id AND df.is_preview = 0 ORDER BY df.id DESC LIMIT 1) as machine_file_name,
                 (SELECT df.file_path FROM design_files df WHERE df.design_id = d.id AND df.is_preview = 0 ORDER BY df.id DESC LIMIT 1) as machine_file_path,
                 (SELECT df.file_size FROM design_files df WHERE df.design_id = d.id AND df.is_preview = 0 ORDER BY df.id DESC LIMIT 1) as machine_file_size,
                 (SELECT df.checksum FROM design_files df WHERE df.design_id = d.id AND df.is_preview = 0 ORDER BY df.id DESC LIMIT 1) as machine_file_checksum
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
          // Post-process designs to derive formats and human file sizes
          for (const d of designs) {
            this.normalizePrimaryImage(d);
            if (d.machine_file_size) {
              const b = parseInt(d.machine_file_size, 10);
              if (b >= 1024 * 1024) d.machine_file_size_formatted = (b / (1024 * 1024)).toFixed(1) + ' MB';
              else if (b >= 1024) d.machine_file_size_formatted = Math.round(b / 1024) + ' KB';
              else d.machine_file_size_formatted = b + ' B';
            } else {
              d.machine_file_size_formatted = null;
            }

            try {
              const mFiles = await db.query(
                'SELECT file_format, file_name FROM design_files WHERE design_id = ? AND is_preview = 0 AND UPPER(file_format) IN ("DST","PES","JEF","EXP")',
                [d.id]
              );
              if (mFiles && mFiles.length > 0) {
                d.formats = [...new Set(mFiles.map(f => (f.file_format || f.file_name.split('.').pop() || '').toUpperCase()).filter(Boolean))].join(', ');
              } else {
                d.formats = d.formats || '';
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
        (d.title && d.title.toLowerCase().includes(q)) || 
        (d.tags && d.tags.toLowerCase().includes(q)) ||
        (d.sku && d.sku.toLowerCase().includes(q)) ||
        (d.category_name && d.category_name.toLowerCase().includes(q))
      );
    }

    if (category_id) filtered = filtered.filter(d => d.category_id == category_id);
    if (category_slug) filtered = filtered.filter(d => d.category_slug === category_slug);

    // Compute dynamic formats and check images for fallback designs
    for (const d of filtered) {
      this.normalizePrimaryImage(d);
      const mFiles = (d.files || []).filter(f => !f.is_preview && !['PNG','JPG','JPEG','WEBP','IMAGE'].includes((f.file_format||'').toUpperCase()));
      if (mFiles.length > 0) {
        d.formats = [...new Set(mFiles.map(f => (f.file_format || f.file_name.split('.').pop() || '').toUpperCase()).filter(Boolean))].join(', ');
      } else {
        d.formats = '';
      }
    }

    // Apply sorting in fallback mode
    if (sort === 'price_low' || sort === 'price_asc') {
      filtered.sort((a, b) => (parseFloat(a.sale_price ?? a.price ?? 0) - parseFloat(b.sale_price ?? b.price ?? 0)));
    } else if (sort === 'price_high' || sort === 'price_desc') {
      filtered.sort((a, b) => (parseFloat(b.sale_price ?? b.price ?? 0) - parseFloat(a.sale_price ?? a.price ?? 0)));
    } else if (sort === 'popular' || sort === 'most_popular') {
      filtered.sort((a, b) => ((b.download_count || b.reviews_count || 0) - (a.download_count || a.reviews_count || 0)));
    } else if (sort === 'oldest') {
      filtered.sort((a, b) => (new Date(a.created_at || 0) - new Date(b.created_at || 0)) || (a.id - b.id));
    } else if (sort === 'latest' || sort === 'newest') {
      filtered.sort((a, b) => (new Date(b.created_at || 0) - new Date(a.created_at || 0)) || (b.id - a.id));
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
      const fullPath = storage.resolveFilePath(zipFile.file_path);
      if (fullPath && fs.existsSync(fullPath)) {
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
        const fullZipPath = storage.resolveFilePath(zipFile.file_path);

        if (fullZipPath && fs.existsSync(fullZipPath) && zipFile.file_name && zipFile.file_name.toLowerCase().endsWith('.zip')) {
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
        file_path: zipFile.file_path || null,
        file_size: zipFile.file_size || 0
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
        file_path: design.file_path || null,
        file_size: 0
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
          this.normalizePrimaryImage(design);

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

  static async incrementDownloadCount(id, { userId = null, fileId = null, ip = null, userAgent = null } = {}) {
    if (db.isConnected()) {
      try {
        await db.query('UPDATE designs SET download_count = download_count + 1 WHERE id = ?', [id]);
        await db.query(
          'INSERT INTO download_logs (user_id, design_id, file_id, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
          [userId, id, fileId, ip, userAgent]
        );
      } catch (e) {
        console.warn('[incrementDownloadCount error]:', e.message);
      }
    } else {
      const d = fallbackDesigns.find(item => item.id == id);
      if (d) d.download_count = (d.download_count || 0) + 1;
    }
  }

  static async replacePrimaryImage(designId, imageUrl, fileName = null, fileSize = 0) {
    const finalFileName = fileName || path.basename(imageUrl);
    const ext = finalFileName.split('.').pop().toUpperCase();
    if (db.isConnected()) {
      try {
        // Find existing primary image records to clean up after successful update
        const oldPrimaries = await db.query(
          'SELECT id, image_url FROM design_images WHERE design_id = ? AND is_primary = 1',
          [designId]
        );

        // Demote previous primary flags
        await db.query('UPDATE design_images SET is_primary = 0 WHERE design_id = ?', [designId]);
        await db.query('UPDATE design_files SET is_preview = 0 WHERE design_id = ?', [designId]);

        // Check if image already exists in design_images
        const existingImg = await db.query('SELECT id FROM design_images WHERE design_id = ? AND image_url = ?', [designId, imageUrl]);
        if (existingImg && existingImg.length > 0) {
          await db.query('UPDATE design_images SET is_primary = 1 WHERE id = ?', [existingImg[0].id]);
        } else {
          await db.query('INSERT INTO design_images (design_id, image_url, is_primary, display_order) VALUES (?, ?, 1, 0)', [designId, imageUrl]);
        }

        // Check if preview file exists in design_files
        const existingFile = await db.query('SELECT id FROM design_files WHERE design_id = ? AND file_path = ?', [designId, imageUrl]);
        if (existingFile && existingFile.length > 0) {
          await db.query('UPDATE design_files SET is_preview = 1 WHERE id = ?', [existingFile[0].id]);
        } else {
          await db.query('INSERT INTO design_files (design_id, file_name, file_path, file_format, file_size, is_preview) VALUES (?, ?, ?, ?, ?, 1)', [designId, finalFileName, imageUrl, ext, fileSize]);
        }

        // Clean up previous replaced primary image to avoid duplicate clutter and free disk space
        if (oldPrimaries && oldPrimaries.length > 0) {
          for (const old of oldPrimaries) {
            if (old.image_url && old.image_url !== imageUrl) {
              await db.query('DELETE FROM design_images WHERE id = ?', [old.id]);
              await db.query('DELETE FROM design_files WHERE design_id = ? AND file_path = ? AND is_preview = 0', [designId, old.image_url]);
              try {
                const oldPhysical = storage.resolveFilePath(old.image_url);
                if (oldPhysical && fs.existsSync(oldPhysical)) {
                  fs.unlinkSync(oldPhysical);
                }
              } catch (delErr) {
                // Ignore missing file error
              }
            }
          }
        }

        return true;
      } catch (err) {
        console.error('Design.replacePrimaryImage error:', err.message);
        throw err;
      }
    }
    const target = fallbackDesigns.find(d => d.id == designId);
    if (target) {
      target.primary_image = imageUrl;
    }
    return true;
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
                   (SELECT file_path FROM design_files WHERE design_id = d.id AND is_preview = 1 AND UPPER(file_format) IN ('PNG','JPG','JPEG','WEBP','SVG','AVIF') ORDER BY id DESC LIMIT 1),
                   (SELECT image_url FROM design_images WHERE design_id = d.id AND is_primary = 1 ORDER BY id DESC LIMIT 1),
                   (SELECT file_path FROM design_files WHERE design_id = d.id AND UPPER(file_format) IN ('PNG','JPG','JPEG','WEBP','SVG','AVIF') ORDER BY id DESC LIMIT 1),
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

  static normalizePrimaryImage(d) {
    if (!d) return d;
    let img = d.primary_image ? String(d.primary_image).trim() : '';
    const ext = img ? img.split('.').pop().toLowerCase() : '';
    const nonImgExts = ['zip', 'dst', 'pes', 'jef', 'exp', 'hus', 'vip', 'vp3', 'xxx'];

    // Placeholder is used ONLY when a product has no image or an invalid non-image format.
    // Neutral placeholder is handled in UI; primary_image remains null.
    // Admin-uploaded images are NEVER overwritten.
    if (!img || nonImgExts.includes(ext)) {
      img = null;
      d.thumbnail_image = null;
    } else {
      img = storage.buildPublicUrl(img);
      d.thumbnail_image = storage.buildThumbnailUrl(img);
    }

    d.primary_image = img;

    if (d.images && Array.isArray(d.images)) {
      for (const im of d.images) {
        if (im.image_url) im.image_url = storage.buildPublicUrl(im.image_url);
      }
    }

    return d;
  }

  static getCategoryAbbreviation(categoryNameOrSlug) {
    if (!categoryNameOrSlug) return 'GEN';
    const norm = String(categoryNameOrSlug).toLowerCase().trim();
    if (norm.includes('blouse')) return 'BLO';
    if (norm.includes('saree')) return 'SAR';
    if (norm.includes('t-shirt') || norm.includes('tshirt')) return 'TSH';
    if (norm.includes('shirt logo') || norm.includes('logo')) return 'SLG';
    if (norm.includes('shirt')) return 'SHI';
    if (norm.includes('animal') || norm.includes('bird')) return 'ABD';
    if (norm.includes('custom')) return 'CUS';
    if (norm.includes('kid') || norm.includes('child')) return 'KID';
    if (norm.includes('tradition')) return 'TRD';
    if (norm.includes('border')) return 'BOR';
    if (norm.includes('flora') || norm.includes('flower')) return 'FLO';
    if (norm.includes('monogram')) return 'MON';
    if (norm.includes('margazhi')) return 'MAR';

    const cleaned = norm.replace(/[^a-z0-9]/g, '').toUpperCase();
    if (cleaned.length >= 3) {
      return cleaned.substring(0, 3);
    }
    return (cleaned + 'XXX').substring(0, 3);
  }

  static async sanitizeDeletedSkus() {
    if (db.isConnected()) {
      try {
        await db.query("UPDATE designs SET sku = CONCAT(sku, '_DEL_', id) WHERE is_active < 0 AND sku NOT LIKE '%_DEL_%'");
      } catch (e) {
        // ignore
      }
    }
  }

  static async isSkuExists(sku, excludeDesignId = null) {
    if (!sku || typeof sku !== 'string') return false;
    const cleanSku = sku.trim();
    if (cleanSku.includes('_DEL_')) return false;

    if (db.isConnected()) {
      try {
        let sql = 'SELECT id FROM designs WHERE LOWER(sku) = LOWER(?) AND is_active >= 0';
        let params = [cleanSku];
        if (excludeDesignId) {
          sql += ' AND id != ?';
          params.push(parseInt(excludeDesignId));
        }
        sql += ' LIMIT 1';
        const rows = await db.query(sql, params);
        if (rows && rows.length > 0) return true;
      } catch (err) {
        console.error('[isSkuExists DB Error]:', err.message);
      }
    }
    const found = fallbackDesigns.find(d => 
      (d.is_active === undefined || d.is_active >= 0) &&
      d.sku && !d.sku.includes('_DEL_') &&
      d.sku.trim().toLowerCase() === cleanSku.toLowerCase() &&
      (!excludeDesignId || d.id != excludeDesignId)
    );
    return Boolean(found);
  }

  static async getNextSkuForCategory(categoryId, currentDesignId = null) {
    await this.sanitizeDeletedSkus();

    let catName = '';
    if (categoryId) {
      const Category = require('./Category');
      const cat = await Category.getById(categoryId);
      if (cat) {
        catName = cat.name || cat.slug || '';
      }
    }
    const abbr = this.getCategoryAbbreviation(catName);
    const prefix = `AED-${abbr}-`;

    let matchingSkus = [];
    let designCountInCategory = 0;

    if (db.isConnected()) {
      try {
        let sql = 'SELECT sku FROM designs WHERE category_id = ? AND is_active >= 0';
        let params = [parseInt(categoryId)];
        if (currentDesignId) {
          sql += ' AND id != ?';
          params.push(parseInt(currentDesignId));
        }
        const rows = await db.query(sql, params);
        if (rows && Array.isArray(rows)) {
          designCountInCategory = rows.length;
          matchingSkus = rows.map(r => r.sku).filter(s => Boolean(s) && !s.includes('_DEL_'));
        }
      } catch (err) {
        console.error('[getNextSkuForCategory DB Error]:', err.message);
      }
    } else {
      const filtered = fallbackDesigns.filter(d => 
        (d.is_active === undefined || d.is_active >= 0) &&
        d.category_id == categoryId && (!currentDesignId || d.id != currentDesignId)
      );
      designCountInCategory = filtered.length;
      matchingSkus = filtered.map(d => d.sku).filter(s => Boolean(s) && !s.includes('_DEL_'));
    }

    if (designCountInCategory === 0 || matchingSkus.length === 0) {
      let num = 1;
      let candidate = `${prefix}${String(num).padStart(2, '0')}`;
      while (await this.isSkuExists(candidate, currentDesignId)) {
        num++;
        candidate = `${prefix}${String(num).padStart(2, '0')}`;
      }
      return candidate;
    }

    let extractedNumbers = [];
    const prefixRegex = new RegExp(`^AED-${abbr}-(\\d+)$`, 'i');
    const genericRegex = /(\d+)$/;

    for (const s of matchingSkus) {
      const matchPrefix = s.match(prefixRegex);
      if (matchPrefix && matchPrefix[1]) {
        extractedNumbers.push(parseInt(matchPrefix[1], 10));
      } else {
        const matchGen = s.match(genericRegex);
        if (matchGen && matchGen[1]) {
          extractedNumbers.push(parseInt(matchGen[1], 10));
        }
      }
    }

    let maxNum = extractedNumbers.length > 0 ? Math.max(...extractedNumbers) : matchingSkus.length;
    let nextSeq = maxNum + 1;
    let candidateSku = `${prefix}${String(nextSeq).padStart(2, '0')}`;

    while (await this.isSkuExists(candidateSku, currentDesignId)) {
      nextSeq++;
      candidateSku = `${prefix}${String(nextSeq).padStart(2, '0')}`;
    }

    return candidateSku;
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
      hoop_size, stitch_count, stitch_count_front, stitch_count_back, stitch_count_sleeve, description,
      dimensions, formats, is_featured, is_trending, is_active, download_count, tags,
      average_rating, reviews_count, import_image_filename, import_zip_filename
    } = data;

    const parseStitch = (val) => {
      if (val === undefined || val === null || val === '') return null;
      const clean = String(val).replace(/,/g, '').trim();
      const n = parseInt(clean, 10);
      return (!isNaN(n) && n >= 0) ? n : null;
    };

    // Ensure slug is non-empty and unique
    const finalSlug = slug ? slug : await this.generateUniqueSlug(title);

    let finalSku = (sku && sku.trim()) ? sku.trim() : null;
    if (!finalSku) {
      finalSku = await this.getNextSkuForCategory(category_id);
    } else {
      const exists = await this.isSkuExists(finalSku);
      if (exists) {
        finalSku = await this.getNextSkuForCategory(category_id);
      }
    }

    const avgRatingVal = (average_rating !== undefined && average_rating !== null && average_rating !== '') ? parseFloat(average_rating) : 4.80;
    const revCountVal = (reviews_count !== undefined && reviews_count !== null && reviews_count !== '') ? parseInt(reviews_count) : 0;

    const frontStitchVal = parseStitch(stitch_count_front);
    const backStitchVal = parseStitch(stitch_count_back);
    const sleeveStitchVal = parseStitch(stitch_count_sleeve);
    
    // Strict calculation rule: Total = Front + Back + Sleeve only when all three exist
    let mainStitchVal = null;
    if (frontStitchVal !== null && backStitchVal !== null && sleeveStitchVal !== null) {
      mainStitchVal = frontStitchVal + backStitchVal + sleeveStitchVal;
    } else if (frontStitchVal === null && backStitchVal === null && sleeveStitchVal === null) {
      mainStitchVal = parseStitch(stitch_count);
    } else {
      mainStitchVal = null;
    }

    let insertedId = null;

    if (db.isConnected()) {
      try {
        const res = await db.query(
          `INSERT INTO designs (title, sku, slug, price, sale_price, category_id, hoop_size, stitch_count, stitch_count_front, stitch_count_back, stitch_count_sleeve, dimensions, formats, is_featured, is_trending, is_active, download_count, tags, average_rating, reviews_count, import_image_filename, import_zip_filename, description)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            title,
            finalSku,
            finalSlug,
            price,
            sale_price || null,
            category_id || null,
            hoop_size || null,
            mainStitchVal,
            frontStitchVal,
            backStitchVal,
            sleeveStitchVal,
            dimensions || null,
            formats || '',
            is_featured ? 1 : 0,
            is_trending ? 1 : 0,
            is_active ? 1 : 0,
            download_count ? parseInt(download_count) : 0,
            tags || null,
            avgRatingVal,
            revCountVal,
            import_image_filename || null,
            import_zip_filename || null,
            description || null
          ]
        );
        if (res && res.insertId) insertedId = res.insertId;
      } catch (err) {
        console.error('[Design.create DB Error]:', err.message);
        if (err.code === 'ER_DUP_ENTRY' && String(err.message).toLowerCase().includes('sku')) {
          try {
            finalSku = await this.getNextSkuForCategory(category_id);
            const retryRes = await db.query(
              `INSERT INTO designs (title, sku, slug, price, sale_price, category_id, hoop_size, stitch_count, stitch_count_front, stitch_count_back, stitch_count_sleeve, dimensions, formats, is_featured, is_trending, is_active, download_count, tags, average_rating, reviews_count, import_image_filename, import_zip_filename, description)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                title,
                finalSku,
                finalSlug,
                price,
                sale_price || null,
                category_id || null,
                hoop_size || null,
                mainStitchVal,
                frontStitchVal,
                backStitchVal,
                sleeveStitchVal,
                dimensions || null,
                formats || '',
                is_featured ? 1 : 0,
                is_trending ? 1 : 0,
                is_active ? 1 : 0,
                download_count ? parseInt(download_count) : 0,
                tags || null,
                avgRatingVal,
                revCountVal,
                import_image_filename || null,
                import_zip_filename || null,
                description || null
              ]
            );
            if (retryRes && retryRes.insertId) insertedId = retryRes.insertId;
          } catch (retryErr) {
            console.error('[Design.create Retry Error]:', retryErr.message);
          }
        }
      }
    }

    if (!insertedId) {
      insertedId = fallbackDesigns.length > 0 ? Math.max(...fallbackDesigns.map(d => d.id)) + 1 : 1;
    }

    // Always maintain fallback store synchronization
    const newDesign = {
      id: insertedId,
      title,
      sku: finalSku || `AED ${insertedId}`,
      slug: finalSlug,
      description: description || null,
      price: parseFloat(price),
      sale_price: sale_price ? parseFloat(sale_price) : null,
      category_id: category_id ? parseInt(category_id) : 6,
      category_name: 'Blouse Designs',
      category_slug: 'blouse-designs',
      hoop_size: hoop_size || null,
      stitch_count: mainStitchVal,
      stitch_count_front: frontStitchVal,
      stitch_count_back: backStitchVal,
      stitch_count_sleeve: sleeveStitchVal,
      dimensions: dimensions || null,
      formats: formats || 'DST, PES, JEF, EXP',
      is_featured: is_featured ? 1 : 0,
      is_trending: is_trending ? 1 : 0,
      is_active: is_active ? 1 : 0,
      download_count: download_count ? parseInt(download_count) : 0,
      tags: tags || null,
      average_rating: avgRatingVal,
      reviews_count: revCountVal,
      primary_image: null,
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
      hoop_size, stitch_count, stitch_count_front, stitch_count_back, stitch_count_sleeve, description,
      dimensions, formats, is_featured, is_trending, is_active, download_count, tags,
      average_rating, reviews_count, import_image_filename, import_zip_filename
    } = data;

    const parseStitch = (val) => {
      if (val === undefined) return undefined;
      if (val === null || val === '') return null;
      const clean = String(val).replace(/,/g, '').trim();
      const n = parseInt(clean, 10);
      return (!isNaN(n) && n >= 0) ? n : null;
    };

    // Ensure slug is valid & unique excluding current design ID
    let finalSlug = slug;
    if (!finalSlug || finalSlug.trim() === '') {
      finalSlug = await this.generateUniqueSlug(title || `design-${id}`, id);
    }

    const avgRatingVal = (average_rating !== undefined && average_rating !== null && average_rating !== '') ? parseFloat(average_rating) : undefined;
    const revCountVal = (reviews_count !== undefined && reviews_count !== null && reviews_count !== '') ? parseInt(reviews_count) : undefined;

    const frontStitchVal = parseStitch(stitch_count_front);
    const backStitchVal = parseStitch(stitch_count_back);
    const sleeveStitchVal = parseStitch(stitch_count_sleeve);

    let computedStitchCount = parseStitch(stitch_count);
    if (computedStitchCount === undefined && (frontStitchVal !== undefined || backStitchVal !== undefined || sleeveStitchVal !== undefined)) {
      const existing = fallbackDesigns.find(d => d.id == id);
      const f = frontStitchVal !== undefined ? frontStitchVal : (existing ? existing.stitch_count_front : null);
      const b = backStitchVal !== undefined ? backStitchVal : (existing ? existing.stitch_count_back : null);
      const s = sleeveStitchVal !== undefined ? sleeveStitchVal : (existing ? existing.stitch_count_sleeve : null);

      if (f !== null && f !== undefined && b !== null && b !== undefined && s !== null && s !== undefined) {
        computedStitchCount = Number(f) + Number(b) + Number(s);
      } else {
        computedStitchCount = null;
      }
    }

    if (db.isConnected()) {
      try {
        let updateFields = [];
        let updateParams = [];

        if (title !== undefined) {
          updateFields.push('title=?');
          updateParams.push(title);
        }
        if (sku !== undefined) {
          updateFields.push('sku=?');
          updateParams.push(sku || null);
        }
        if (finalSlug !== undefined) {
          updateFields.push('slug=?');
          updateParams.push(finalSlug);
        }
        if (price !== undefined) {
          updateFields.push('price=?');
          updateParams.push(price);
        }
        if (sale_price !== undefined) {
          updateFields.push('sale_price=?');
          updateParams.push(sale_price !== null && sale_price !== '' ? sale_price : null);
        }
        if (category_id !== undefined) {
          updateFields.push('category_id=?');
          updateParams.push(category_id || null);
        }
        if (hoop_size !== undefined) {
          updateFields.push('hoop_size=?');
          updateParams.push(hoop_size || null);
        }
        if (computedStitchCount !== undefined) {
          updateFields.push('stitch_count=?');
          updateParams.push(computedStitchCount);
        }
        if (frontStitchVal !== undefined) {
          updateFields.push('stitch_count_front=?');
          updateParams.push(frontStitchVal);
        }
        if (backStitchVal !== undefined) {
          updateFields.push('stitch_count_back=?');
          updateParams.push(backStitchVal);
        }
        if (sleeveStitchVal !== undefined) {
          updateFields.push('stitch_count_sleeve=?');
          updateParams.push(sleeveStitchVal);
        }
        if (description !== undefined) {
          updateFields.push('description=?');
          updateParams.push(description || null);
        }
        if (dimensions !== undefined) {
          updateFields.push('dimensions=?');
          updateParams.push(dimensions || null);
        }
        if (formats !== undefined) {
          updateFields.push('formats=?');
          updateParams.push(formats || '');
        }
        if (is_featured !== undefined) {
          updateFields.push('is_featured=?');
          updateParams.push(is_featured ? 1 : 0);
        }
        if (is_trending !== undefined) {
          updateFields.push('is_trending=?');
          updateParams.push(is_trending ? 1 : 0);
        }
        if (is_active !== undefined) {
          updateFields.push('is_active=?');
          updateParams.push(is_active ? 1 : 0);
        }
        if (download_count !== undefined) {
          updateFields.push('download_count=?');
          updateParams.push(download_count ? parseInt(download_count) : 0);
        }
        if (tags !== undefined) {
          updateFields.push('tags=?');
          updateParams.push(tags || null);
        }
        if (import_image_filename !== undefined) {
          updateFields.push('import_image_filename=?');
          updateParams.push(import_image_filename || null);
        }
        if (import_zip_filename !== undefined) {
          updateFields.push('import_zip_filename=?');
          updateParams.push(import_zip_filename || null);
        }
        if (avgRatingVal !== undefined) {
          updateFields.push('average_rating=?');
          updateParams.push(avgRatingVal);
        }
        if (revCountVal !== undefined) {
          updateFields.push('reviews_count=?');
          updateParams.push(revCountVal);
        }

        if (updateFields.length > 0) {
          updateParams.push(id);
          await db.query(
            `UPDATE designs SET ${updateFields.join(', ')} WHERE id=?`,
            updateParams
          );
        }
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
      if (category_id !== undefined) target.category_id = category_id ? parseInt(category_id) : null;
      if (computedStitchCount !== undefined) target.stitch_count = computedStitchCount;
      if (frontStitchVal !== undefined) target.stitch_count_front = frontStitchVal;
      if (backStitchVal !== undefined) target.stitch_count_back = backStitchVal;
      if (sleeveStitchVal !== undefined) target.stitch_count_sleeve = sleeveStitchVal;
      if (description !== undefined) target.description = description || null;
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

  static async findBySku(sku) {
    if (!sku || !String(sku).trim()) return null;
    const cleanSku = String(sku).trim();
    if (db.isConnected()) {
      try {
        const rows = await db.query(
          `SELECT d.*, c.name as category_name, c.slug as category_slug 
           FROM designs d 
           LEFT JOIN categories c ON d.category_id = c.id 
           WHERE LOWER(TRIM(d.sku)) = LOWER(TRIM(?)) LIMIT 1`,
          [cleanSku]
        );
        if (rows && rows[0]) return rows[0];
      } catch (e) {
        console.warn('[Design.findBySku DB error]:', e.message);
      }
    }
    return fallbackDesigns.find(d => d.sku && d.sku.trim().toLowerCase() === cleanSku.toLowerCase()) || null;
  }

  static async getAllMapBySku() {
    let list = [];
    if (db.isConnected()) {
      try {
        list = await db.query(
          `SELECT d.*, c.name as category_name, c.slug as category_slug 
           FROM designs d 
           LEFT JOIN categories c ON d.category_id = c.id 
           WHERE (d.deleted_at IS NULL OR d.deleted_at = '')`
        ) || [];
      } catch (e) {
        console.warn('[Design.getAllMapBySku DB error]:', e.message);
      }
    }
    if (!list || !list.length) {
      list = [...fallbackDesigns];
    }
    const map = new Map();
    for (const item of list) {
      if (item.sku) {
        map.set(item.sku.trim().toUpperCase(), item);
      }
    }
    return { list, map };
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
        const fullPath = storage.resolveFilePath(file_path);
        if (fullPath && fs.existsSync(fullPath)) {
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
            const fullPath = storage.resolveFilePath(f.file_path);
            if (fullPath && fs.existsSync(fullPath)) {
              if (fullPath.includes('/public/images/') || fullPath.includes('\\public\\images\\') || fullPath.includes('hero_embroidery.jpg') || fullPath.includes('logo.jpg')) continue;
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

  static async replaceMachineFile(designId, filePath, fileName, fileSize, checksum, detectedFormats = []) {
    if (!designId) throw new Error('designId is required');

    let oldFiles = [];
    if (db.isConnected()) {
      try {
        oldFiles = await db.query(
          'SELECT * FROM design_files WHERE design_id = ? AND is_preview = 0',
          [designId]
        ) || [];

        const ext = (path.extname(fileName).replace('.', '') || 'ZIP').toUpperCase();

        // 1. Insert new machine file record FIRST (safe atomic replacement)
        const insertRes = await db.query(
          'INSERT INTO design_files (design_id, file_name, file_path, file_format, file_size, checksum, is_preview) VALUES (?, ?, ?, ?, ?, ?, 0)',
          [designId, fileName, filePath, ext, fileSize || 0, checksum || null]
        );
        const newFileId = insertRes.insertId;

        // 2. Remove old machine file records from database (excluding new row)
        if (oldFiles.length > 0) {
          const oldIds = oldFiles.map(f => f.id).filter(id => id !== newFileId);
          if (oldIds.length > 0) {
            await db.query(`DELETE FROM design_files WHERE id IN (${oldIds.map(() => '?').join(',')})`, oldIds);
          }
        }

        // 3. Delete old physical files from disk safely (only if not pointing to the same file)
        for (const old of oldFiles) {
          if (old.file_path && old.file_path !== filePath) {
            const oldFullPath = storage.resolveFilePath(old.file_path);
            if (oldFullPath && fs.existsSync(oldFullPath)) {
              if (
                !oldFullPath.includes('/public/images/') &&
                !oldFullPath.includes('\\public\\images\\') &&
                !oldFullPath.includes('hero_embroidery.jpg') &&
                !oldFullPath.includes('logo.jpg')
              ) {
                try {
                  fs.unlinkSync(oldFullPath);
                } catch (delErr) {
                  console.warn('[replaceMachineFile] Could not delete old file from disk:', oldFullPath, delErr.message);
                }
              }
            }
          }
        }

        // 4. Update formats on design according to Setting auto_detect_formats_policy (DO NOT TOUCH download_count)
        if (detectedFormats && Array.isArray(detectedFormats) && detectedFormats.length > 0) {
          try {
            const Setting = require('./Setting');
            const policy = await Setting.get('auto_detect_formats_policy', 'fill_if_empty');
            const dRows = await db.query('SELECT formats FROM designs WHERE id = ?', [designId]);
            const currentFormats = (dRows && dRows[0] && dRows[0].formats) ? dRows[0].formats.trim() : '';
            const newFormatsStr = detectedFormats.join(', ');

            if (policy === 'overwrite' || !currentFormats) {
              await db.query('UPDATE designs SET formats = ? WHERE id = ?', [newFormatsStr, designId]);
            }
          } catch (fmtErr) {
            console.warn('[replaceMachineFile] Format update warning:', fmtErr.message);
          }
        }

        // 5. Update import_zip_filename if null
        await db.query(
          'UPDATE designs SET import_zip_filename = COALESCE(import_zip_filename, ?) WHERE id = ?',
          [fileName, designId]
        );

      } catch (err) {
        console.error('Design.replaceMachineFile DB error:', err.message);
        throw err;
      }
    }

    // Maintain fallback store
    const target = fallbackDesigns.find(d => d.id == designId);
    if (target) {
      if (!target.files) target.files = [];
      target.files = target.files.filter(f => f.is_preview);
      const ext = (path.extname(fileName).replace('.', '') || 'ZIP').toUpperCase();
      target.files.unshift({
        id: Date.now(),
        design_id: designId,
        file_name: fileName,
        file_path: filePath,
        file_format: ext,
        file_size: fileSize || 0,
        checksum: checksum || null,
        is_preview: 0
      });
      if (detectedFormats && detectedFormats.length > 0) {
        target.formats = detectedFormats.join(', ');
      }
      this.attachZipPackage(target);
    }

    return true;
  }

  static async count() {
    if (db.isConnected()) {
      try {
        const res = await db.query('SELECT COUNT(*) as total FROM designs WHERE is_active >= 0');
        if (res && res[0] && res[0].total !== undefined) return res[0].total;
      } catch (e) {}
    }
    return fallbackDesigns.filter(d => d.is_active >= 0).length;
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
            const fullPath = storage.resolveFilePath(f.file_path);
            if (fullPath && fs.existsSync(fullPath)) {
              if (fullPath.includes('/public/images/') || fullPath.includes('\\public\\images\\') || fullPath.includes('hero_embroidery.jpg') || fullPath.includes('logo.jpg')) continue;
              try { fs.unlinkSync(fullPath); } catch (e) { console.warn('Could not delete physical file:', fullPath, e.message); }
            }
          }
        }

        // 2. Get associated design_images to clean up physical preview images on disk
        const images = await db.query('SELECT * FROM design_images WHERE design_id = ?', [id]) || [];
        for (const img of images) {
          if (img.image_url) {
            const fullPath = storage.resolveFilePath(img.image_url);
            if (fullPath && fs.existsSync(fullPath)) {
              if (fullPath.includes('/public/images/') || fullPath.includes('\\public\\images\\') || fullPath.includes('hero_embroidery.jpg') || fullPath.includes('logo.jpg')) continue;
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
          await db.query("UPDATE designs SET is_active = -1, sku = CONCAT(COALESCE(sku, 'AED'), '_DEL_', UNIX_TIMESTAMP()) WHERE id = ?", [id]);
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
        const designs = await db.query('SELECT id FROM designs WHERE is_active >= 0') || [];
        for (const d of designs) {
          await this.delete(d.id);
        }
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

  static async getSuggestions(query, limit = 8) {
    if (!query || typeof query !== 'string' || !query.trim()) return [];
    const q = `%${query.trim()}%`;
    if (db.isConnected()) {
      try {
        const sql = `
          SELECT d.id, d.title, d.sku, d.slug, d.price, d.sale_price, d.formats,
                 c.name as category_name, c.slug as category_slug,
                 COALESCE(
                   (SELECT file_path FROM design_files WHERE design_id = d.id AND is_preview = 1 AND UPPER(file_format) IN ('PNG','JPG','JPEG','WEBP','SVG','AVIF') ORDER BY id DESC LIMIT 1),
                   (SELECT image_url FROM design_images WHERE design_id = d.id AND is_primary = 1 ORDER BY id DESC LIMIT 1),
                   (SELECT file_path FROM design_files WHERE design_id = d.id AND UPPER(file_format) IN ('PNG','JPG','JPEG','WEBP','SVG','AVIF') ORDER BY id DESC LIMIT 1),
                   (SELECT image_url FROM design_images WHERE design_id = d.id ORDER BY is_primary DESC, id DESC LIMIT 1)
                 ) as primary_image
          FROM designs d
          LEFT JOIN categories c ON d.category_id = c.id
          WHERE d.is_active = 1
            AND (d.title LIKE ? OR d.sku LIKE ? OR d.tags LIKE ? OR d.formats LIKE ? OR c.name LIKE ?)
          ORDER BY d.id DESC
          LIMIT ?
        `;
        const rows = await db.query(sql, [q, q, q, q, q, parseInt(limit)]);
        for (const item of rows) {
          this.normalizePrimaryImage(item);
        }
        return rows;
      } catch (err) {
        console.error('Design.getSuggestions DB error:', err);
      }
    }
    const term = query.trim().toLowerCase();
    const matches = fallbackDesigns.filter(d => 
      d.is_active === 1 && (
        (d.title && d.title.toLowerCase().includes(term)) ||
        (d.sku && d.sku.toLowerCase().includes(term)) ||
        (d.tags && d.tags.toLowerCase().includes(term)) ||
        (d.category_name && d.category_name.toLowerCase().includes(term))
      )
    ).slice(0, limit);
    for (const item of matches) {
      this.normalizePrimaryImage(item);
    }
    return matches;
  }
}

module.exports = Design;

