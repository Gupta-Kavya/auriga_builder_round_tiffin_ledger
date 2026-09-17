import mongoose from 'mongoose';

const ownerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true }
}, { timestamps: true });

const pauseSchema = new mongoose.Schema({
  startDate: { type: String, required: true },
  endDate: { type: String, default: null }
}, { _id: true });

const holderSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  address: { type: String, required: true },
  startDate: { type: String, required: true },
  endDate: { type: String, default: null }
});

const customerSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', required: true, index: true },
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  address: { type: String, required: true, trim: true },
  monthlyPrice: { type: Number, required: true, min: 0.01 },
  startDate: { type: String, required: true },
  pauses: [pauseSchema],
  holders: [holderSchema]
}, { timestamps: true });
customerSchema.index({ owner: 1, phone: 1 }, { unique: true });

export const Owner = mongoose.model('Owner', ownerSchema);
export const Customer = mongoose.model('Customer', customerSchema);

const notificationSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', required: true },
  date: { type: String, required: true },
  phone: { type: String, required: true },
  message: { type: String, required: true }
}, { timestamps: true });
notificationSchema.index({ customer: 1, date: 1 }, { unique: true });
export const Notification = mongoose.model('Notification', notificationSchema);
