// [NEW FILE]
export interface FinanceModelBreakdown {
  provider: string;
  model: string;
  total_tokens_in: string | null;
  total_tokens_out: string | null;
  total_cost_usd: string | null;
}

export interface FinanceProjectBreakdown {
  project_id: string;
  total_cost_usd: string | null;
}

export interface FinanceSummaryResponse {
  month: string;
  by_model: FinanceModelBreakdown[];
  by_project: FinanceProjectBreakdown[];
}

export interface FinanceProjectDetailResponse {
  month: string;
  project_id: string;
  by_model: FinanceModelBreakdown[];
  by_user: Array<{
    user_id: string | null;
    total_cost_usd: string | null;
  }>;
  by_event_type: Array<{
    event_type: string;
    total_cost_usd: string | null;
  }>;
}
