import { NextResponse } from 'next/server';
import { getCurrentAppUser } from '@/lib/server/app-auth';
import { getUserSubscriptionSnapshot } from '@/lib/server/subscription-wallets';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getCurrentAppUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  try {
    const subscription = await getUserSubscriptionSnapshot(user.id);
    return NextResponse.json(subscription, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Subscription status lookup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not load subscription and deposit status.' }, { status: 503 });
  }
}
