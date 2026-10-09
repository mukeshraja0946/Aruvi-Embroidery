const db = require('../config/db');

function calculateTrend(currentCount, prevCount) {
  const current = Number(currentCount) || 0;
  const prev = Number(prevCount) || 0;
  if (prev === 0) {
    if (current > 0) return { text: '+100%', isPositive: true, raw: 100 };
    return { text: '0%', isPositive: true, raw: 0 };
  }
  const diff = current - prev;
  const pct = Math.round((diff / prev) * 100);
  if (pct > 0) return { text: `+${pct}%`, isPositive: true, raw: pct };
  if (pct < 0) return { text: `${pct}%`, isPositive: false, raw: pct };
  return { text: '0%', isPositive: true, raw: 0 };
}

class AdminStatsService {
  /**
   * Fetches comprehensive dynamic stats for the main Admin Dashboard (/admin).
   */
  static async getDashboardStats() {
    if (db.isConnected()) {
      try {
        const now = new Date();
        const firstDayThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const firstDayPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastDayPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

        // 1. Orders Count & Trend
        const [totalOrdersRes] = await db.query("SELECT COUNT(*) as total FROM orders");
        const [currMonthOrdersRes] = await db.query("SELECT COUNT(*) as total FROM orders WHERE created_at >= ?", [firstDayThisMonth]);
        const [prevMonthOrdersRes] = await db.query("SELECT COUNT(*) as total FROM orders WHERE created_at >= ? AND created_at <= ?", [firstDayPrevMonth, lastDayPrevMonth]);

        const totalOrders = totalOrdersRes ? totalOrdersRes.total : 0;
        const currOrders = currMonthOrdersRes ? currMonthOrdersRes.total : 0;
        const prevOrders = prevMonthOrdersRes ? prevMonthOrdersRes.total : 0;
        const ordersTrend = calculateTrend(currOrders, prevOrders);

        // 2. Sales / Revenue & Trend
        const [totalSalesRes] = await db.query("SELECT COALESCE(SUM(final_amount), 0) as total FROM orders WHERE status IN ('completed', 'paid')");
        const [currMonthSalesRes] = await db.query("SELECT COALESCE(SUM(final_amount), 0) as total FROM orders WHERE status IN ('completed', 'paid') AND created_at >= ?", [firstDayThisMonth]);
        const [prevMonthSalesRes] = await db.query("SELECT COALESCE(SUM(final_amount), 0) as total FROM orders WHERE status IN ('completed', 'paid') AND created_at >= ? AND created_at <= ?", [firstDayPrevMonth, lastDayPrevMonth]);

        const totalSales = totalSalesRes ? parseFloat(totalSalesRes.total) : 0;
        const currSales = currMonthSalesRes ? parseFloat(currMonthSalesRes.total) : 0;
        const prevSales = prevMonthSalesRes ? parseFloat(prevMonthSalesRes.total) : 0;
        const salesTrend = calculateTrend(currSales, prevSales);

        // 3. Customers Count & Trend
        const [totalCustomersRes] = await db.query("SELECT COUNT(*) as total FROM users WHERE role = 'customer' OR role IS NULL");
        const [currMonthCustRes] = await db.query("SELECT COUNT(*) as total FROM users WHERE (role = 'customer' OR role IS NULL) AND created_at >= ?", [firstDayThisMonth]);
        const [prevMonthCustRes] = await db.query("SELECT COUNT(*) as total FROM users WHERE (role = 'customer' OR role IS NULL) AND created_at >= ? AND created_at <= ?", [firstDayPrevMonth, lastDayPrevMonth]);

        const totalCustomers = totalCustomersRes ? totalCustomersRes.total : 0;
        const currCust = currMonthCustRes ? currMonthCustRes.total : 0;
        const prevCust = prevMonthCustRes ? prevMonthCustRes.total : 0;
        const customersTrend = calculateTrend(currCust, prevCust);

        // 4. Designs Count & Trend
        const [totalDesignsRes] = await db.query("SELECT COUNT(*) as total FROM designs");
        const [currMonthDesignsRes] = await db.query("SELECT COUNT(*) as total FROM designs WHERE created_at >= ?", [firstDayThisMonth]);
        const [prevMonthDesignsRes] = await db.query("SELECT COUNT(*) as total FROM designs WHERE created_at >= ? AND created_at <= ?", [firstDayPrevMonth, lastDayPrevMonth]);

        const totalDesigns = totalDesignsRes ? totalDesignsRes.total : 0;
        const currDesigns = currMonthDesignsRes ? currMonthDesignsRes.total : 0;
        const prevDesigns = prevMonthDesignsRes ? prevMonthDesignsRes.total : 0;
        const designsTrend = calculateTrend(currDesigns, prevDesigns);

        // 5. Orders by Status
        const statusRows = await db.query("SELECT status, COUNT(*) as count FROM orders GROUP BY status");
        const statusMap = { pending: 0, processing: 0, completed: 0, cancelled: 0 };
        if (statusRows && statusRows.length > 0) {
          statusRows.forEach(r => {
            const st = (r.status || '').toLowerCase();
            if (st === 'paid') statusMap.completed += r.count;
            else if (st === 'failed') statusMap.cancelled += r.count;
            else if (statusMap[st] !== undefined) statusMap[st] += r.count;
            else statusMap.pending += r.count;
          });
        }
        const ordersByStatus = {
          pending: statusMap.pending,
          processing: statusMap.processing,
          completed: statusMap.completed,
          cancelled: statusMap.cancelled,
          total: totalOrders
        };

        // 6. Monthly Sales (Last 6 Months)
        const monthlySales = [];
        const monthLabels = [];
        for (let i = 5; i >= 0; i--) {
          const dStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const dEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
          const monthName = dStart.toLocaleString('en-US', { month: 'short' });
          monthLabels.push(monthName);

          const [mRes] = await db.query(
            "SELECT COALESCE(SUM(final_amount), 0) as total FROM orders WHERE status IN ('completed', 'paid') AND created_at >= ? AND created_at <= ?",
            [dStart, dEnd]
          );
          monthlySales.push(mRes ? parseFloat(mRes.total) : 0);
        }

        // 7. Recent Orders (5)
        const recentOrdersSql = `
          SELECT o.id, o.order_number, o.final_amount, o.status, o.created_at,
                 COALESCE(u.full_name, o.guest_name, 'Guest Customer') as customer_name,
                 (SELECT d.title FROM order_items oi JOIN designs d ON oi.design_id = d.id WHERE oi.order_id = o.id LIMIT 1) as item_title,
                 (SELECT di.image_url FROM order_items oi JOIN design_images di ON oi.design_id = di.design_id WHERE oi.order_id = o.id ORDER BY di.is_primary DESC, di.id ASC LIMIT 1) as item_image
          FROM orders o
          LEFT JOIN users u ON o.user_id = u.id
          ORDER BY o.created_at DESC
          LIMIT 5
        `;
        const recentOrders = await db.query(recentOrdersSql);

        // 8. Top Selling Designs (5)
        const topDesignsSql = `
          SELECT d.id, d.title, d.slug, d.price, d.sale_price,
                 COUNT(oi.id) as sales_count,
                 COALESCE(
                   (SELECT image_url FROM design_images WHERE design_id = d.id ORDER BY is_primary DESC, id ASC LIMIT 1),
                   '/public/images/hero_embroidery.jpg'
                 ) as image_url
          FROM designs d
          LEFT JOIN order_items oi ON d.id = oi.design_id
          LEFT JOIN orders o ON oi.order_id = o.id AND (o.status = 'completed' OR LOWER(o.status) = 'paid')
          GROUP BY d.id, d.title, d.slug, d.price, d.sale_price
          ORDER BY sales_count DESC, d.id ASC
          LIMIT 5
        `;
        const topSellingDesigns = await db.query(topDesignsSql);

        return {
          totalOrders,
          ordersTrend,
          totalSales,
          salesTrend,
          totalCustomers,
          customersTrend,
          totalDesigns,
          designsTrend,
          ordersByStatus,
          monthlySales,
          monthLabels,
          recentOrders: recentOrders || [],
          topSellingDesigns: topSellingDesigns || []
        };
      } catch (err) {
        console.error('AdminStatsService.getDashboardStats error:', err);
      }
    }

    // Fallback mode logic (using models' internal storage)
    const Order = require('../models/Order');
    const User = require('../models/User');
    const Design = require('../models/Design');

    const { orders: allOrders } = await Order.getAll({ limit: 1000 });
    const totalOrders = allOrders ? allOrders.length : 0;
    const completedOrdersArr = allOrders ? allOrders.filter(o => o.status === 'completed' || o.status === 'paid') : [];
    const totalSales = completedOrdersArr.reduce((acc, o) => acc + Number(o.final_amount || 0), 0);
    const pendingOrdersCount = allOrders ? allOrders.filter(o => o.status === 'pending').length : 0;
    const processingOrdersCount = allOrders ? allOrders.filter(o => o.status === 'processing').length : 0;
    const cancelledOrdersCount = allOrders ? allOrders.filter(o => o.status === 'cancelled' || o.status === 'failed').length : 0;
    const totalCustomers = await User.count();
    const totalDesigns = await Design.count();

    return {
      totalOrders,
      ordersTrend: { text: '0%', isPositive: true },
      totalSales,
      salesTrend: { text: '0%', isPositive: true },
      totalCustomers,
      customersTrend: { text: '0%', isPositive: true },
      totalDesigns,
      designsTrend: { text: '0%', isPositive: true },
      ordersByStatus: {
        pending: pendingOrdersCount,
        processing: processingOrdersCount,
        completed: completedOrdersArr.length,
        cancelled: cancelledOrdersCount,
        total: totalOrders
      },
      monthlySales: [0, 0, 0, 0, 0, totalSales],
      monthLabels: ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'],
      recentOrders: allOrders ? allOrders.slice(0, 5) : [],
      topSellingDesigns: []
    };
  }

