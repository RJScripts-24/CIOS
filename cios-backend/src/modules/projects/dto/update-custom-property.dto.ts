import { IsArray, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateCustomPropertyDto {
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(100)
	name?: string;

	@IsOptional()
	@IsArray()
	options?: object[];

	@IsOptional()
	@IsInt()
	@Min(0)
	sort_order?: number;
}