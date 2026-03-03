import { IsString, IsNotEmpty, IsNumber, Min, Max } from 'class-validator';

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
}


