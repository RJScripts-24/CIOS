export interface ApiKeyResponse {
  id: string;
  provider: string;
  key_status: string;
  last_validated_at: Date | null;
  added_by: string;
  created_at: Date;
  updated_at: Date;
}