import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpdateThreadDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  purpose_tag?: string;

  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: string;

  @IsOptional()
  @IsIn(['team', 'private'])
  access_level?: 'team' | 'private';

  @IsOptional()
  @IsUUID()
  group_id?: string | null;

  @IsOptional()
  @IsString()
  system_prompt?: string;
}