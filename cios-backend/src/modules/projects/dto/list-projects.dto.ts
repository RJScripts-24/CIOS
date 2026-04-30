import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class ListProjectsDto {
	@IsOptional()
	@IsString()
	search?: string;

	@IsOptional()
	@IsIn(['active', 'paused', 'completed', 'archived'])
	status?: string;

	@IsOptional()
	@IsIn(['client', 'internal_bd', 'internal_build'])
	type?: string;

	@IsOptional()
	@IsUUID()
	owner_id?: string;

	@IsOptional()
	@IsDateString()
	date_from?: string;

	@IsOptional()
	@IsDateString()
	date_to?: string;

	// Query string booleans arrive as strings, normalize before validation.
	@IsOptional()
	@Transform(({ value }) => value === 'true' || value === true)
	@IsBoolean()
	has_linked_sources?: boolean;

	@IsOptional()
	@IsIn(['none', 'owner', 'last_active', 'monthly_cost'])
	group_by?: string;

	@IsOptional()
	@IsIn(['last_active', 'name_asc', 'cost_high_low', 'thread_count'])
	sort_by?: string;
}