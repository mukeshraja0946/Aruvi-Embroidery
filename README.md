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
