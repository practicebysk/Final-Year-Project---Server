const mongoose = require('mongoose');

const assetSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    url: { type: String, required: true, trim: true, maxlength: 2000 },
  },
  { _id: false },
);

const projectSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    projectName: { type: String, required: [true, 'Project name is required'], trim: true, maxlength: 60 },
    businessName: { type: String, required: [true, 'Business name is required'], trim: true, maxlength: 100 },
    businessType: { type: String, trim: true, maxlength: 40, default: 'Other' },
    prompt: { type: String, default: '', maxlength: 5000 },
    html: { type: String, default: '', maxlength: 300000 },
    css: { type: String, default: '', maxlength: 300000 },
    javascript: { type: String, default: '', maxlength: 300000 },
    assets: {
      type: [assetSchema],
      default: [],
      validate: [(list) => list.length <= 50, 'A project can have at most 50 assets'],
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
    toJSON: {
      transform(doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        delete ret.userId; // the client never needs the owner id
        return ret;
      },
    },
  },
);

// Serves "list my projects, newest first" and keeps every owner-scoped query indexed.
projectSchema.index({ userId: 1, updatedAt: -1 });

module.exports = mongoose.model('Project', projectSchema);