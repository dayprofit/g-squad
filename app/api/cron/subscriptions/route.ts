import { NextResponse } from 'next/server';
import { synchronizeSubscriptionPayments } from '@/lib/server/subscription-wallets';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function synchronize(request: Request) {
  const secret = process.env.SUBSCRIPTION_CRON_SECRET ?? process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  try {
    const result = await synchronizeSubscriptionPayments();
    return NextResponse.json({ success: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Scheduled subscription payment check failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not synchronize subscription payments.' }, { status: 503 });
  }
}

export async function GET(request: Request) {
  return synchronize(request);
}

export async function POST(request: Request) {
  return synchronize(request);
}
