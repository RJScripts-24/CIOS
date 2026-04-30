import { Type } from 'class-transformer';
import {
	IsArray,
	IsIn,
	IsNotEmpty,
	IsOptional,
	IsString,
	IsUUID,
	MaxLength,
	ValidateNested,
} from 'class-validator';

export class AddMemberItem {
	@IsUUID()
	user_id: string;

	@IsIn(['read_only', 'edit'])
	access_level: string;
}

export class CreateProjectDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(200)
	name: string;

	@IsIn(['client', 'internal_bd', 'internal_build'])
	type: string;

	@IsOptional()
	@IsIn(['active', 'paused', 'completed', 'archived'])
	status?: string;

	@IsOptional()
	@IsString()
	brief?: string;

	@IsOptional()
	@IsString()
	system_instructions?: string;

	@IsOptional()
	@IsString()
	default_model?: string;

	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => AddMemberItem)
	members?: AddMemberItem[];

	@IsOptional()
	@IsString()
	clickup_link?: string;

	@IsOptional()
	@IsString()
	slack_channel_link?: string;

	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	fathom_links?: string[];

	@IsOptional()
	@IsString()
	vault_drive_link?: string;
}