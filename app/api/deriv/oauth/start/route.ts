import { NextResponse } from 'next/server';
import { createOAuthFlow } from '@/lib/server/deriv-auth';
import { getCurrentAppUser } from '@/lib/server/app-auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const user = await getCurrentAppUser();
    if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const landingSearch = typeof body.landingSearch === 'string' ? body.landingSearch.slice(0, 2048) : '';
    const authorizationUrl = await createOAuthFlow(user.id, request.url, landingSearch);
    return NextResponse.json({ authorizationUrl });
  } catch (error) {
    console.error('Could not begin Deriv authorization:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Deriv connection could not be started. Check server configuration.' }, { status: 503 });
  }
}