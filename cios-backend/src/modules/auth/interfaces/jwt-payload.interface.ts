export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  workspace_id: string | null;
  iat?: number;
  exp?: number;
}