  /**
   * Fetches dynamic stats specifically for the Manage Orders page (/admin/orders).
   */
  static async getOrderStats() {
    if (db.isConnected()) {
      try {
        const now = new Date();
        const firstDayThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const firstDayPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastDayPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

        // Total Orders
        const [totalRes] = await db.query("SELECT COUNT(*) as total FROM orders");
        const [currTotalRes] = await db.query("SELECT COUNT(*) as total FROM orders WHERE created_at >= ?", [firstDayThisMonth]);
        const [prevTotalRes] = await db.query("SELECT COUNT(*) as total FROM orders WHERE created_at >= ? AND created_at <= ?", [firstDayPrevMonth, lastDayPrevMonth]);
        const totalOrders = totalRes ? totalRes.total : 0;
        const ordersTrend = calculateTrend(currTotalRes ? currTotalRes.total : 0, prevTotalRes ? prevTotalRes.total : 0);

        // Pending Orders
        const [pendingRes] = await db.query("SELECT COUNT(*) as total FROM orders WHERE status = 'pending'");
        const [currPendingRes] = await db.query("SELECT COUNT(*) as total FROM orders WHERE status = 'pending' AND created_at >= ?", [firstDayThisMonth]);
        const [prevPendingRes] = await db.query("SELECT COUNT(*) as total FROM orders WHERE status = 'pending' AND created_at >= ? AND created_at <= ?", [firstDayPrevMonth, lastDayPrevMonth]);
        const pendingOrders = pendingRes ? pendingRes.total : 0;
        const pendingTrend = calculateTrend(currPendingRes ? currPendingRes.total : 0, prevPendingRes ? prevPendingRes.total : 0);

        // Completed Orders
        const [completedRes] = await db.query("SELECT COUNT(*) as total FROM orders WHERE status IN ('completed', 'paid')");
        const [currCompRes] = await db.query("SELECT COUNT(*) as total FROM orders WHERE status IN ('completed', 'paid') AND created_at >= ?", [firstDayThisMonth]);
        const [prevCompRes] = await db.query("SELECT COUNT(*) as total FROM orders WHERE status IN ('completed', 'paid') AND created_at >= ? AND created_at <= ?", [firstDayPrevMonth, lastDayPrevMonth]);
        const completedOrders = completedRes ? completedRes.total : 0;
        const completedTrend = calculateTrend(currCompRes ? currCompRes.total : 0, prevCompRes ? prevCompRes.total : 0);

        // Total Revenue
        const [revRes] = await db.query("SELECT COALESCE(SUM(final_amount), 0) as total FROM orders WHERE status IN ('completed', 'paid')");
        const [currRevRes] = await db.query("SELECT COALESCE(SUM(final_amount), 0) as total FROM orders WHERE status IN ('completed', 'paid') AND created_at >= ?", [firstDayThisMonth]);
        const [prevRevRes] = await db.query("SELECT COALESCE(SUM(final_amount), 0) as total FROM orders WHERE status IN ('completed', 'paid') AND created_at >= ? AND created_at <= ?", [firstDayPrevMonth, lastDayPrevMonth]);
        const totalRevenue = revRes ? parseFloat(revRes.total) : 0;
        const revenueTrend = calculateTrend(currRevRes ? parseFloat(currRevRes.total) : 0, prevRevRes ? parseFloat(prevRevRes.total) : 0);

        return {
          totalOrders,
          ordersTrend,
          pendingOrders,
          pendingTrend,
          completedOrders,
          completedTrend,
          totalRevenue,
          revenueTrend
        };
      } catch (err) {
        console.error('AdminStatsService.getOrderStats error:', err);
      }
    }

    const Order = require('../models/Order');
    const { orders } = await Order.getAll({ limit: 1000 });
    const totalOrders = orders ? orders.length : 0;
    const pendingOrders = orders ? orders.filter(o => o.status === 'pending').length : 0;
    const completedOrders = orders ? orders.filter(o => o.status === 'completed' || o.status === 'paid').length : 0;
    const totalRevenue = orders ? orders.filter(o => o.status === 'completed' || o.status === 'paid').reduce((sum, o) => sum + Number(o.final_amount || 0), 0) : 0;

    return {
      totalOrders,
      ordersTrend: { text: '0%', isPositive: true },
      pendingOrders,
      pendingTrend: { text: '0%', isPositive: true },
      completedOrders,
      completedTrend: { text: '0%', isPositive: true },
      totalRevenue,
      revenueTrend: { text: '0%', isPositive: true }
    };
  }

