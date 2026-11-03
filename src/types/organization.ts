// Organization and Agency Management Types

export type UserRole = 'super_admin' | 'owner' | 'admin' | 'member';

export type OrganizationType = 'standalone' | 'agency' | 'client';

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'cancelled';

export type AssetType = 'blueprint' | 'prompt_template' | 'brand_voice' | 'character' | 'product';

export type ShareMode = 'read_only' | 'usable';

// Organization member with user details
export interface OrganizationMember {
  id: string;
  user_id: string;
  organization_id: string;
  role: UserRole;
  permissions: string[];
  is_primary_owner: boolean;
  joined_at: string;
  created_at: string;
  updated_at: string;
  // Joined user data
  user?: {
    id: string;
    email: string;
    full_name: string | null;
    avatar_url: string | null;
  };
}

// Invitation with extended status tracking
export interface Invitation {
  id: string;
  email: string;
  organization_id: string;
  role: string;
  status: InvitationStatus;
  token: string;
  expires_at: string;
  invited_by: string | null;
  accepted_at: string | null;
  created_at: string;
  resent_count: number;
  last_resent_at: string | null;
  // Joined data
  invited_by_user?: {
    full_name: string | null;
    email: string;
  };
  organization?: {
    name: string;
    slug: string;
  };
}

// Client organization with metrics (for agency view)
export interface ClientOrganization {
  id: string;
  name: string;
  slug: string;
  status: string | null;
  created_at: string;
  parent_id: string | null;
  logo_url?: string | null;
  // Computed metrics
  user_count?: number;
  content_count?: number;
  jobs_count?: number;
}

// Asset share record
export interface AssetShare {
  id: string;
  source_organization_id: string;
  target_organization_id: string;
  asset_type: AssetType;
  asset_id: string;
  share_mode: ShareMode;
  shared_by: string | null;
  shared_at: string;
  revoked_at: string | null;
  created_at: string;
  // Joined data
  source_organization?: {
    name: string;
    slug: string;
  };
  target_organization?: {
    name: string;
    slug: string;
  };
  shared_by_user?: {
    full_name: string | null;
    email: string;
  };
}

// Impersonation log entry
export interface ImpersonationLog {
  id: string;
  super_admin_id: string;
  target_organization_id: string | null;
  target_organization_name: string | null;
  action: 'start' | 'end';
  ip_address: string | null;
  user_agent: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  // Joined data
  super_admin?: {
    full_name: string | null;
    email: string;
  };
}

// Organization context for current user
export interface OrganizationContext {
  organization: {
    id: string;
    name: string;
    slug: string;
    type: string;
    parent_id: string | null;
    status: string | null;
  };
  role: UserRole;
  isAgency: boolean;
  isClient: boolean;
  permissions: string[];
}

// Content analytics data
export interface ContentAnalytics {
  content_type: string;
  pipeline: string;
  total_count: number;
  total_cost: number;
  avg_duration_ms: number;
}

// Aggregated analytics for dashboard
export interface AggregatedAnalytics {
  byType: {
    type: string;
    count: number;
    cost: number;
  }[];
  byPipeline: {
    pipeline: string;
    count: number;
    cost: number;
  }[];
  totals: {
    totalContent: number;
    totalCost: number;
    totalJobs: number;
  };
}

// Platform stats for super admin
export interface PlatformStats {
  totalOrganizations: number;
  totalAgencies: number;
  totalClients: number;
  totalStandalone: number;
  totalUsers: number;
  totalContent: number;
  totalJobs: number;
}

// User's accessible organizations
export interface UserOrganization {
  id: string;
  name: string;
  slug: string;
  type: string;
  role: UserRole;
  is_current: boolean;
  parent_id: string | null;
  // For display
  initials: string;
  color: string;
  logo_url?: string | null;
}

// Form types for creating/inviting
export interface CreateClientForm {
  name: string;
  slug?: string;
}

export interface InviteUserForm {
  email: string;
  role: 'admin' | 'member';
}

export interface ShareAssetForm {
  target_organization_id: string;
  asset_type: AssetType;
  asset_id: string;
  share_mode: ShareMode;
}

// API key with protected status
export interface ProtectedApiKey {
  id: string;
  provider: string;
  key_hint: string | null;
  is_valid: boolean | null;
  is_protected: boolean;
  managed_by_user_id: string | null;
  inherited_from_organization_id: string | null;
  organization_id: string;
  created_at: string | null;
  // Computed
  managed_by_organization_name?: string;
  can_edit: boolean;
  can_delete: boolean;
}

// Helper type for role checking
export const ROLE_HIERARCHY: Record<UserRole, number> = {
  super_admin: 4,
  owner: 3,
  admin: 2,
  member: 1,
};

// Check if role1 has higher or equal privileges than role2
export function hasRolePrivilege(role1: UserRole, role2: UserRole): boolean {
  return ROLE_HIERARCHY[role1] >= ROLE_HIERARCHY[role2];
}

// Get display label for role
export function getRoleLabel(role: UserRole): string {
  const labels: Record<UserRole, string> = {
    super_admin: 'Super Admin',
    owner: 'Owner',
    admin: 'Admin',
    member: 'Member',
  };
  return labels[role];
}

// Get color class for role badge
export function getRoleBadgeColor(role: UserRole): string {
  const colors: Record<UserRole, string> = {
    super_admin: 'bg-red-100 text-red-800 border-red-200',
    owner: 'bg-primary/10 text-primary border-primary/20',
    admin: 'bg-blue-100 text-blue-800 border-blue-200',
    member: 'bg-gray-100 text-gray-800 border-gray-200',
  };
  return colors[role];
}

// Generate initials from organization name
export function getOrgInitials(name: string): string {
  return name
    .split(' ')
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// Generate consistent color from organization ID
export function getOrgColor(id: string): string {
  const colors = [
    'bg-gradient-to-br from-primary to-pink-500',
    'bg-gradient-to-br from-blue-500 to-cyan-500',
    'bg-gradient-to-br from-pink-500 to-rose-500',
    'bg-gradient-to-br from-orange-500 to-amber-500',
    'bg-gradient-to-br from-green-500 to-emerald-500',
    'bg-gradient-to-br from-primary to-rose-500',
    'bg-gradient-to-br from-teal-500 to-cyan-500',
    'bg-gradient-to-br from-red-500 to-orange-500',
  ];

  // Simple hash of ID to pick consistent color
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}
