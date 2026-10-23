export type AdminPermission =
  | 'users.read'
  | 'users.create'
  | 'users.edit'
  | 'users.suspend'
  | 'users.settings'
  | 'users.reset'
  | 'users.bulk'
  | 'users.details'
  | 'activity.read'
  | 'sessions.read'
  | 'sessions.revoke'
  | 'staff.manage'
  | 'alerts.read'
  | 'alerts.acknowledge'
  | 'health.read'
  | 'analytics.read'
  | 'cases.read'
  | 'cases.manage'
  | 'notes.manage'
  | 'assignments.manage'
  | 'staff.permissions'
  | 'approvals.review'
  | 'audit.export'
  | 'settings.manage'
  | 'reviews.manage'
  | 'chat.read'
  | 'chat.manage';

export const ADMIN_PERMISSION_OPTIONS: readonly AdminPermission[] = [
  'users.read', 'users.create', 'users.edit', 'users.suspend', 'users.settings', 'users.reset',
  'users.bulk', 'users.details', 'activity.read', 'sessions.read', 'sessions.revoke', 'staff.manage',
  'alerts.read', 'alerts.acknowledge', 'health.read', 'analytics.read', 'cases.read', 'cases.manage',
  'notes.manage', 'assignments.manage', 'staff.permissions', 'approvals.review', 'audit.export',
  'settings.manage', 'reviews.manage', 'chat.read', 'chat.manage',
];
