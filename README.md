# Aruvi Embroidery Website
> **Tagline:** *"Where Threads Tell Stories"*

A complete, professional e-commerce platform for **Aruvi Embroidery**, built with Node.js, Express.js, EJS, and MySQL. Specializing in digitized digital embroidery design files (DST, PES, JEF, EXP, HUS, VIP, VP3, XXX) for traditional South Indian attire, bridal blouse motifs, sarees, temple gods, and modern floral art.

---

## 🌟 Tech Stack & Features

- **Backend:** Node.js, Express.js (MVC Architecture)
- **Database:** MySQL (via `mysql2` connection pool with `.env` credentials & parameterized queries)
- **Frontend / Templating:** EJS + HTML5 + Custom Vanilla CSS3 (Playfair Display & Poppins typography, brand color palette `#BB4558` and blush `#F8E8E2`, stitch-line dividers, watermarked previews)
- **Authentication & Security:** `express-session`, `bcryptjs` password hashing, Helmet security headers, `express-rate-limit`, session-based CSRF protection, input validation
- **File Uploads:** `multer` (for preview watermarked images & downloadable design archives)
- **Payment Gateway:** Razorpay integration (INR `₹`, India) with test mode setup and simulated checkout fallback
- **Email Notifications:** Nodemailer order confirmation emails

---

## 📁 Directory Structure

```
Aruvi Embroidery Web/
├── config/
│   └── db.js                 # MySQL pool connection module
├── controllers/
│   ├── homeController.js      # Homepage logic
│   ├── shopController.js      # Shop listing, filters, search & detail page
│   ├── cartController.js      # Cart management & coupon application
│   ├── authController.js      # Login, Register, Logout
│   ├── userController.js      # User dashboard, orders & secure downloads
│   ├── checkoutController.js  # Razorpay checkout & payment verification
│   ├── pageController.js      # About, Contact, FAQ, Legal pages & sitemap.xml
│   └── admin/                # Admin Panel controllers (designs, orders, categories, coupons, etc.)
├── middleware/
│   ├── auth.js               # Auth & Admin check, cart locals attachment
│   ├── csrf.js               # CSRF token protection
│   ├── multerUpload.js       # File upload handler
│   └── errorHandler.js       # Global error handler
├── models/                   # Data access objects (User, Design, Order, Category, etc.)
├── public/
│   ├── css/                  # Custom CSS (main.css, admin.css)
│   ├── js/                   # Client-side scripts (main.js, checkout.js)
│   ├── images/               # Brand logo & assets (/public/images/logo.jpg)
│   └── uploads/              # Preview images and downloadable ZIP design packages
├── routes/                   # Modular Express routes
├── views/                    # EJS views & partials (header, footer, admin panel)
├── schema.sql                # Complete MySQL Database Schema
├── seed.sql                  # Seed data with Admin user, categories, designs & coupons
├── scripts/
│   ├── init-db.js            # Automated database setup script
│   └── create-sample-files.js# Sample design ZIP file generator
├── server.js                 # Express Application Entry Point
├── package.json
├── .env.example
└── README.md
```

---

## 🚀 Quick Setup & Installation Guide

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Ensure your database credentials in `.env` match your MySQL installation:
```env
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=aruvi_embroidery

RAZORPAY_KEY_ID=rzp_test_samplekey123
RAZORPAY_KEY_SECRET=sample_secret_key_456
```

### 3. Initialize Database & Seed Data
To create the MySQL database `aruvi_embroidery` and import all tables and sample data:
```bash
npm run init-db
```
*(Alternatively, import `schema.sql` and `seed.sql` into MySQL Workbench or phpMyAdmin).*

### 4. Start the Application
- **Development Mode (with auto-reload):**
  ```bash
  npm run dev
  ```
- **Production Mode:**
  ```bash
  npm start
  ```

Open your browser at `http://localhost:3000`.

---

## 🔐 Default Credentials

### Admin Account
- **URL:** `http://localhost:3000/admin`
- **Email:** `admin@aruviembroidery.com`
- **Password:** `admin123`

### Sample Customer Account
- **URL:** `http://localhost:3000/auth/login`
- **Email:** `customer@aruviembroidery.com`
- **Password:** `customer123`

---

## 🛒 Features Highlight

