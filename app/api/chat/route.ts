import { NextResponse } from 'next/server';
import { getCurrentAppUser } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getCurrentAppUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  try {
    await ensureDatabaseSchema();
    const sql = getNeonSql();
    let chats = await sql`SELECT id::text AS id, status, updated_at::text AS "updatedAt"
      FROM admin_chats WHERE user_id = ${user.id}::uuid LIMIT 1` as Record<string, unknown>[];
    if (!chats[0]) {
      await sql`INSERT INTO admin_chats (user_id) VALUES (${user.id}::uuid) ON CONFLICT (user_id) DO NOTHING`;
      chats = await sql`SELECT id::text AS id, status, updated_at::text AS "updatedAt"
        FROM admin_chats WHERE user_id = ${user.id}::uuid LIMIT 1` as Record<string, unknown>[];
    }
    const chat = chats[0];
    if (!chat) throw new Error('Chat thread was not created.');
    const chatId = String(chat.id);
    const [messages, typing, preferences] = await Promise.all([
      sql`SELECT id::text AS id, sender_type AS "senderType", sender_name AS "senderName",
        message, created_at::text AS "createdAt"
        FROM (SELECT id, sender_type, sender_name, message, created_at
          FROM admin_chat_messages WHERE chat_id = ${chatId}::bigint
          ORDER BY id DESC LIMIT 200) recent ORDER BY id` as Promise<Record<string, unknown>[]>,
      sql`SELECT u.full_name AS "fullName", t.expires_at::text AS "expiresAt"
        FROM admin_chat_typing t JOIN app_users u ON u.id = t.user_id
        WHERE t.chat_id = ${chatId}::bigint AND t.user_id <> ${user.id}::uuid
          AND t.is_typing = true AND t.expires_at > now() LIMIT 1` as Promise<Record<string, unknown>[]>,
      sql`SELECT chat_sound_enabled AS "soundEnabled" FROM app_users WHERE id = ${user.id}::uuid` as Promise<Record<string, unknown>[]>,
    ]);
    return NextResponse.json({
      chat: { id: chatId, status: String(chat.status), updatedAt: String(chat.updatedAt) },
      messages: messages.map((row) => ({
        id: String(row.id), senderType: String(row.senderType), senderName: String(row.senderName),
        message: String(row.message), createdAt: String(row.createdAt),
      })),
      typing: typing[0] ? String(typing[0].fullName) : null,
      soundEnabled: preferences[0]?.soundEnabled !== false,
    });
  } catch (error) {
    console.error('Investor chat lookup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not load your support chat.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const user = await getCurrentAppUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }
  try {
    await ensureDatabaseSchema();
    const sql = getNeonSql();
    let chats = await sql`SELECT id::text AS id FROM admin_chats WHERE user_id = ${user.id}::uuid LIMIT 1` as Record<string, unknown>[];
    if (!chats[0]) {
      await sql`INSERT INTO admin_chats (user_id) VALUES (${user.id}::uuid) ON CONFLICT (user_id) DO NOTHING`;
      chats = await sql`SELECT id::text AS id FROM admin_chats WHERE user_id = ${user.id}::uuid LIMIT 1` as Record<string, unknown>[];
    }
    const chatId = String(chats[0]?.id ?? '');
    if (!chatId) throw new Error('Chat thread was not found.');

    if (body.action === 'preferences') {
      if (typeof body.soundEnabled !== 'boolean') {
        return NextResponse.json({ error: 'Sound preference must be enabled or disabled.' }, { status: 400 });
      }
      await sql`UPDATE app_users SET chat_sound_enabled = ${body.soundEnabled} WHERE id = ${user.id}::uuid`;
      return NextResponse.json({ soundEnabled: body.soundEnabled });
    }
    if (body.action === 'typing') {
      const isTyping = body.isTyping === true;
      await sql`INSERT INTO admin_chat_typing (chat_id, user_id, is_typing, expires_at)
        VALUES (${chatId}::bigint, ${user.id}::uuid, ${isTyping}, now() + interval '6 seconds')
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
        VALUES (${chatId}::bigint, ${user.id}::uuid, 'investor', ${user.fullName}, ${message})
        RETURNING id::text AS id, sender_type AS "senderType", sender_name AS "senderName",
          message, created_at::text AS "createdAt"` as Record<string, unknown>[];
      await sql`UPDATE admin_chats SET status = 'open', updated_at = now() WHERE id = ${chatId}::bigint`;
      await sql`DELETE FROM admin_chat_typing WHERE chat_id = ${chatId}::bigint AND user_id = ${user.id}::uuid`;
      const row = rows[0];
      return NextResponse.json({ message: {
        id: String(row.id), senderType: String(row.senderType), senderName: String(row.senderName),
        message: String(row.message), createdAt: String(row.createdAt),
      } }, { status: 201 });
    }
    return NextResponse.json({ error: 'Choose a supported chat action.' }, { status: 400 });
  } catch (error) {
    console.error('Investor chat action failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not update your support chat.' }, { status: 503 });
  }
}
