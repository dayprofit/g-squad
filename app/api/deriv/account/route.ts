import { NextResponse } from 'next/server';
import { switchDerivAccount } from '@/lib/server/deriv-auth';
import { getCurrentAppUser } from '@/lib/server/app-auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const user = await getCurrentAppUser();
    if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    const body = await request.json();
    const accountId = typeof body.accountId === 'string' ? body.accountId : '';
    if (!/^[A-Za-z0-9]{2,32}$/.test(accountId)) return NextResponse.json({ error: 'Deriv account ID is invalid.' }, { status: 400 });
    return NextResponse.json(await switchDerivAccount(user.id, accountId));
  } catch (error) {
    console.error('Deriv account switch failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not switch Deriv accounts.' }, { status: 400 });
  }
}