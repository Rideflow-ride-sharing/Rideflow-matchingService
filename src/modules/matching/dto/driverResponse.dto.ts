import { IsString, IsNotEmpty, IsBoolean } from 'class-validator';

export class DriverResponseDto {
  @IsString()
  @IsNotEmpty()
  matchingId: string;

  @IsString()
  @IsNotEmpty()
  driverId: string;

  @IsBoolean()
  accepted: boolean;
}


