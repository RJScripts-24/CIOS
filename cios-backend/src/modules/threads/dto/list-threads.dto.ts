import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class ListThreadsDto {
  @IsOptional()
  @IsString()
  search?: string;

  /**
   * Multi-value: ?purpose_tag=Dev&purpose_tag=Copy
   * class-transformer handles array coercion from query strings.
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    return Array.isArray(value) ? value : [value];
  })
  purpose_tag?: string[];

  @IsOptional()
  @IsUUID()
  created_by?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: string;

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cost_min?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cost_max?: number;

  @IsOptional()
  @IsUUID()
  group_id?: string;

  @IsOptional()
  @IsIn(['last_active', 'title_asc', 'cost_desc', 'created_at'])
  sort_by?: string;

  /**
   * Reserved for future use — access_level was removed from the Thread model.
   * Accepted in the DTO for forward-compatibility but ignored in the service.
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  include_private?: boolean;
}