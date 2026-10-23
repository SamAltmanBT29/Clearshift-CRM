export const Roles = {
  VIEWER: "viewer",
  EDITOR: "editor",
  MIGRATION_RUNNER: "migration_runner",
  ANALYST: "analyst",
  ADMIN: "admin"
} as const;

export type RoleType = typeof Roles[keyof typeof Roles];

export interface HubTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  jti: string;
  exp: number;
  iat?: number | undefined;
  kid?: string | undefined;
  roles: RoleType[];
  employee_id?: string | undefined;
}

export interface HubUser {
  id: string;
  username: string;
  roles: RoleType[];
  employeeRef?: string | undefined;
  status: "active" | "disabled";
  createdAt: Date;
  updatedAt: Date;
}
