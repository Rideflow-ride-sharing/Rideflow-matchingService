import { IsString, IsNotEmpty } from 'class-validator';

export class FinalizeMatchDto {
  @IsString()
  @IsNotEmpty()
  matchingId: string;
}


