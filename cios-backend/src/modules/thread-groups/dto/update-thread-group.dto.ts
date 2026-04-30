import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateThreadGroupDto {
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	name?: string;
}