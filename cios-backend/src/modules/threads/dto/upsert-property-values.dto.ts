import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsUUID, ValidateNested } from 'class-validator';

class PropertyValueItemDto {
  @IsUUID()
  property_id: string;

  @IsNotEmpty()
  value: unknown;
}

export class UpsertPropertyValuesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PropertyValueItemDto)
  values: PropertyValueItemDto[];
}