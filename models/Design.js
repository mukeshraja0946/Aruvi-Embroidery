const db = require('../config/db');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const storage = require('../config/storage');

const fallbackFilePath = path.join(__dirname, '..', 'public', 'uploads', 'fallback_designs.json');

function loadFallbackDesigns() {
  try {
    if (fs.existsSync(fallbackFilePath)) {
      const raw = fs.readFileSync(fallbackFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('[FallbackStore Load Warning]:', err.message);
  }
  return [];
}

function saveFallbackDesigns(designs) {
  try {
    const dir = path.dirname(fallbackFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fallbackFilePath, JSON.stringify(designs, null, 2), 'utf8');
  } catch (err) {
    console.warn('[FallbackStore Save Warning]:', err.message);
  }
}

// Persistent fallback store (survives restarts in local offline fallback mode)
const fallbackDesigns = loadFallbackDesigns();

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
    file_filter = null,
    stitchFilter = null,
    stitch_filter = null
  } = {}) {
    const activeFileFilter = fileFilter || file_filter;
    const activeStitchFilter = stitchFilter || stitch_filter;
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

        if (activeStitchFilter === 'missing') {
          whereClause.push('(COALESCE(d.stitch_count_total, d.stitch_count) IS NULL OR COALESCE(d.stitch_count_total, d.stitch_count) = 0)');
        } else if (activeStitchFilter === 'has_stitch') {
          whereClause.push('(COALESCE(d.stitch_count_total, d.stitch_count) IS NOT NULL AND COALESCE(d.stitch_count_total, d.stitch_count) > 0)');
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
        } else if (sort === 'stitches_asc' || sort === 'stitches_low') {
          orderBy = 'ORDER BY (CASE WHEN COALESCE(d.stitch_count_total, d.stitch_count) IS NULL THEN 1 ELSE 0 END), COALESCE(d.stitch_count_total, d.stitch_count) ASC, d.id ASC';
        } else if (sort === 'stitches_desc' || sort === 'stitches_high') {
          orderBy = 'ORDER BY (CASE WHEN COALESCE(d.stitch_count_total, d.stitch_count) IS NULL THEN 1 ELSE 0 END), COALESCE(d.stitch_count_total, d.stitch_count) DESC, d.id DESC';
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
            this.normalizeStitchCounts(d);
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

    if (activeStitchFilter === 'missing') {
      filtered = filtered.filter(d => !d.stitch_count_total || Number(d.stitch_count_total) === 0);
    } else if (activeStitchFilter === 'has_stitch') {
      filtered = filtered.filter(d => d.stitch_count_total && Number(d.stitch_count_total) > 0);
    }

    // Compute dynamic formats and check images for fallback designs
    for (const d of filtered) {
      this.normalizePrimaryImage(d);
      this.normalizeStitchCounts(d);
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
    } else if (sort === 'stitches_low' || sort === 'stitches_asc') {
      filtered.sort((a, b) => {
        const valA = (a.stitch_count_total !== null && a.stitch_count_total !== undefined) ? Number(a.stitch_count_total) : Infinity;
        const valB = (b.stitch_count_total !== null && b.stitch_count_total !== undefined) ? Number(b.stitch_count_total) : Infinity;
        return valA - valB || a.id - b.id;
      });
    } else if (sort === 'stitches_high' || sort === 'stitches_desc') {
      filtered.sort((a, b) => {
        const valA = (a.stitch_count_total !== null && a.stitch_count_total !== undefined) ? Number(a.stitch_count_total) : -Infinity;
        const valB = (b.stitch_count_total !== null && b.stitch_count_total !== undefined) ? Number(b.stitch_count_total) : -Infinity;
        return valB - valA || b.id - a.id;
      });
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
          this.normalizeStitchCounts(design);

          return design;
        }
      } catch (err) {
        console.error('Design getBySlug error:', err.message);
      }
    }

    const d = fallbackDesigns.find(item => item.slug === slug || item.id == slug);
    if (!d) return null;
    this.attachZipPackage(d);
    this.normalizeStitchCounts(d);
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

  static normalizeStitchCounts(d) {
    if (!d) return d;
    const parseNum = (v) => {
      if (v === null || v === undefined || v === '') return null;
      const clean = String(v).replace(/,/g, '').trim();
      const n = parseInt(clean, 10);
      return (!isNaN(n) && n >= 0) ? n : null;
    };

    const f = parseNum(d.stitch_count_front !== undefined ? d.stitch_count_front : d.frontStitchCount);
    const b = parseNum(d.stitch_count_back !== undefined ? d.stitch_count_back : d.backStitchCount);
    const s = parseNum(d.stitch_count_sleeve !== undefined ? d.stitch_count_sleeve : d.sleeveStitchCount);
    const isManual = (d.stitch_total_manual === 1 || d.stitch_total_manual === '1' || d.stitchTotalManual === 1 || d.stitchTotalManual === '1');

    let t = null;
    if (isManual) {
      t = parseNum(d.stitch_count_total !== undefined ? d.stitch_count_total : (d.stitch_count !== undefined ? d.stitch_count : d.totalStitchCount));
    } else {
      // Auto: total = front + back + sleeve (treat empty as 0; if all three are empty, total stays NULL).
      if (f !== null || b !== null || s !== null) {
        t = (f || 0) + (b || 0) + (s || 0);
      } else {
        t = parseNum(d.stitch_count_total !== undefined ? d.stitch_count_total : (d.stitch_count !== undefined ? d.stitch_count : d.totalStitchCount));
      }
    }

    d.stitch_count_front = f;
    d.frontStitchCount = f;
    d.stitch_count_back = b;
    d.backStitchCount = b;
    d.stitch_count_sleeve = s;
    d.sleeveStitchCount = s;
    d.stitch_count_total = t;
    d.stitch_count = t;
    d.totalStitchCount = t;
    d.stitch_total_manual = isManual ? 1 : 0;
    d.stitchTotalManual = d.stitch_total_manual;

    return d;
  }

  static async getAvailableColumns() {
    if (!db.isConnected()) return new Set();
    if (this._availableColumns && this._availableColumns.size > 0) {
      return this._availableColumns;
    }
    try {
      const rows = await db.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'designs'"
      );
      if (Array.isArray(rows) && rows.length > 0) {
        this._availableColumns = new Set(rows.map(r => (r.column_name || r.COLUMN_NAME || '').toLowerCase()));
      } else {
        this._availableColumns = new Set();
      }
    } catch (e) {
      this._availableColumns = new Set();
    }
    return this._availableColumns;
  }

  static async ensureDatabaseColumns() {
    if (!db.isConnected()) return;
    try {
      const rows = await db.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'designs'"
      );
      const colNames = Array.isArray(rows) ? new Set(rows.map(c => (c.column_name || c.COLUMN_NAME || '').toLowerCase())) : new Set();

      const requiredCols = [
        { name: 'stitch_count_front', def: 'INT UNSIGNED NULL DEFAULT NULL AFTER `stitch_count`' },
        { name: 'stitch_count_back', def: 'INT UNSIGNED NULL DEFAULT NULL AFTER `stitch_count_front`' },
        { name: 'stitch_count_sleeve', def: 'INT UNSIGNED NULL DEFAULT NULL AFTER `stitch_count_back`' },
        { name: 'stitch_count_total', def: 'INT UNSIGNED NULL DEFAULT NULL AFTER `stitch_count_sleeve`' },
        { name: 'stitch_total_manual', def: 'TINYINT NOT NULL DEFAULT 0 AFTER `stitch_count_total`' },
        { name: 'hoop_size', def: 'VARCHAR(50) NULL DEFAULT NULL AFTER `category_id`' },
        { name: 'description', def: 'TEXT NULL DEFAULT NULL AFTER `slug`' },
        { name: 'short_description', def: 'TEXT NULL DEFAULT NULL AFTER `sku`' },
        { name: 'sub_category', def: 'VARCHAR(100) NULL DEFAULT NULL AFTER `category_id`' },
        { name: 'sku', def: 'VARCHAR(100) NULL DEFAULT NULL AFTER `title`' },
        { name: 'is_trending', def: 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_featured`' },
        { name: 'download_count', def: 'INT NOT NULL DEFAULT 0 AFTER `is_active`' },
        { name: 'tags', def: 'TEXT NULL DEFAULT NULL AFTER `download_count`' },
        { name: 'average_rating', def: 'DECIMAL(3,2) NOT NULL DEFAULT 4.80' },
        { name: 'reviews_count', def: 'INT NOT NULL DEFAULT 120' },
        { name: 'import_image_filename', def: 'VARCHAR(255) NULL DEFAULT NULL' },
        { name: 'import_zip_filename', def: 'VARCHAR(255) NULL DEFAULT NULL' },
        { name: 'deleted_at', def: 'DATETIME NULL DEFAULT NULL' }
      ];

      for (const col of requiredCols) {
        if (!colNames.has(col.name)) {
          try {
            await db.query(`ALTER TABLE \`designs\` ADD COLUMN IF NOT EXISTS \`${col.name}\` ${col.def}`);
            colNames.add(col.name);
          } catch (alterErr) {
            // Fallback for older MySQL without IF NOT EXISTS syntax
            try {
              await db.query(`ALTER TABLE \`designs\` ADD COLUMN \`${col.name}\` ${col.def}`);
              colNames.add(col.name);
            } catch (e2) {}
          }
        }
      }
      this._availableColumns = colNames;
    } catch (err) {
      console.warn('[Design.ensureDatabaseColumns Warning]:', err.message);
    }
  }

  static async repairExistingStitchCounts() {
    if (db.isConnected()) {
      try {
        await this.ensureDatabaseColumns();
        // 1. Recalculate totals where all three component values are present
        await db.query(`
          UPDATE designs 
          SET stitch_count = (stitch_count_front + stitch_count_back + stitch_count_sleeve)
          WHERE stitch_count_front IS NOT NULL 
            AND stitch_count_back IS NOT NULL 
            AND stitch_count_sleeve IS NOT NULL
            AND (stitch_count IS NULL OR stitch_count != (stitch_count_front + stitch_count_back + stitch_count_sleeve))
        `);

        // 2. Set stitch_count to NULL when component counts are incomplete (some present, but not all 3)
        await db.query(`
          UPDATE designs 
          SET stitch_count = NULL 
          WHERE (stitch_count_front IS NOT NULL OR stitch_count_back IS NOT NULL OR stitch_count_sleeve IS NOT NULL)
            AND (stitch_count_front IS NULL OR stitch_count_back IS NULL OR stitch_count_sleeve IS NULL)
            AND stitch_count IS NOT NULL
        `);
      } catch (err) {
        console.warn('[Stitch Count Repair Warning]:', err.message);
      }
    }

    // Synchronize in-memory fallback store safely
    for (const d of fallbackDesigns) {
      const f = d.stitch_count_front !== undefined ? d.stitch_count_front : d.frontStitchCount;
      const b = d.stitch_count_back !== undefined ? d.stitch_count_back : d.backStitchCount;
      const s = d.stitch_count_sleeve !== undefined ? d.stitch_count_sleeve : d.sleeveStitchCount;
      if (f !== null && f !== undefined && b !== null && b !== undefined && s !== null && s !== undefined) {
        d.stitch_count = Number(f) + Number(b) + Number(s);
        d.totalStitchCount = d.stitch_count;
      } else if (f !== null && f !== undefined || b !== null && b !== undefined || s !== null && s !== undefined) {
        d.stitch_count = null;
        d.totalStitchCount = null;
      }
      this.normalizeStitchCounts(d);
    }
    saveFallbackDesigns(fallbackDesigns);
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

    const rawFront = data.stitch_count_front !== undefined ? data.stitch_count_front : (data.frontStitchCount !== undefined ? data.frontStitchCount : data.front_stitch_count);
    const rawBack = data.stitch_count_back !== undefined ? data.stitch_count_back : (data.backStitchCount !== undefined ? data.backStitchCount : data.back_stitch_count);
    const rawSleeve = data.stitch_count_sleeve !== undefined ? data.stitch_count_sleeve : (data.sleeveStitchCount !== undefined ? data.sleeveStitchCount : data.sleeve_stitch_count);
    const rawTotal = data.stitch_count_total !== undefined ? data.stitch_count_total : (data.stitch_count !== undefined ? data.stitch_count : (data.totalStitchCount !== undefined ? data.totalStitchCount : data.total_stitch_count));
    const isManual = (data.stitch_total_manual === 1 || data.stitch_total_manual === '1' || data.stitchTotalManual === 1 || data.stitchTotalManual === '1');

    const frontStitchVal = parseStitch(rawFront);
    const backStitchVal = parseStitch(rawBack);
    const sleeveStitchVal = parseStitch(rawSleeve);
    
    // Auto vs Manual calculation rule
    let mainStitchVal = null;
    if (isManual) {
      mainStitchVal = parseStitch(rawTotal);
    } else {
      // Auto: total = front + back + sleeve (treat empty as 0; if all three are empty, total stays NULL).
      if (frontStitchVal !== null || backStitchVal !== null || sleeveStitchVal !== null) {
        mainStitchVal = (frontStitchVal || 0) + (backStitchVal || 0) + (sleeveStitchVal || 0);
      } else {
        mainStitchVal = parseStitch(rawTotal);
      }
    }

    let insertedId = null;

    if (db.isConnected()) {
      try {
        await this.ensureDatabaseColumns();
        const availableCols = await this.getAvailableColumns();

        const insertMap = {
          title: title,
          sku: finalSku,
          slug: finalSlug,
          price: price,
          sale_price: sale_price || null,
          category_id: category_id || null,
          hoop_size: hoop_size || null,
          stitch_count: mainStitchVal,
          stitch_count_total: mainStitchVal,
          stitch_total_manual: isManual ? 1 : 0,
          stitch_count_front: frontStitchVal,
          stitch_count_back: backStitchVal,
          stitch_count_sleeve: sleeveStitchVal,
          dimensions: dimensions || null,
          formats: formats || '',
          is_featured: is_featured ? 1 : 0,
          is_trending: is_trending ? 1 : 0,
          is_active: is_active ? 1 : 0,
          download_count: download_count ? parseInt(download_count) : 0,
          tags: tags || null,
          average_rating: avgRatingVal,
          reviews_count: revCountVal,
          import_image_filename: import_image_filename || null,
          import_zip_filename: import_zip_filename || null,
          description: description || null
        };

        const executeInsert = async (skuToUse) => {
          insertMap.sku = skuToUse;
          const activeCols = [];
          const activeVals = [];
          for (const [col, val] of Object.entries(insertMap)) {
            if (availableCols.size === 0 || availableCols.has(col)) {
              activeCols.push(`\`${col}\``);
              activeVals.push(val);
            }
          }
          const placeholders = activeCols.map(() => '?').join(', ');
          return await db.query(
            `INSERT INTO designs (${activeCols.join(', ')}) VALUES (${placeholders})`,
            activeVals
          );
        };

        try {
          const res = await executeInsert(finalSku);
          if (res && res.insertId) insertedId = res.insertId;
        } catch (err) {
          console.error('[Design.create DB Error]:', err.message);
          if (err.code === 'ER_DUP_ENTRY' && String(err.message).toLowerCase().includes('sku')) {
            try {
              finalSku = await this.getNextSkuForCategory(category_id);
              const retryRes = await executeInsert(finalSku);
              if (retryRes && retryRes.insertId) insertedId = retryRes.insertId;
            } catch (retryErr) {
              console.error('[Design.create Retry Error]:', retryErr.message);
            }
          } else if (err.message && err.message.includes('Unknown column')) {
            console.warn('[Design.create Auto-Repairing Missing Column]:', err.message);
            await this.ensureDatabaseColumns();
            this._availableColumns = null;
            const res = await executeInsert(finalSku);
            if (res && res.insertId) insertedId = res.insertId;
          } else {
            throw err;
          }
        }
      } catch (outerErr) {
        console.error('[Design.create Outer Error]:', outerErr.message);
        throw outerErr;
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
      stitch_count_total: mainStitchVal,
      totalStitchCount: mainStitchVal,
      stitch_total_manual: isManual ? 1 : 0,
      stitchTotalManual: isManual ? 1 : 0,
      stitch_count_front: frontStitchVal,
      frontStitchCount: frontStitchVal,
      stitch_count_back: backStitchVal,
      backStitchCount: backStitchVal,
      stitch_count_sleeve: sleeveStitchVal,
      sleeveStitchCount: sleeveStitchVal,
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
    this.normalizeStitchCounts(newDesign);

    const existingIdx = fallbackDesigns.findIndex(d => d.id == insertedId);
    if (existingIdx !== -1) {
      fallbackDesigns[existingIdx] = newDesign;
    } else {
      fallbackDesigns.unshift(newDesign);
    }
    saveFallbackDesigns(fallbackDesigns);

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

    const rawFront = data.stitch_count_front !== undefined ? data.stitch_count_front : (data.frontStitchCount !== undefined ? data.frontStitchCount : data.front_stitch_count);
    const rawBack = data.stitch_count_back !== undefined ? data.stitch_count_back : (data.backStitchCount !== undefined ? data.backStitchCount : data.back_stitch_count);
    const rawSleeve = data.stitch_count_sleeve !== undefined ? data.stitch_count_sleeve : (data.sleeveStitchCount !== undefined ? data.sleeveStitchCount : data.sleeve_stitch_count);
    const rawTotal = data.stitch_count_total !== undefined ? data.stitch_count_total : (data.stitch_count !== undefined ? data.stitch_count : (data.totalStitchCount !== undefined ? data.totalStitchCount : data.total_stitch_count));
    const isManual = data.stitch_total_manual !== undefined
      ? (data.stitch_total_manual === 1 || data.stitch_total_manual === '1' || data.stitchTotalManual === 1 || data.stitchTotalManual === '1')
      : undefined;

    const frontStitchVal = parseStitch(rawFront);
    const backStitchVal = parseStitch(rawBack);
    const sleeveStitchVal = parseStitch(rawSleeve);

    let computedStitchCount = parseStitch(rawTotal);
    if (computedStitchCount === undefined && (frontStitchVal !== undefined || backStitchVal !== undefined || sleeveStitchVal !== undefined)) {
      const existing = fallbackDesigns.find(d => d.id == id);
      const f = frontStitchVal !== undefined ? frontStitchVal : (existing ? (existing.stitch_count_front ?? existing.frontStitchCount) : null);
      const b = backStitchVal !== undefined ? backStitchVal : (existing ? (existing.stitch_count_back ?? existing.backStitchCount) : null);
      const s = sleeveStitchVal !== undefined ? sleeveStitchVal : (existing ? (existing.stitch_count_sleeve ?? existing.sleeveStitchCount) : null);

      if (f !== null || b !== null || s !== null) {
        computedStitchCount = (f || 0) + (b || 0) + (s || 0);
      } else {
        computedStitchCount = null;
      }
    }

    if (db.isConnected()) {
      try {
        let updateFields = [];
        let updateParams = [];

        await this.ensureDatabaseColumns();
        const availableCols = await this.getAvailableColumns();

        // Helper to push field only if column exists in table (or if table columns unknown)
        const addUpdateField = (col, val) => {
          if (availableCols.size === 0 || availableCols.has(col.toLowerCase())) {
            updateFields.push(`\`${col}\`=?`);
            updateParams.push(val);
          }
        };

        if (title !== undefined) addUpdateField('title', title);
        if (sku !== undefined) addUpdateField('sku', sku || null);
        if (finalSlug !== undefined) addUpdateField('slug', finalSlug);
        if (price !== undefined) addUpdateField('price', price);
        if (sale_price !== undefined) addUpdateField('sale_price', sale_price !== null && sale_price !== '' ? sale_price : null);
        if (category_id !== undefined) addUpdateField('category_id', category_id || null);
        if (hoop_size !== undefined) addUpdateField('hoop_size', hoop_size || null);
        if (computedStitchCount !== undefined) {
          addUpdateField('stitch_count', computedStitchCount);
          addUpdateField('stitch_count_total', computedStitchCount);
        }
        if (isManual !== undefined) addUpdateField('stitch_total_manual', isManual ? 1 : 0);
        if (frontStitchVal !== undefined) addUpdateField('stitch_count_front', frontStitchVal);
        if (backStitchVal !== undefined) addUpdateField('stitch_count_back', backStitchVal);
        if (sleeveStitchVal !== undefined) addUpdateField('stitch_count_sleeve', sleeveStitchVal);
        if (description !== undefined) addUpdateField('description', description || null);
        if (dimensions !== undefined) addUpdateField('dimensions', dimensions || null);
        if (formats !== undefined) addUpdateField('formats', formats || '');
        if (is_featured !== undefined) addUpdateField('is_featured', is_featured ? 1 : 0);
        if (is_trending !== undefined) addUpdateField('is_trending', is_trending ? 1 : 0);
        if (is_active !== undefined) addUpdateField('is_active', is_active ? 1 : 0);
        if (download_count !== undefined) addUpdateField('download_count', download_count ? parseInt(download_count) : 0);
        if (tags !== undefined) addUpdateField('tags', tags || null);
        if (import_image_filename !== undefined) addUpdateField('import_image_filename', import_image_filename || null);
        if (import_zip_filename !== undefined) addUpdateField('import_zip_filename', import_zip_filename || null);
        if (avgRatingVal !== undefined) addUpdateField('average_rating', avgRatingVal);
        if (revCountVal !== undefined) addUpdateField('reviews_count', revCountVal);

        if (updateFields.length > 0) {
          updateParams.push(id);
          try {
            await db.query(
              `UPDATE designs SET ${updateFields.join(', ')} WHERE id=?`,
              updateParams
            );
          } catch (updateErr) {
            if (updateErr.message && updateErr.message.includes('Unknown column')) {
              console.warn('[Design.update Auto-Repairing Missing Column]:', updateErr.message);
              await this.ensureDatabaseColumns();
              this._availableColumns = null;
              const refreshedCols = await this.getAvailableColumns();
              const safeFields = [];
              const safeParams = [];
              for (let i = 0; i < updateFields.length; i++) {
                const colName = updateFields[i].split('=')[0].replace(/[`"]/g, '').trim().toLowerCase();
                if (refreshedCols.size === 0 || refreshedCols.has(colName)) {
                  safeFields.push(updateFields[i]);
                  safeParams.push(updateParams[i]);
                }
              }
              if (safeFields.length > 0) {
                safeParams.push(id);
                await db.query(
                  `UPDATE designs SET ${safeFields.join(', ')} WHERE id=?`,
                  safeParams
                );
              }
            } else {
              throw updateErr;
            }
          }
        }
      } catch (err) {
        console.error('[Design.update DB Error]:', err.message);
        throw err;
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
      if (computedStitchCount !== undefined) {
        target.stitch_count = computedStitchCount;
        target.stitch_count_total = computedStitchCount;
        target.totalStitchCount = computedStitchCount;
      }
      if (isManual !== undefined) {
        target.stitch_total_manual = isManual ? 1 : 0;
        target.stitchTotalManual = target.stitch_total_manual;
      }
      if (frontStitchVal !== undefined) {
        target.stitch_count_front = frontStitchVal;
        target.frontStitchCount = frontStitchVal;
      }
      if (backStitchVal !== undefined) {
        target.stitch_count_back = backStitchVal;
        target.backStitchCount = backStitchVal;
      }
      if (sleeveStitchVal !== undefined) {
        target.stitch_count_sleeve = sleeveStitchVal;
        target.sleeveStitchCount = sleeveStitchVal;
      }
      this.normalizeStitchCounts(target);
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
    saveFallbackDesigns(fallbackDesigns);
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
        if (rows && rows[0]) return this.normalizeStitchCounts(rows[0]);
      } catch (e) {
        console.warn('[Design.findBySku DB error]:', e.message);
      }
    }
    const found = fallbackDesigns.find(d => d.sku && d.sku.trim().toLowerCase() === cleanSku.toLowerCase()) || null;
    return this.normalizeStitchCounts(found);
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
    saveFallbackDesigns(fallbackDesigns);
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
    saveFallbackDesigns(fallbackDesigns);
    return true;
  }

  static async deleteBulk(ids) {
    if (!ids || !Array.isArray(ids) || ids.length === 0) return true;
    for (const id of ids) {
      await this.delete(id);
    }
    return true;
  }

  static async duplicate(id) {
    const original = await this.getById(id);
    if (!original) throw new Error('Design not found');

    const newTitle = `${original.title} (Copy)`;
    const newSlug = await this.generateUniqueSlug(newTitle);
    let newSku = null;
    try {
      if (original.category_id) {
        newSku = await this.getNextSkuForCategory(original.category_id);
      }
    } catch (e) {
      newSku = `AED-CPY-${Date.now().toString().slice(-4)}`;
    }

    const newDesignId = await this.create({
      title: newTitle,
      slug: newSlug,
      sku: newSku,
      description: original.description || '',
      price: original.price || 0,
      sale_price: original.sale_price !== null && original.sale_price !== undefined ? original.sale_price : null,
      category_id: original.category_id,
      hoop_size: original.hoop_size || null,
      stitch_count: original.stitch_count || null,
      stitch_count_total: original.stitch_count_total ?? original.totalStitchCount ?? original.stitch_count ?? null,
      stitch_total_manual: original.stitch_total_manual ?? original.stitchTotalManual ?? 0,
      stitch_count_front: original.stitch_count_front ?? original.frontStitchCount ?? null,
      stitch_count_back: original.stitch_count_back ?? original.backStitchCount ?? null,
      stitch_count_sleeve: original.stitch_count_sleeve ?? original.sleeveStitchCount ?? null,
      dimensions: original.dimensions || null,
      formats: original.formats || 'DST',
      tags: original.tags || null,
      is_featured: 0,
      is_active: 0
    });

    if (original.images && original.images.length > 0) {
      for (const img of original.images) {
        await this.addImage(newDesignId, img.image_url, img.is_primary, img.display_order);
      }
    }
    if (original.files && original.files.length > 0) {
      for (const f of original.files) {
        await this.addFile(newDesignId, f.file_name, f.file_path, f.file_format, f.file_size, f.is_preview);
      }
    }

    return newDesignId;
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

  /**
   * Automatically ensures all stitch columns, audit tables, and schema migrations exist.
   * Completely self-healing on startup and when called from health checks.
   */
  static async ensureDatabaseColumns() {
    if (!db.isConnected()) return false;

    try {
      // 1. Ensure designs columns
      const designCols = [
        ['stitch_count_front', 'INT UNSIGNED NULL DEFAULT NULL'],
        ['stitch_count_back', 'INT UNSIGNED NULL DEFAULT NULL'],
        ['stitch_count_sleeve', 'INT UNSIGNED NULL DEFAULT NULL'],
        ['stitch_count_total', 'INT UNSIGNED NULL DEFAULT NULL'],
        ['stitch_total_manual', 'TINYINT NOT NULL DEFAULT 0'],
        ['stitch_count', 'INT UNSIGNED NULL DEFAULT NULL']
      ];

      for (const [col, typeDef] of designCols) {
        try {
          await db.query(`ALTER TABLE \`designs\` ADD COLUMN IF NOT EXISTS \`${col}\` ${typeDef}`);
        } catch (colErr) {
          if (colErr.message && (colErr.message.includes('IF NOT EXISTS') || colErr.errno === 1064)) {
            const chk = await db.query(
              'SELECT COUNT(*) as count FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = "designs" AND column_name = ?',
              [col]
            );
            if (chk && chk[0] && chk[0].count === 0) {
              await db.query(`ALTER TABLE \`designs\` ADD COLUMN \`${col}\` ${typeDef}`);
            }
          }
        }
      }

      // 2. Ensure import_job_items columns
      const [importJobTableCheck] = await db.query("SHOW TABLES LIKE 'import_job_items'") || [];
      if (importJobTableCheck) {
        const importCols = [
          ['stitch_count_front', 'INT UNSIGNED NULL DEFAULT NULL'],
          ['stitch_count_back', 'INT UNSIGNED NULL DEFAULT NULL'],
          ['stitch_count_sleeve', 'INT UNSIGNED NULL DEFAULT NULL'],
          ['stitch_count_total', 'INT UNSIGNED NULL DEFAULT NULL'],
          ['stitch_total_manual', 'TINYINT NOT NULL DEFAULT 0']
        ];
        for (const [col, typeDef] of importCols) {
          try {
            await db.query(`ALTER TABLE \`import_job_items\` ADD COLUMN IF NOT EXISTS \`${col}\` ${typeDef}`);
          } catch (e) {
            try {
              const chk = await db.query(
                'SELECT COUNT(*) as count FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = "import_job_items" AND column_name = ?',
                [col]
              );
              if (chk && chk[0] && chk[0].count === 0) {
                await db.query(`ALTER TABLE \`import_job_items\` ADD COLUMN \`${col}\` ${typeDef}`);
              }
            } catch (ignore) {}
          }
        }
      }

      // 3. Ensure stitch_update_logs table
      await db.query(`
        CREATE TABLE IF NOT EXISTS \`stitch_update_logs\` (
          \`id\` INT AUTO_INCREMENT PRIMARY KEY,
          \`admin_id\` INT NULL,
          \`admin_email\` VARCHAR(150) NULL,
          \`filter_summary\` TEXT NULL,
          \`method_summary\` TEXT NULL,
          \`total_affected\` INT NOT NULL DEFAULT 0,
          \`is_undone\` TINYINT(1) NOT NULL DEFAULT 0,
          \`undone_at\` DATETIME NULL,
          \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      // 4. Ensure stitch_update_log_items table
      await db.query(`
        CREATE TABLE IF NOT EXISTS \`stitch_update_log_items\` (
          \`id\` INT AUTO_INCREMENT PRIMARY KEY,
          \`log_id\` INT NOT NULL,
          \`design_id\` INT NOT NULL,
          \`sku\` VARCHAR(100) NULL,
          \`old_front\` INT UNSIGNED NULL,
          \`old_back\` INT UNSIGNED NULL,
          \`old_sleeve\` INT UNSIGNED NULL,
          \`old_total\` INT UNSIGNED NULL,
          \`old_manual\` TINYINT NOT NULL DEFAULT 0,
          \`new_front\` INT UNSIGNED NULL,
          \`new_back\` INT UNSIGNED NULL,
          \`new_sleeve\` INT UNSIGNED NULL,
          \`new_total\` INT UNSIGNED NULL,
          \`new_manual\` TINYINT NOT NULL DEFAULT 0,
          \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX \`idx_stitch_log_id\` (\`log_id\`),
          INDEX \`idx_stitch_design_id\` (\`design_id\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      // 5. Ensure schema_migrations table exists and register 017
      await db.query(`
        CREATE TABLE IF NOT EXISTS \`schema_migrations\` (
          \`id\` INT AUTO_INCREMENT PRIMARY KEY,
          \`version\` VARCHAR(100) NOT NULL UNIQUE,
          \`name\` VARCHAR(255) NOT NULL,
          \`applied_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await db.query(`
        INSERT IGNORE INTO \`schema_migrations\` (\`version\`, \`name\`)
        VALUES ('017', '017_stitch_counts_and_bulk_update.sql')
      `);

      // 6. Ensure default stitch settings in settings table
      await db.query(`
        INSERT INTO \`settings\` (\`setting_key\`, \`setting_value\`) VALUES
          ('stitch_number_format', 'indian'),
          ('show_stitch_front', '1'),
          ('label_stitch_front', 'Stitch Count (Front)'),
          ('show_stitch_back', '1'),
          ('label_stitch_back', 'Stitch Count (Back)'),
          ('show_stitch_sleeve', '1'),
          ('label_stitch_sleeve', 'Stitch Count (Sleeve)'),
          ('show_stitch_total', '1'),
          ('label_stitch_total', 'Total Stitch Count'),
          ('show_stitch_on_cards', '0')
        ON DUPLICATE KEY UPDATE \`setting_key\` = \`setting_key\`
      `);

      return true;
    } catch (err) {
      console.warn('[Design.ensureDatabaseColumns] Notice:', err.message);
      return false;
    }
  }

  /**
   * Auto-repairs missing or invalid slugs for existing catalog designs
   */
  static async repairInvalidDatabaseSlugs() {
    if (!db.isConnected()) return;
    try {
      const invalidDesigns = await db.query("SELECT id, title FROM designs WHERE slug IS NULL OR slug = '' OR slug = 'undefined' LIMIT 50");
      if (Array.isArray(invalidDesigns) && invalidDesigns.length > 0) {
        for (const d of invalidDesigns) {
          const freshSlug = await this.generateUniqueSlug(d.title || `design-${d.id}`, d.id);
          await db.query('UPDATE designs SET slug = ? WHERE id = ?', [freshSlug, d.id]);
        }
      }
    } catch (err) {
      console.warn('[repairInvalidDatabaseSlugs] Notice:', err.message);
    }
  }

  /**
   * Auto-syncs legacy stitch_count with stitch_count_total
   */
  static async repairExistingStitchCounts() {
    if (!db.isConnected()) return;
    try {
      await db.query(`
        UPDATE designs 
        SET stitch_count_total = stitch_count 
        WHERE stitch_count_total IS NULL AND stitch_count IS NOT NULL AND stitch_count > 0
      `);
      await db.query(`
        UPDATE designs 
        SET stitch_count = stitch_count_total 
        WHERE stitch_count IS NULL AND stitch_count_total IS NOT NULL AND stitch_count_total > 0
      `);
    } catch (err) {
      console.warn('[repairExistingStitchCounts] Notice:', err.message);
    }
  }
}

module.exports = Design;

