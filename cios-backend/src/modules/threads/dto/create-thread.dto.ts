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

  @IsOptional()
  @IsIn(['team', 'private'])
  access_level?: 'team' | 'private';

  @IsOptional()
  @IsUUID()
  group_id?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  skill_ids?: string[];
}
