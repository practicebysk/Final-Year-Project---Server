const mongoose = require('mongoose');

const websiteVersionSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    versionNumber: { type: Number, required: true, min: 1 },
    label: { type: String, required: true, trim: true, maxlength: 200 },
    source: { type: String, required: true, enum: ['initial', 'ai', 'restore', 'snapshot'] },
    html: { type: String, default: '', maxlength: 300000 },
    css: { type: String, default: '', maxlength: 300000 },
    javascript: { type: String, default: '', maxlength: 300000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }, // versions are never edited
);

// One number per project. This also makes parallel requests safe.
websiteVersionSchema.index({ projectId: 1, versionNumber: 1 }, { unique: true });

module.exports = mongoose.model('WebsiteVersion', websiteVersionSchema);