1. **Brand Palette & Stitch Design:** Built around Aruvi Embroidery's brand colors (`#BB4558` primary, `#F8E8E2` blush background, `#4B0F1C` text, `#C7876C` stitch dividers).
2. **Logo Integration:** Uses official logo file at `/public/images/logo.jpg` in header, footer, favicon, and previews.
3. **Instant Digital Downloads:** After Razorpay payment completion, purchased design ZIP packages (DST, PES, JEF, EXP, etc.) become downloadable from the user dashboard.
4. **Admin Panel (`/admin`):** Full CRUD for designs, categories, orders, coupons, customer directory, contact messages, and site settings.
5. **SEO & Clean URLs:** Dynamic Open Graph tags, descriptive titles, and XML Sitemap generator (`/sitemap.xml`).

---

## 🚀 Production Deployment & Data Safety Guide

### 1. Data Safety Architecture
- **Uploads Outside Git:** All admin-uploaded preview images and machine design archives (`DST`, `PES`, `JEF`, `EXP`, `ZIP`) are strictly excluded from Git. Git pulls or pushes will never overwrite or erase uploaded files.
- **Configurable Persistent Storage:** Configured via `UPLOAD_DIR` in `.env` (e.g., `UPLOAD_DIR=/var/data/uploads`). Files reside outside the ephemeral deployment repository path.
- **Private Paid Files:** Paid design files are stored in `private_designs/` and can never be accessed statically. They are served strictly through authenticated download routes.
- **Database Safety:** Startup code **never** runs `DROP TABLE`, `TRUNCATE`, or auto-seeds. Database updates use numbered migration files (`npm run migrate`) with `CREATE TABLE IF NOT EXISTS` and non-destructive column additions.

---

### 2. What to Back Up
Always take regular backups of both:
1. **The Database:** Contains product metadata, orders, customers, and image references.
2. **The Upload Folder:** Contains the physical product preview images and digital design archives.

#### Database Backup Command:
```bash
mysqldump -u root -p aruvi_embroidery > backup_aruvi_db_$(date +%F_%T).sql
```

#### Uploads Directory Backup Command:
```bash
# If UPLOAD_DIR=/var/data/uploads:
tar -czf backup_aruvi_uploads_$(date +%F_%T).tar.gz -C /var/data uploads
```

---

### 3. How to Deploy Without Losing Data
**Deploy = git push + restart; migrations apply automatically.**

When pushing or pulling code updates to production:

1. **Keep `.env` intact:** Ensure `.env` is outside Git and contains your persistent storage path and live DB configuration:
   ```env
   UPLOAD_DIR=/var/data/uploads
   STORAGE_DRIVER=local
   DB_HOST=127.0.0.1
   DB_NAME=u101925264_aedesign
   DB_USER=u101925264_aedesign
   DB_PASSWORD=your_production_password
   ```
2. **Deploy updates (Git Push & Restart):**
   ```bash
   git pull origin main
   npm install --production
   pm2 restart aruvi-app || npm start
   ```
   *Migrations apply automatically on server start!* `server.js` executes any pending numbered migrations (`migrations/001_*.sql`, etc.) sequentially, records them in `schema_migrations`, and never touches existing data.
3. **Manual Migration Command (Optional):**
   ```bash
   npm run migrate
   ```
4. **Live phpMyAdmin One-Click Sync:**
   If your live database is missing newer tables (e.g., `import_jobs`, `file_scan_results`, `download_logs`), you can copy and run the idempotent sync script directly in phpMyAdmin:
   `migrations/production_sync.sql`
   *(Contains only `CREATE TABLE IF NOT EXISTS` and safe dynamic column/index checks. Never drops or alters existing data).*
5. **System Health Verification:**
   Visit **Admin → Tools → System Health** (`/admin/tools/system-health`) to verify that all 28 tables and 225+ columns exist with green indicators.
6. **Future Development Rule:**
   Every future feature that introduces a new table or column **must** include a new numbered migration file in `migrations/` (e.g., `migrations/011_feature_name.sql`). Deploying will automatically apply it upon restart.
   ```bash
   pm2 restart aruvi-embroidery
   # or: systemctl restart aruvi-embroidery
   ```

> **Note on Initial Setup:** To populate starter data on an empty fresh database, run `npm run seed`. If the database already has existing products or users, `npm run seed` will automatically detect them and safely skip execution without overwriting your data.

---

---

## 🛡️ Safe Deployment & Persistent Storage Architecture

