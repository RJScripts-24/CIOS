export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    email: string;
    full_name: string | null;
    role: string;
    avatar_url: string | null;
    default_model: string | null;
  };
}
