export interface ThreadResponse {
  id: string;
  project_id: string;
  workspace_id: string;
  group_id: string | null;
  title: string;
  purpose_tag: string | null;
  status: string | null;
  system_prompt: string | null;
  last_model_used: string | null;
  created_by: string;
  last_active_at: Date | null;
  total_cost: string;
  created_at: Date;
  updated_at: Date;
  property_values: Record<string, unknown>;
}