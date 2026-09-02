import { IsString, IsNotEmpty } from 'class-validator';

export class AcceptOfferDto {
  @IsString()
  @IsNotEmpty()
  offerId: string;
}

export class RejectOfferDto {
  @IsString()
  @IsNotEmpty()
  offerId: string;
}
