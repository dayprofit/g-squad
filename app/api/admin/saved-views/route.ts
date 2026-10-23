import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';
const VIEW_TYPES = ['users', 'activity', 'cases'] as const;
const ALLOWED_FILTERS = new Set(['search', 'eventType', 'from', 'to', 'status', 'priority', 'team', 'region']);

export async function GET(request: Request) {
  const { user, response } = await requireAdmin('users.read');
  if (response) return response;
  try {
    const viewType = new URL(request.url).searchParams.get('type') ?? '';
    if (!VIEW_TYPES.includes(viewType as typeof VIEW_TYPES[number])) {
      return NextResponse.json({ error: 'Choose a supported saved-view type.' }, { status: 400 });
    }
    await ensureDatabaseSchema();
    const rows = await getNeonSql()`SELECT id::text AS id, name, view_type AS "viewType",
      filters, created_at::text AS "createdAt"
      FROM admin_saved_views WHERE owner_id = ${user!.id}::uuid AND view_type = ${viewType}
      ORDER BY name LIMIT 50` as Record<string, unknown>[];
    return NextResponse.json({ views: rows });
  } catch (error) {
    console.error('Admin saved views lookup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not load saved views.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const { user, response } = await requireAdmin('users.read', { recentReauthentication: true });
  if (response) return response;
  try {
    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const viewType = body.viewType;
    if (name.length < 2 || name.length > 60 || !VIEW_TYPES.includes(viewType)) {
      return NextResponse.json({ error: 'Provide a valid saved view name and type.' }, { status: 400 });
    }
    const input = body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters) ? body.filters as Record<string, unknown> : {};
    const filters = Object.fromEntries(Object.entries(input).filter(([key, value]) =>
      ALLOWED_FILTERS.has(key) && typeof value === 'string' && value.length <= 100
    ));
    await ensureDatabaseSchema();
    const rows = await getNeonSql()`INSERT INTO admin_saved_views (owner_id, name, view_type, filters)
      VALUES (${user!.id}::uuid, ${name}, ${viewType}, ${JSON.stringify(filters)}::jsonb)
      ON CONFLICT (owner_id, view_type, name) DO UPDATE SET filters = EXCLUDED.filters
      RETURNING id::text AS id` as Record<string, unknown>[];
    return NextResponse.json({ id: String(rows[0].id) }, { status: 201 });
  } catch (error) {
    console.error('Admin saved view creation failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not save this view.' }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const { user, response } = await requireAdmin('users.read', { recentReauthentication: true });
  if (response) return response;
  try {
    const id = new URL(request.url).searchParams.get('id') ?? '';
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Saved view ID is invalid.' }, { status: 400 });
    await ensureDatabaseSchema();
    const rows = await getNeonSql()`DELETE FROM admin_saved_views
      WHERE id = ${id}::bigint AND owner_id = ${user!.id}::uuid RETURNING id` as Record<string, unknown>[];
    if (!rows[0]) return NextResponse.json({ error: 'Saved view was not found.' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin saved view deletion failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not delete this saved view.' }, { status: 503 });
  }
}
