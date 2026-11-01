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
   Visit **Admin → Tools → System Health** (`/admin/tools/system-health`) to verify that all database tables and columns exist with green indicators. If any column is missing, a prominent alert is shown on both the Dashboard and System Health.

6. **MANDATORY RULE FOR FUTURE WORK:**
   > ⚠️ **CRITICAL RULE:** Any code change that needs a new table or column **MUST include a numbered migration file in the same change** (e.g. `migrations/017_descriptive_name.sql`).
   > - All migration statements must use MariaDB 10.x compatible, strictly idempotent syntax: `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`.
   > - Sensible types and defaults must be specified (e.g., `INT UNSIGNED NULL DEFAULT NULL`) so existing production rows are never corrupted.
   > - Never use reserved words as unquoted column names.
   > - Migrations must NEVER drop, truncate, rename, or delete existing data.
   > - On deployment / restart, the application automatically applies pending migrations and runs a schema safety check before serving requests.

   ```bash
   npm run migrate
   # or restart: pm2 restart aruvi-embroidery
   ```

> **Note on Initial Setup:** To populate starter data on an empty fresh database, run `npm run seed`. If the database already has existing products or users, `npm run seed` will automatically detect them and safely skip execution without overwriting your data.

---

---

---

## 🚀 Safe Deployment on Hostinger Business (Zero-Loss Architecture)

### 1. The Hostinger Deployment Reality
Hostinger Business plan runs Node.js web applications using an automated git build system. Each git push creates a new deployment folder:
```
/home/u101925264/domains/aruviembroidery.com/hbuilds/versions/<commit_id>/
```
Any upload saved inside the project directory or inside `public/uploads` will be wiped on the next push. To guarantee that **uploaded images, ZIP/machine files, thumbnails, logos, banners, and custom-request images NEVER go missing**, this application uses an isolated persistent storage directory located outside all build paths.

### 2. Configure Persistent Storage in hPanel
1. Log into **Hostinger hPanel**.
2. Navigate to **Websites** &rarr; **aruviembroidery.com** &rarr; **Node.js**.
3. Under **Environment variables**, set:
   ```env
   UPLOAD_DIR=/home/u101925264/aruvi-uploads
   BACKUP_DIR=/home/u101925264/aruvi-backups
   NODE_ENV=production
   ```
4. Click **Save** and then click **Restart** (or trigger a Redeploy).
5. On boot, the app will automatically verify write permissions, create the persistent subdirectories (`public/previews`, `public/cards`, `public/thumbs`, `public/branding`, `public/banners`, `private/designs`, `private/originals`, `private/custom-requests`), and log:
   ```
   [STORAGE]: Persistent upload directory active: /home/u101925264/aruvi-uploads (writable: yes)
   ```

### 3. Recover Uploads from Old Deployments
If past git pushes caused uploads to be scattered across older `hbuilds/versions/<id>` folders:
- **Via Admin UI:**
  Navigate to **Admin Panel** &rarr; **Storage & Recovery** &rarr; **Missing Files Report** &rarr; Click **"Recover from Old Deployments"**.
  - Choose **Dry Run** to scan and inspect recoverable files.
  - Choose **Apply Recovery** to safely copy all missing previews, machine files, and branding into your persistent `UPLOAD_DIR` without touching existing database keys.
- **Via SSH / Terminal:**
  ```bash
  # Test scan (dry run)
  npm run recover-uploads

  # Apply copy to persistent UPLOAD_DIR
  npm run recover-uploads -- --apply
  ```

### 4. Database Migrations & phpMyAdmin Sync
- The application executes idempotent migrations automatically at startup via `schema_migrations`.
- To manually synchronize a MariaDB database in phpMyAdmin:
  1. Open phpMyAdmin from hPanel.
  2. Select your database `u101925264_...`.
  3. Go to the **Import** or **SQL** tab and execute the file:
     `migrations/production_sync.sql`
  4. This script uses strictly MariaDB 10.x compatible `IF NOT EXISTS` syntax and will never overwrite or drop existing tables or catalog records.

### 5. Automated Daily Backups (hPanel Cron)
In **hPanel** &rarr; **Advanced** &rarr; **Cron Jobs**, set up a daily scheduled backup at 02:00 AM:
```bash
0 2 * * * cd /home/u101925264/domains/aruviembroidery.com/public_html && /usr/bin/node scripts/backup.js >> /home/u101925264/aruvi-backups/backup.log 2>&1
```
Backups include both the database dump (with pure Node.js fallback if `mysqldump` is unavailable) and all uploads, with automatic 30-day retention pruning.

---

## 🛡️ Safe Deployment & Persistent Storage Architecture

### 1. Storage Architecture (`STORAGE_DRIVER`)
All uploaded files are decoupled from application code and git revisions:
- **`STORAGE_DRIVER=local` (Default):** Saves to `UPLOAD_DIR` (e.g. `/home/u101925264/aruvi-uploads`), mounted as a persistent disk volume.
- **`STORAGE_DRIVER=s3`:** Cloudflare R2 / AWS S3 compatible object storage (via `@aws-sdk/client-s3`). Public preview images are delivered via CDN; paid design files (DST, PES, JEF, EXP, ZIP) are placed in private storage and served only through authenticated routes.
- **Unique Filenames:** Generated with collision-free timestamps + random hex IDs (`file-<timestamp>-<hex>.<ext>`), preventing accidental overwrites.

### 2. Git & Deploy Safety Rules
1. **Never track uploads in Git:** All upload directories (`public/uploads/*`, `uploads/*`, `private_uploads/*`, `backups/*`, `aruvi-uploads/*`, `aruvi-backups/*`) are explicitly ignored in `.gitignore`.
2. **Startup Safety Guard:** On boot, `storage.validateStorageConfiguration()` verifies the upload path. In production, if `UPLOAD_DIR` is missing, relative, or located inside the repository or any `hbuilds/versions` folder, an error is logged, a red banner is displayed in the Admin Dashboard, and new uploads are blocked (preventing silent data loss) while existing files remain readable.
3. **Database Integrity:** No auto-seeding, `DROP`, or `TRUNCATE` operations on deploy or startup. Database updates are handled solely through safe numbered migrations (`npm run migrate`).

### 3. Brand Assets (Logo, Favicon, Banners)
- **Committed Defaults:** Default brand assets live permanently in `/public/assets/brand/` (`logo.png`, `logo.jpg`, `favicon.ico`, `hero_embroidery.jpg`) and are committed to Git.
- **Permanent Fallback:** `storage.resolveBrandAsset(type, candidateUrl)` verifies physical existence on disk. If a custom uploaded asset is missing or corrupt, it seamlessly falls back to `/public/assets/brand/`—**never showing a broken image**.

### 4. Admin Diagnostic Tools
Located in **Admin Panel → Storage & Recovery**:
- **System Health (`/admin/tools/system-health`):** Real-time database schema inspector, live UPLOAD_DIR status, rate limiter exemptions, and one-click database migration runner.
- **Missing Files Report (`/admin/tools/missing-files`):** Real-time diagnostic scan identifying any product with missing preview images or machine archives, with recovery from old deployments.
- **Regenerate Previews (`/admin/tools/regenerate-previews`):** Rebuilds preview, card, and thumb sizes directly from private originals in batches of 50.
- **Backup & Storage (`/admin/tools/backup`):** One-click manual backups, list and download past archives, and one-click database restore.

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