  /**
   * Fetches dynamic stats specifically for the Manage Designs page (/admin/designs).
   */
  static async getDesignStats() {
    if (db.isConnected()) {
      try {
        const now = new Date();
        const firstDayThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const firstDayPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastDayPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

        const [totalRes] = await db.query("SELECT COUNT(*) as total FROM designs");
        const [currTotalRes] = await db.query("SELECT COUNT(*) as total FROM designs WHERE created_at >= ?", [firstDayThisMonth]);
        const [prevTotalRes] = await db.query("SELECT COUNT(*) as total FROM designs WHERE created_at >= ? AND created_at <= ?", [firstDayPrevMonth, lastDayPrevMonth]);

        const [activeRes] = await db.query("SELECT COUNT(*) as total FROM designs WHERE is_active = 1");
        const [inactiveRes] = await db.query("SELECT COUNT(*) as total FROM designs WHERE is_active = 0");
        const [catRes] = await db.query("SELECT COUNT(*) as total FROM categories");

        const totalDesigns = totalRes ? totalRes.total : 0;
        const activeDesigns = activeRes ? activeRes.total : 0;
        const inactiveDesigns = inactiveRes ? inactiveRes.total : 0;
        const totalCategories = catRes ? catRes.total : 0;

        const designsTrend = calculateTrend(currTotalRes ? currTotalRes.total : 0, prevTotalRes ? prevTotalRes.total : 0);

        return {
          totalDesigns,
          designsTrend,
          activeDesigns,
          activeTrend: designsTrend,
          inactiveDesigns,
          inactiveTrend: { text: '0%', isPositive: true },
          totalCategories,
          categoriesTrend: { text: '0%', isPositive: true }
        };
      } catch (err) {
        console.error('AdminStatsService.getDesignStats error:', err);
      }
    }

    const Design = require('../models/Design');
    const Category = require('../models/Category');
    const totalDesigns = await Design.count();
    const activeDesigns = await Design.countActive();
    const inactiveDesigns = await Design.countInactive();
    const categories = await Category.getAll();

    return {
      totalDesigns,
      designsTrend: { text: '0%', isPositive: true },
      activeDesigns,
      activeTrend: { text: '0%', isPositive: true },
      inactiveDesigns,
      inactiveTrend: { text: '0%', isPositive: true },
      totalCategories: categories ? categories.length : 0,
      categoriesTrend: { text: '0%', isPositive: true }
    };
  }

