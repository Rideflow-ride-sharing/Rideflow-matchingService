import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';
import { OfferStatus } from '../../../common/constants';

export type OfferDocument = Offer & Document;

@Schema({ timestamps: true })
export class Offer {
  @Prop({ required: true, unique: true, index: true })
  offerId: string;

  @Prop({ required: true, index: true })
  matchingId: string;

  @Prop({ required: true, index: true })
  tripId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  driverId: Types.ObjectId | string;

  @Prop({
    required: true,
    enum: [OfferStatus.PENDING, OfferStatus.ACCEPTED, OfferStatus.REJECTED, OfferStatus.EXPIRED],
    default: OfferStatus.PENDING,
  })
  status: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ required: true, type: Date })
  expiresAt: Date;

  @Prop({ type: Date, default: null })
  acceptedAt: Date | null;

  @Prop({ type: Date, default: null })
  rejectedAt: Date | null;
}

export const OfferSchema = SchemaFactory.createForClass(Offer);
OfferSchema.index({ status: 1, expiresAt: 1 });
