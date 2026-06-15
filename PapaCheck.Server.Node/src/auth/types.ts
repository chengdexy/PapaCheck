// ==================== Auth Types ====================

export interface JWTPayload {
  sub: string;
  tenant_id: string;
  role: 'parent' | 'child' | 'super_admin';
  token_version: number;
  iat?: number;
  exp?: number;
}

export interface ExchangeRequest {
  access_code: string;
}

export interface ExchangeResponse {
  token: string;
  role: 'parent' | 'child';
  nickname: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  family_name: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AddMemberRequest {
  role: 'parent' | 'child';
  nickname: string;
}

export interface MemberResponse {
  id: string;
  nickname: string;
  role: 'parent' | 'child';
  access_hash: string;
  token_version: number;
  last_login: string | null;
  created_at: string;
}

export interface TenantInfo {
  id: string;
  name: string;
  member_count: number;
  created_at: string;
}
