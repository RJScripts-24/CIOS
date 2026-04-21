import { IsEmail, IsString, IsNotEmpty } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Provide a valid email address' })
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
