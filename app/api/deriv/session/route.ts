import { NextResponse } from 'next/server';
import { disconnectDeriv, loadDerivSession } from '@/lib/server/deriv-auth';
import { getCurrentAppUser } from '@/lib/server/app-auth';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const user = await getCurrentAppUser();
    if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    return NextResponse.json(await loadDerivSession(user.id));
  } catch (error) {
    console.error('Deriv session lookup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Deriv connection is unavailable. Reconnect your Deriv account.' }, { status: 503 });
  }
}

export async function DELETE() {
  try {
    const user = await getCurrentAppUser();
    if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    await disconnectDeriv(user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Deriv disconnect failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Deriv account could not be disconnected.' }, { status: 503 });
  }
}