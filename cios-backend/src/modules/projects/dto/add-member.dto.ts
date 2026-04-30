import { IsIn, IsUUID } from 'class-validator';

export class AddMemberDto {
	@IsUUID()
	user_id: string;

	@IsIn(['read_only', 'edit'])
	access_level: string;
}