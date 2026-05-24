import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectReviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Причина не должна превышать 500 символов' })
  reason?: string;
}
