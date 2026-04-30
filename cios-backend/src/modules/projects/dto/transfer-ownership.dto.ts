import { IsNotEmpty, IsUUID } from 'class-validator';

export class TransferOwnershipDto {
	@IsUUID()
	@IsNotEmpty()
	new_owner_id: string;
}