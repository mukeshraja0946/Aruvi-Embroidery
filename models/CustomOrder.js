const CustomRequest = require('./CustomRequest');

/**
 * Backward compatibility adapter: CustomOrder redirects to CustomRequest
 */
class CustomOrder {
  static async create({ userId = null, full_name, name, email, phone = null, design_details, description, reference_image_url = null, reference_image_key = null }) {
    const res = await CustomRequest.create({
      userId,
      name: name || full_name,
      email,
      phone: phone || '',
      design_title: 'Custom Embroidery Request',
      description: description || design_details,
      reference_image_key: reference_image_key || reference_image_url
    });
    return res.id;
  }

  static async getAll(options = {}) {
    const res = await CustomRequest.getAll(options);
    // Map back for legacy views if needed
    const requests = (res.requests || []).map(r => ({
      ...r,
      full_name: r.name,
      design_details: r.description,
      reference_image_url: r.reference_image_key
    }));
    return { requests, total: res.total };
  }

  static async getById(id) {
    const r = await CustomRequest.getById(id);
    if (!r) return null;
    return {
      ...r,
      full_name: r.name,
      design_details: r.description,
      reference_image_url: r.reference_image_key
    };
  }

  static async updateStatus(id, status, admin_notes = null) {
    return CustomRequest.updateStatus(id, status, admin_notes);
  }

  static async count() {
    const stats = await CustomRequest.getStats();
    return stats.total;
  }

  static async getStats() {
    return CustomRequest.getStats();
  }

  static async delete(id) {
    return CustomRequest.delete(id);
  }
}

module.exports = CustomOrder;