### 1. Storage Architecture (`STORAGE_DRIVER`)
All uploaded files are decoupled from application code and git revisions:
- **`STORAGE_DRIVER=local` (Default):** Saves to `UPLOAD_DIR` (an absolute path outside the project, e.g. `/var/data/aruvi-uploads`), mounted as a persistent disk volume.
- **`STORAGE_DRIVER=s3`:** Cloudflare R2 / AWS S3 compatible object storage (via `@aws-sdk/client-s3`). Public preview images are delivered via CDN; paid design files (DST, PES, JEF, EXP, ZIP) are placed in private storage and served only through authenticated, time-limited presigned URLs.
- **`STORAGE_DRIVER=cloudinary`:** High-speed preview image hosting.
- **Unique Filenames:** Generated with collision-free timestamps + random hex IDs (`file-<timestamp>-<hex>.<ext>`), preventing accidental overwrites.

### 2. Git & Deploy Safety Rules
1. **Never track uploads in Git:** All upload directories (`public/uploads/*`, `uploads/*`, `private_uploads/*`, `backups/*`) are explicitly ignored in `.gitignore`.
2. **Startup Safety Check:** On boot, `storage.validateStorageConfiguration()` verifies the upload path and warns if `UPLOAD_DIR` is inside the git repository.
3. **Database Integrity:** No auto-seeding, `DROP`, or `TRUNCATE` operations on deploy or startup. Database updates are handled solely through safe numbered migrations (`npm run migrate`).

### 3. Brand Assets (Logo, Favicon, Banners)
- **Committed Defaults:** Default brand assets live permanently in `/public/assets/brand/` (`logo.png`, `logo.jpg`, `favicon.ico`, `hero_embroidery.jpg`) and are committed to Git.
- **Permanent Fallback:** `storage.resolveBrandAsset(type, candidateUrl)` verifies physical existence on disk. If a custom uploaded asset is missing or corrupt, it seamlessly falls back to `/public/assets/brand/`—**never showing a broken image**.

### 4. Bulk Recovery Tools (For 2000+ Designs)
Located in **Admin Panel → Storage & Recovery**:
- **Bulk Image Relink (`/admin/tools/bulk-image-relink`):** Upload a ZIP or provide a folder path. The engine automatically matches files to products by SKU (`AED-BLO-01.jpg` → `AED-BLO-01`), design title, or ID. Displays an interactive **Match Preview Report** (Matched / Unmatched / Duplicates) before committing to persistent storage.
- **Bulk Machine File Relink (`/admin/tools/bulk-file-relink`):** Matches DST/PES/JEF/EXP/ZIP files by SKU or title, detects machine formats, and links them into private storage.
- **Missing Files Report (`/admin/tools/missing-files`):** Real-time diagnostic scan identifying any product with missing preview images or machine archives. Features:
  - Filters (Missing Image, Missing Machine File, Missing Both).
  - Export CSV Report.
  - One-click "Upload & Relink" modal for instantaneous replacement.

### 5. Automated Backups & Daily Cron Schedule
- **Manual / CLI Backup:** Run `npm run backup` to dump MySQL and archive all uploads to a timestamped archive: `backups/aruvi_backup_<timestamp>.zip`.
- **Admin Dashboard:** Download and manage backups directly from `/admin/tools/backup`.
- **Automated Daily Cron (Midnight):**
  ```bash
  0 2 * * * cd /var/www/aruvi-embroidery && npm run backup >> /var/log/aruvi-backup.log 2>&1
  ```
  *(Archives are automatically pruned after 30 days to save disk space).*

---

## 🧪 Verification & Test Results (Passed)

The permanent storage fix and deployment safety pipeline were rigorously verified:

| Test Case | Verification Performed | Result |
| :--- | :--- | :--- |
| **Startup Check** | Validated persistent storage configuration and project root isolation | **PASSED** ✓ |
| **Brand Asset Fallback** | Tested nonexistent logo/favicon paths; verified physical presence of `/public/assets/brand/` defaults | **PASSED** ✓ |
| **Public Asset Persistence** | Uploaded 3 distinct test images (`.jpg`, `.png`, `.webp`) via `savePublicFile` | **PASSED** ✓ |
| **Private File Security** | Uploaded 3 machine files (`.dst`, `.pes`, `.zip`) via `savePrivateFile` to private storage | **PASSED** ✓ |
| **Integrity Health Scanner** | Scanned 100% of catalog designs against disk storage paths | **PASSED** ✓ |
| **Full Backup Pipeline** | Executed `npm run backup`: dumped MySQL + compressed uploads into standalone ZIP (`32.40 MB`) | **PASSED** ✓ |
| **Bulk Relink Matcher** | Tested auto-matcher against sample SKU `AED-BLO-01` and complex variants | **PASSED** ✓ |

