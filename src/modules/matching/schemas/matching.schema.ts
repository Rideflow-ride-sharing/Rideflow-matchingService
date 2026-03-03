import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { MatchingStatus } from '../../../common/constants';

export type MatchingDocument = Matching & Document;

@Schema({ timestamps: true })
export class Matching {
  @Prop({ required: true, unique: true, index: true })
  matchingId: string;

  @Prop({ required: true, index: true })
  rideRequestId: string;

  @Prop({
    type: [
      {
        driverId: String,
        distanceInMeters: Number,
        etaInMinutes: Number,
        status: String,
        requestedAt: Date,
        respondedAt: Date,
      },
    ],
    default: [],
  })
  candidateDrivers: Array<{
    driverId: string;
    distanceInMeters: number;
    etaInMinutes: number;
    status: string; // 'pending', 'accepted', 'rejected', 'timeout'
    requestedAt?: Date;
    respondedAt?: Date;
  }>;

  @Prop({ type: String, default: null })
  selectedDriver: string | null;

  @Prop({
    required: true,
    enum: [MatchingStatus.PENDING, MatchingStatus.ACCEPTED, MatchingStatus.REJECTED, MatchingStatus.TIMEOUT, MatchingStatus.FINALIZED],
    default: MatchingStatus.PENDING,
  })
  status: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const MatchingSchema = SchemaFactory.createForClass(Matching);





