import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { isAdminEmail } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEPARTMENTS = ['support', 'account_manager'] as const;
type Department = (typeof DEPARTMENTS)[number];

function departmentForRole(role: string | null): Department {
  return role === 'account_manager' ? 'account_manager' : 'support';
}

async function canAccessChat(chatId: string, userId: string, role: string) {
  const rows = await getNeonSql()`SELECT id FROM admin_chats
    WHERE id = ${chatId}::bigint AND (
      ${role === 'owner'} OR assigned_to = ${userId}::uuid OR
      (assigned_to IS NULL AND department = ${departmentForRole(role)})
    ) LIMIT 1` as Record<string, unknown>[];
  return Boolean(rows[0]);
}

export async function GET(request: Request) {
  const { user, role, response } = await requireAdmin('chat.read');
  if (response) return response;
  try {
    await ensureDatabaseSchema();
    const sql = getNeonSql();
    const scopedDepartment = departmentForRole(role!);
    const chats = await sql`SELECT c.id::text AS id, c.user_id::text AS "userId",
      investor.full_name AS "userName", investor.email AS "userEmail",
      c.department, c.status, c.assigned_to::text AS "assignedTo",
      assignee.full_name AS "assignedName", c.updated_at::text AS "updatedAt",
      latest.id::text AS "lastMessageId", latest.message AS "lastMessage",
      latest.sender_type AS "lastSenderType",
      (SELECT count(*)::int FROM admin_chat_messages m WHERE m.chat_id = c.id) AS "messageCount"
      FROM admin_chats c
      JOIN app_users investor ON investor.id = c.user_id
      LEFT JOIN app_users assignee ON assignee.id = c.assigned_to
      LEFT JOIN LATERAL (SELECT id, message, sender_type FROM admin_chat_messages
        WHERE chat_id = c.id ORDER BY id DESC LIMIT 1) latest ON true
      WHERE (${role === 'owner'} OR c.assigned_to = ${user!.id}::uuid OR
        (c.assigned_to IS NULL AND c.department = ${scopedDepartment}))
      ORDER BY c.updated_at DESC LIMIT 150` as Record<string, unknown>[];

    const selectedId = new URL(request.url).searchParams.get('chatId') ?? '';
    let messages: Record<string, unknown>[] = [];
    let typing: Record<string, unknown>[] = [];
    if (selectedId) {
      if (!/^\d+$/.test(selectedId)) return NextResponse.json({ error: 'Chat ID is invalid.' }, { status: 400 });
      if (!await canAccessChat(selectedId, user!.id, role!)) {
        return NextResponse.json({ error: 'This chat is outside your assignment.' }, { status: 403 });
      }
      [messages, typing] = await Promise.all([
        sql`SELECT id::text AS id, sender_type AS "senderType", sender_name AS "senderName",
          message, created_at::text AS "createdAt"
          FROM (SELECT id, sender_type, sender_name, message, created_at
            FROM admin_chat_messages WHERE chat_id = ${selectedId}::bigint
            ORDER BY id DESC LIMIT 200) recent ORDER BY id` as Promise<Record<string, unknown>[]>,
        sql`SELECT u.full_name AS "fullName", u.id::text AS id
          FROM admin_chat_typing t JOIN app_users u ON u.id = t.user_id
          WHERE t.chat_id = ${selectedId}::bigint AND t.user_id <> ${user!.id}::uuid
            AND t.is_typing = true AND t.expires_at > now() LIMIT 1` as Promise<Record<string, unknown>[]>,
      ]);
    }

    const staffRows = await sql`SELECT u.id::text AS id, u.full_name AS "fullName",
      u.email, staff.role
      FROM admin_staff staff JOIN app_users u ON u.id = staff.user_id
      WHERE staff.role <> 'read_only'
      ORDER BY staff.role, u.full_name` as Record<string, unknown>[];
    const permissionRows = role === 'owner' ? [] : await sql`SELECT permissions
      FROM admin_staff WHERE user_id = ${user!.id}::uuid LIMIT 1` as Record<string, unknown>[];
    const canManage = role === 'owner' || (Array.isArray(permissionRows[0]?.permissions)
      ? permissionRows[0].permissions.includes('chat.manage')
      : role === 'support' || role === 'account_manager');
    const ownerEmails = process.env.ADMIN_EMAILS?.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean) ?? [];
    const ownerRows = (await Promise.all(ownerEmails.map((email) => sql`
      SELECT id::text AS id, full_name AS "fullName", email
      FROM app_users WHERE lower(email) = ${email} LIMIT 1
    `))) as Record<string, unknown>[][];
    const directory = [
      ...ownerRows.flat().filter((row) => isAdminEmail(String(row.email))).map((row) => ({
        id: String(row.id), fullName: String(row.fullName), email: String(row.email), role: 'owner', department: 'support',
      })),
      ...staffRows.map((row) => ({
        id: String(row.id), fullName: String(row.fullName), email: String(row.email),
        role: String(row.role), department: departmentForRole(String(row.role)),
      })),
    ];
    return NextResponse.json({
      chats: chats.map((row) => ({
        id: String(row.id), userId: String(row.userId), userName: String(row.userName),
        userEmail: String(row.userEmail), department: String(row.department), status: String(row.status),
        assignedTo: row.assignedTo ? String(row.assignedTo) : null,
        assignedName: row.assignedName ? String(row.assignedName) : null,
        updatedAt: String(row.updatedAt), lastMessage: row.lastMessage ? String(row.lastMessage) : '',
        lastMessageId: row.lastMessageId ? String(row.lastMessageId) : '',
        lastSenderType: row.lastSenderType ? String(row.lastSenderType) : '',
        messageCount: Number(row.messageCount),
      })),
      messages: messages.map((row) => ({
        id: String(row.id), senderType: String(row.senderType), senderName: String(row.senderName),
        message: String(row.message), createdAt: String(row.createdAt),
      })),
      typing: typing[0] ? String(typing[0].fullName) : null,
      directory,
      canManage,
    });
  } catch (error) {
    console.error('Admin chat inbox lookup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not load the support inbox.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const { user, role, response } = await requireAdmin('chat.manage');
  if (response) return response;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }
  try {
    await ensureDatabaseSchema();
    const chatId = typeof body.chatId === 'string' ? body.chatId : '';
    if (!/^\d+$/.test(chatId) || !await canAccessChat(chatId, user!.id, role!)) {
      return NextResponse.json({ error: 'This chat is outside your assignment.' }, { status: 403 });
    }
    const sql = getNeonSql();
    if (body.action === 'typing') {
      const isTyping = body.isTyping === true;
      await sql`INSERT INTO admin_chat_typing (chat_id, user_id, is_typing, expires_at)
        VALUES (${chatId}::bigint, ${user!.id}::uuid, ${isTyping}, now() + interval '6 seconds')
        ON CONFLICT (chat_id, user_id) DO UPDATE
        SET is_typing = EXCLUDED.is_typing, expires_at = EXCLUDED.expires_at`;
      return NextResponse.json({ success: true });
    }
    if (body.action === 'message') {
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (!message || message.length > 2000) {
        return NextResponse.json({ error: 'Message must contain 1 to 2,000 characters.' }, { status: 400 });
      }
      const rows = await sql`INSERT INTO admin_chat_messages
        (chat_id, sender_id, sender_type, sender_name, message)
        VALUES (${chatId}::bigint, ${user!.id}::uuid, 'staff', ${user!.fullName}, ${message})
        RETURNING id::text AS id, sender_type AS "senderType", sender_name AS "senderName",
          message, created_at::text AS "createdAt"` as Record<string, unknown>[];
      await sql`UPDATE admin_chats SET status = 'open', updated_at = now() WHERE id = ${chatId}::bigint`;
      await sql`DELETE FROM admin_chat_typing WHERE chat_id = ${chatId}::bigint AND user_id = ${user!.id}::uuid`;
      const row = rows[0];
      return NextResponse.json({ message: {
        id: String(row.id), senderType: String(row.senderType), senderName: String(row.senderName),
        message: String(row.message), createdAt: String(row.createdAt),
      } }, { status: 201 });
    }
    if (body.action === 'transfer') {
      const department = body.department;
      const assignedTo = body.assignedTo === null ? null : typeof body.assignedTo === 'string' ? body.assignedTo : '';
      if (!DEPARTMENTS.includes(department as Department)) {
        return NextResponse.json({ error: 'Choose a supported department.' }, { status: 400 });
      }
      if (assignedTo && !UUID_PATTERN.test(assignedTo)) {
        return NextResponse.json({ error: 'Choose a valid staff member.' }, { status: 400 });
      }
      if (assignedTo) {
        const target = await sql`SELECT staff.role, u.email FROM app_users u
          LEFT JOIN admin_staff staff ON staff.user_id = u.id
          WHERE u.id = ${assignedTo}::uuid LIMIT 1` as Record<string, unknown>[];
        if (!target[0] || (target[0].role === 'read_only') ||
          (target[0].role && departmentForRole(String(target[0].role)) !== department) ||
          (!target[0].role && !isAdminEmail(String(target[0].email)))) {
          return NextResponse.json({ error: 'The selected person is not an eligible administrator or staff member for this department.' }, { status: 400 });
        }
      }
      await sql`UPDATE admin_chats SET department = ${department}, assigned_to = ${assignedTo}::uuid,
        status = 'open', updated_at = now() WHERE id = ${chatId}::bigint`;
      await sql`DELETE FROM admin_chat_typing WHERE chat_id = ${chatId}::bigint AND user_id = ${user!.id}::uuid`;
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: 'Choose a supported chat action.' }, { status: 400 });
  } catch (error) {
    console.error('Admin chat action failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not update the support chat.' }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const { user, role, response } = await requireAdmin('chat.manage');
  if (response) return response;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }
  const chatId = typeof body.chatId === 'string' ? body.chatId : '';
  const status = body.status;
  if (!/^\d+$/.test(chatId) || !['open', 'resolved', 'closed'].includes(String(status))) {
    return NextResponse.json({ error: 'Provide a valid chat and status.' }, { status: 400 });
  }
  try {
    await ensureDatabaseSchema();
    if (!await canAccessChat(chatId, user!.id, role!)) {
      return NextResponse.json({ error: 'This chat is outside your assignment.' }, { status: 403 });
    }
    await getNeonSql()`UPDATE admin_chats SET status = ${status}, updated_at = now()
      WHERE id = ${chatId}::bigint`;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin chat status update failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not update the chat status.' }, { status: 503 });
  }
}
