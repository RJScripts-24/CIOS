import {
  IsEmail,
  IsString,
  MaxLength,
  MinLength,
  IsOptional,
  Matches,
} from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'Provide a valid email address' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(72, { message: 'Password must not exceed 72 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter, and one number',
  })
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  full_name?: string;

  // [WORKSPACE INVITE] Optional invite token passed via /register?token=...
  // If present, the user was invited via a magic link and should be auto-joined
  // to the corresponding workspace after account creation.
  @IsOptional()
  // [WORKSPACE INVITE] Validate invite token as a string when provided.
  @IsString()
  token?: string;
}
