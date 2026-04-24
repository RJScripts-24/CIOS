// ─────────────────────────────────────────────────────────────────────────────
// [NEW FILE] invite-member.dto.ts
// Purpose: Defines validation rules for inviting a workspace member by email.
// This file is part of the Workspace Invitation feature added to support
// ClickUp-style email invite flow using Resend for transactional email.
// ─────────────────────────────────────────────────────────────────────────────

import { IsEmail, IsNotEmpty } from 'class-validator';

export class InviteMemberDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;
}
