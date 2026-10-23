import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { recordAppUserActivity } from '@/lib/server/app-auth';
import { synchronizeSubscriptionPayments } from '@/lib/server/subscription-wallets';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  const { user: admin, role, response } = await requireAdmin('settings.manage', { recentReauthentication: true });
  if (response) return response;
  if (role !== 'owner') {
    return NextResponse.json({ error: 'Only an Owner can run subscription payment checks.' }, { status: 403 });
  }

  try {
    const result = await synchronizeSubscriptionPayments();
    await recordAppUserActivity({
      actorUserId: admin!.id,
      eventType: 'admin.subscription_payment_scan',
      details: result,
    });
    return NextResponse.json({ success: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Admin-triggered subscription payment scan failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Could not check subscription payments.',
    }, { status: 503 });
  }
}
