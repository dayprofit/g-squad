import { NextResponse } from 'next/server';
import { finishOAuth, loadDerivSession } from '@/lib/server/deriv-auth';
import { getCurrentAppUser } from '@/lib/server/app-auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const user = await getCurrentAppUser();
    if (!user) return NextResponse.json({ error: 'Application login expired. Log in, then reconnect Deriv.' }, { status: 401 });
    const body = await request.json();
    const code = typeof body.code === 'string' ? body.code : '';
    const state = typeof body.state === 'string' ? body.state : '';
    if (!code || code.length > 4096 || !/^[A-Za-z0-9_-]{32,128}$/.test(state)) {
      return NextResponse.json({ error: 'Deriv authorization response is invalid.' }, { status: 400 });
    }
    await finishOAuth(user.id, code, state, request.url);
    return NextResponse.json(await loadDerivSession(user.id));
  } catch (error) {
    console.error('Deriv authorization callback failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Deriv authorization failed.' }, { status: 400 });
  }
}