  /**
   * Fetches dynamic stats specifically for the Customers Directory (/admin/customers).
   */
  static async getCustomerStats() {
    if (db.isConnected()) {
      try {
        const now = new Date();
        const firstDayThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const firstDayPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastDayPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

        // Total Customers
        const [totalRes] = await db.query("SELECT COUNT(*) as total FROM users WHERE role = 'customer' OR role IS NULL");
        const [currTotalRes] = await db.query("SELECT COUNT(*) as total FROM users WHERE (role = 'customer' OR role IS NULL) AND created_at >= ?", [firstDayThisMonth]);
        const [prevTotalRes] = await db.query("SELECT COUNT(*) as total FROM users WHERE (role = 'customer' OR role IS NULL) AND created_at >= ? AND created_at <= ?", [firstDayPrevMonth, lastDayPrevMonth]);

        const totalCustomers = totalRes ? totalRes.total : 0;
        const customersTrend = calculateTrend(currTotalRes ? currTotalRes.total : 0, prevTotalRes ? prevTotalRes.total : 0);

        // Active Customers
        const [activeRes] = await db.query("SELECT COUNT(*) as total FROM users WHERE (role = 'customer' OR role IS NULL) AND (is_active = 1 OR is_active IS NULL)");
        const activeCustomers = activeRes ? activeRes.total : 0;

        // New Customers This Month
        const [newRes] = await db.query("SELECT COUNT(*) as total FROM users WHERE (role = 'customer' OR role IS NULL) AND created_at >= ?", [firstDayThisMonth]);
        const newCustomers = newRes ? newRes.total : 0;

        // Repeat Customers (> 1 completed order)
        const repeatRes = await db.query(`
          SELECT COUNT(DISTINCT user_id) as total
          FROM (
            SELECT user_id
            FROM orders
            WHERE user_id IS NOT NULL AND (status = 'completed' OR LOWER(status) = 'paid')
            GROUP BY user_id
            HAVING COUNT(id) > 1
          ) as sub
        `);
        const repeatCustomers = (repeatRes && repeatRes[0] && repeatRes[0].total !== undefined) ? repeatRes[0].total : 0;

        return {
          totalCustomers,
          customersTrend,
          activeCustomers,
          activeTrend: { text: activeCustomers > 0 ? '100%' : '0%', isPositive: true },
          newCustomers,
          newTrend: { text: `${newCustomers} this month`, isPositive: true },
          repeatCustomers,
          repeatTrend: { text: `${repeatCustomers > 0 ? Math.round((repeatCustomers / (totalCustomers || 1)) * 100) : 0}%`, isPositive: true }
        };
      } catch (err) {
        console.error('AdminStatsService.getCustomerStats error:', err);
      }
    }

    const User = require('../models/User');
    const { users } = await User.getAll({ limit: 1000 });
    const customers = users ? users.filter(u => u.role !== 'admin') : [];
    const totalCustomers = customers.length;
    const activeCustomers = customers.filter(u => u.is_active === 1 || u.is_active === undefined).length;

    return {
      totalCustomers,
      customersTrend: { text: '0%', isPositive: true },
      activeCustomers,
      activeTrend: { text: '100%', isPositive: true },
      newCustomers: totalCustomers,
      newTrend: { text: `${totalCustomers} this month`, isPositive: true },
      repeatCustomers: 0,
      repeatTrend: { text: '0%', isPositive: true }
    };
  }

