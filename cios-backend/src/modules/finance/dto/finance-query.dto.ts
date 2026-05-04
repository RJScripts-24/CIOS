// [NEW FILE]
import { IsOptional, Matches } from 'class-validator';

export class FinanceQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  month?: string;
}
