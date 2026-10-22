import { NextResponse } from 'next/server';
import { deleteAppSession, APP_SESSION_COOKIE } from '@/lib/server/app-auth';

export const runtime = 'nodejs';

export async function POST() {
  try {
    await deleteAppSession();
    const response = NextResponse.json({ success: true });
    response.cookies.set(APP_SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
    return response;
  } catch {
    return NextResponse.json({ error: 'Could not end the application session.' }, { status: 503 });
  }
}