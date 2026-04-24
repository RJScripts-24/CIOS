// ─────────────────────────────────────────────────────────────────────────────
// [NEW FILE] create-workspace.dto.ts
// Purpose: Defines validation rules for creating a new workspace in CIOS.
// This file is part of the Workspace Invitation feature added to support
// ClickUp-style email invite flow using Resend for transactional email.
// ─────────────────────────────────────────────────────────────────────────────

import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateWorkspaceDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  settings?: Record<string, any>;
}
