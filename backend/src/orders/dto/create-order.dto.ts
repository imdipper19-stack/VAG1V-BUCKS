import { IsNumber, IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateOrderDto {
  @IsNumber()
  vbucksAmount: number;

  @IsNumber()
  priceTRY: number;

  @IsOptional()
  @IsString()
  sellerId?: string;

  @IsOptional()
  @IsUrl()
  webhookUrl?: string;
}
