import { NextResponse } from 'next/server';
import { hasAssignedUserAccess, requireAdmin } from '@/lib/server/admin-auth';
import { recordAppUserActivity } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const { user: admin, role, response } = await requireAdmin('notes.manage');
  if (response) return response;
  try {
    const userId = new URL(request.url).searchParams.get('userId') ?? '';
    if (!UUID_PATTERN.test(userId)) return NextResponse.json({ error: 'User ID is invalid.' }, { status: 400 });
    await ensureDatabaseSchema();
    if (!await hasAssignedUserAccess(admin!.id, role!, userId)) {
      return NextResponse.json({ error: 'This account is outside your assigned scope.' }, { status: 403 });
    }
    const rows = await getNeonSql()`SELECT n.id::text AS id, n.note, n.flag, n.created_at::text AS "createdAt",
      author.full_name AS "authorName"
      FROM admin_user_notes n LEFT JOIN app_users author ON author.id = n.author_id
      WHERE n.user_id = ${userId}::uuid ORDER BY n.created_at DESC LIMIT 100` as Record<string, unknown>[];
    return NextResponse.json({ notes: rows.map((row) => ({
      id: String(row.id), note: String(row.note), flag: String(row.flag ?? 'none'),
      createdAt: String(row.createdAt), authorName: row.authorName ? String(row.authorName) : 'Former staff',
    })) });
  } catch (error) {
    console.error('Admin user notes lookup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not load internal notes.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const { user: admin, role, response } = await requireAdmin('notes.manage', { recentReauthentication: true });
  if (response) return response;
  try {
    const body = await request.json();
    const userId = typeof body.userId === 'string' ? body.userId : '';
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    const flag = body.flag ?? 'none';
    if (!UUID_PATTERN.test(userId) || note.length < 2 || note.length > 3000) {
      return NextResponse.json({ error: 'Provide a user and a note between 2 and 3000 characters.' }, { status: 400 });
    }
    if (!['none', 'watch', 'high_risk'].includes(flag)) return NextResponse.json({ error: 'Choose a supported account flag.' }, { status: 400 });
    await ensureDatabaseSchema();
    if (!await hasAssignedUserAccess(admin!.id, role!, userId)) {
      return NextResponse.json({ error: 'This account is outside your assigned scope.' }, { status: 403 });
    }
    await getNeonSql()`INSERT INTO admin_user_notes (user_id, author_id, note, flag)
      VALUES (${userId}::uuid, ${admin!.id}::uuid, ${note}, ${flag})`;
    await recordAppUserActivity({
      actorUserId: admin!.id, subjectUserId: userId, eventType: 'admin.user_note_added',
      details: { flag },
    });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error('Admin user note creation failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not save internal note.' }, { status: 503 });
  }
}
