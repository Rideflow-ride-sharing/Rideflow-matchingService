import { IsString, IsNotEmpty, IsNumber, Min, Max, IsOptional } from 'class-validator';

export class RequestMatchDto {
  @IsString()
  @IsNotEmpty()
  rideRequestId: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @IsNumber()
  @Min(0.001)
  radiusInMeters: number;

  /** If set, aggregated for surge “demand” (see payment-service fare metrics). */
  @IsOptional()
  @IsString()
  areaId?: string;

  @IsOptional()
  @IsString()
  cityCode?: string;

  /**
   * Matching strategy:
   * - sequential: one-by-one offers (lower write/load)
   * - parallel: top-N offers in parallel (lower rider latency)
   */
  @IsOptional()
  @IsString()
  matchingMode?: 'sequential' | 'parallel';
}


