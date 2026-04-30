import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProjectDto {
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(200)
	name?: string;

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