  /**
   * Fetches dynamic stats specifically for the Contact Messages / Enquiries page (/admin/messages).
   */
  static async getMessageStats() {
    if (db.isConnected()) {
      try {
        const [totalRes] = await db.query("SELECT COUNT(*) as total FROM contact_messages");
        const [newRes] = await db.query("SELECT COUNT(*) as total FROM contact_messages WHERE status = 'new'");
        const [readRes] = await db.query("SELECT COUNT(*) as total FROM contact_messages WHERE status = 'read'");
        const [repliedRes] = await db.query("SELECT COUNT(*) as total FROM contact_messages WHERE status = 'replied'");

        const totalMessages = totalRes ? totalRes.total : 0;
        const newMessages = newRes ? newRes.total : 0;
        const inProgressMessages = readRes ? readRes.total : 0;
        const resolvedMessages = repliedRes ? repliedRes.total : 0;

        return {
          totalMessages,
          messagesTrend: { text: `${newMessages} new`, isPositive: true },
          newMessages,
          newTrend: { text: `${newMessages} unread`, isPositive: true },
          inProgressMessages,
          inProgressTrend: { text: `${inProgressMessages} in review`, isPositive: true },
          resolvedMessages,
          resolvedTrend: { text: `${totalMessages > 0 ? Math.round((resolvedMessages / totalMessages) * 100) : 100}%`, isPositive: true }
        };
      } catch (err) {
        console.error('AdminStatsService.getMessageStats error:', err);
      }
    }

    const ContactMessage = require('../models/ContactMessage');
    const { messages } = await ContactMessage.getAll({ limit: 1000 });
    const totalMessages = messages ? messages.length : 0;
    const newMessages = messages ? messages.filter(m => m.status === 'new').length : 0;
    const inProgressMessages = messages ? messages.filter(m => m.status === 'read').length : 0;
    const resolvedMessages = messages ? messages.filter(m => m.status === 'replied').length : 0;

    return {
      totalMessages,
      messagesTrend: { text: `${newMessages} new`, isPositive: true },
      newMessages,
      newTrend: { text: `${newMessages} unread`, isPositive: true },
      inProgressMessages,
      inProgressTrend: { text: `${inProgressMessages} in review`, isPositive: true },
      resolvedMessages,
      resolvedTrend: { text: `${totalMessages > 0 ? Math.round((resolvedMessages / totalMessages) * 100) : 100}%`, isPositive: true }
    };
  }
}

module.exports = AdminStatsService;
