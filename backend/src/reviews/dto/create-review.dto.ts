import { Transform } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateReviewDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2, { message: 'Никнейм должен содержать минимум 2 символа' })
  @MaxLength(64, { message: 'Никнейм не должен превышать 64 символа' })
  nickname: string;

  @IsInt({ message: 'Звёзды должны быть целым числом' })
  @Min(0)
  @Max(5)
  stars: number;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(10, { message: 'Текст отзыва должен содержать минимум 10 символов' })
  @MaxLength(1000, { message: 'Текст отзыва не должен превышать 1000 символов' })
  text: string;
}
