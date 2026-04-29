import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class CreateApiKeyDto {
  @IsIn(['anthropic', 'openai', 'google'])
  provider: 'anthropic' | 'openai' | 'google';

  @IsString()
  @IsNotEmpty()
  key: string;
}