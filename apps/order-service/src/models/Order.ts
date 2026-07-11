import mongoose, { Schema, Document } from 'mongoose';

export interface IOrderItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
}

export interface IOrder extends Document {
  userId: string;
  items: IOrderItem[];
  totalAmount: number;
  status: 'PENDING' | 'PAID' | 'FAILED';
}

const OrderItemSchema: Schema = new Schema({
  productId: { type: String, required: true },
  name: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  price: { type: Number, required: true }
});

const OrderSchema: Schema = new Schema({
  userId: { type: String, required: true },
  items: [OrderItemSchema],
  totalAmount: { type: Number, required: true },
  status: { type: String, enum: ['PENDING', 'PAID', 'FAILED'], default: 'PENDING' }
}, { timestamps: true });

export default mongoose.model<IOrder>('Order', OrderSchema);
