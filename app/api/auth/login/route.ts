import { NextResponse } from 'next/server';
import { createAppSession, findAppUserByEmail, isAppLoginRateLimited, recordFailedAppLogin, recordSuccessfulAppLogin, verifyPassword, APP_SESSION_COOKIE } from '@/lib/server/app-auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const validInput = email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && password.length <= 128;
    if (validInput && password && await isAppLoginRateLimited(email)) {
      return NextResponse.json({ error: 'Too many unsuccessful sign-in attempts. Try again in 15 minutes.' }, { status: 429 });
    }
    const user = validInput && password ? await findAppUserByEmail(email) : null;
    if (!user || user.isSuspended || !(await verifyPassword(password, user.passwordHash))) {
      if (validInput && password) await recordFailedAppLogin(email);
      return NextResponse.json({ error: 'Email or password is incorrect.' }, { status: 401 });
    }

    const token = await createAppSession(user.id);
    await recordSuccessfulAppLogin(user.id);
    const { passwordHash: _passwordHash, isSuspended: _isSuspended, ...safeUser } = user;
    const response = NextResponse.json({ user: safeUser });
    response.cookies.set(APP_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (error) {
    console.error('Application login failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Login is unavailable. Check the server database configuration.' }, { status: 503 });
  }
}