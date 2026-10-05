const db = require('../config/db');

const fallbackReviews = [
  { id: 1, design_id: 1, user_id: 2, user_name: 'Priya Lakshmi', rating: 5, comment: 'The stitch outline is exceptionally smooth and zero thread breaks on my Brother machine! Beautiful bridal output.', is_approved: 1, created_at: new Date('2026-10-01T11:00:00Z') },
  { id: 2, design_id: 6, user_id: 2, user_name: 'Priya Lakshmi', rating: 5, comment: 'Absolutely enchanting design. The Krishna flute detailing came out perfectly in gold metallic thread.', is_approved: 1, created_at: new Date('2026-10-01T12:00:00Z') }
];

class Review {
  static async getByDesignId(designId) {
    if (db.isConnected()) {
      const sql = `
        SELECT r.*, u.full_name as user_name
        FROM reviews r
        JOIN users u ON r.user_id = u.id
        WHERE r.design_id = ? AND r.is_approved = 1
        ORDER BY r.created_at DESC
      `;
      return await db.query(sql, [designId]);
    }
    return fallbackReviews.filter(r => r.design_id == designId && r.is_approved);
  }

  static async addReview({ design_id, user_id, rating, comment }) {
    if (db.isConnected()) {
      const res = await db.query(
        'INSERT INTO reviews (design_id, user_id, rating, comment, is_approved) VALUES (?, ?, ?, ?, 1)',
        [design_id, user_id, rating, comment]
      );
      // Update design average rating
      const avgRes = await db.query('SELECT AVG(rating) as avg_rating FROM reviews WHERE design_id = ? AND is_approved = 1', [design_id]);
      if (avgRes[0] && avgRes[0].avg_rating) {
        await db.query('UPDATE designs SET average_rating = ? WHERE id = ?', [parseFloat(avgRes[0].avg_rating).toFixed(2), design_id]);
      }
      return res.insertId;
    }
    const newId = fallbackReviews.length + 1;
    const rev = { id: newId, design_id, user_id, user_name: 'Verified Customer', rating: parseInt(rating), comment, is_approved: 1, created_at: new Date() };
    fallbackReviews.push(rev);
    return newId;
  }
}

module.exports = Review;
