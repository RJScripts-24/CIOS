import { IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateCustomPropertyDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(100)
	name: string;

	@IsIn(['text', 'number', 'date', 'single_select', 'multi_select', 'checkbox', 'person'])
	property_type: string;

	@IsOptional()
	@IsArray()
	options?: object[];

	@IsOptional()
	@IsInt()
	@Min(0)
	sort_order?: number;
}