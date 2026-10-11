const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [60, 'Name must be at most 60 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true, // creates a unique index; also blocks duplicate registrations under race conditions
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      select: false, // never returned unless explicitly requested with .select('+password')
    },
  },
  {
    timestamps: true, // adds createdAt and updatedAt
    toJSON: {
      transform(doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        delete ret.password; // safety net
        return ret;
      },
    },
  },
);

module.exports = mongoose.model('User', userSchema);