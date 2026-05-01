import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateThreadDto {
  @IsString()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @IsString()
  purpose_tag?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  system_prompt?: string;

  /**
   * access_level field is accepted for forward-compatibility with the frontend
   * but is not persisted — the Thread schema does not have this column in the
   * current migration state.
   */
  @IsOptional()
  @IsIn(['team', 'private'])
  access_level?: string;

  @IsOptional()
  @IsUUID()
  group_id?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  skill_ids?: string[];
}