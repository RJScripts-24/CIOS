import { IsIn } from 'class-validator';

export class UpdateMemberDto {
	@IsIn(['read_only', 'edit'])
	access_level: string;
}