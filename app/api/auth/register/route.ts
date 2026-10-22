import { NextResponse } from 'next/server';
import { AppEmailConflictError, createAppSession, createAppUser, APP_SESSION_COOKIE } from '@/lib/server/app-auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (fullName.length < 2 || fullName.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Enter a valid name and email address.' }, { status: 400 });
    }
    if (password.length < 10 || password.length > 128) {
      return NextResponse.json({ error: 'Password must be between 10 and 128 characters.' }, { status: 400 });
    }

    const user = await createAppUser({ fullName, email, password });
    const token = await createAppSession(user.id);
    const response = NextResponse.json({ user }, { status: 201 });
    response.cookies.set(APP_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (error) {
    if (error instanceof AppEmailConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const code = (error as { code?: string }).code;
    if (code?.includes('ConstraintValidationFailed')) {
      return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 });
    }
    console.error('Application registration failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Registration is unavailable. Check the server database configuration.' }, { status: 503 });
  }
}