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
When pushing or pulling code updates to production:

1. **Keep `.env` intact:** Ensure `.env` is outside Git and contains your persistent storage path:
   ```env
   UPLOAD_DIR=/var/data/uploads
   STORAGE_DRIVER=local
   ```
2. **Pull the latest code:**
   ```bash
   git pull origin main
   ```
3. **Install production dependencies:**
   ```bash
   npm install --production
   ```
4. **Run safe numbered migrations:**
   ```bash
   npm run migrate
   ```
   *(Migrations use `CREATE TABLE IF NOT EXISTS` and track executed migrations in `_migrations`. They will never drop tables or overwrite existing records).*
5. **Restart application process:**
   ```bash
   pm2 restart aruvi-embroidery
   # or: systemctl restart aruvi-embroidery
   ```

> **Note on Initial Setup:** To populate starter data on an empty fresh database, run `npm run seed`. If the database already has existing products or users, `npm run seed` will automatically detect them and safely skip execution without overwriting your data.

---

### 4. How to Restore from Backup

#### Restore Database:
```bash
# 1. Recreate database (if needed)
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS aruvi_embroidery DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 2. Import SQL dump
mysql -u root -p aruvi_embroidery < backup_aruvi_db_YYYY-MM-DD.sql
```

#### Restore Uploads Folder:
```bash
# Extract files back to the persistent storage directory
tar -xzf backup_aruvi_uploads_YYYY-MM-DD.tar.gz -C /var/data/
```
Ensure permissions allow the Node.js process to read and write to the directory:
```bash
chown -R www-data:www-data /var/data/uploads
chmod -R 755 /var/data/uploads
```

