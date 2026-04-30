import { IsNotEmpty, IsString } from 'class-validator';

export class CreateThreadGroupDto {
	@IsString()
	@IsNotEmpty()
	name: string;
}