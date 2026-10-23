import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { recordAppUserActivity } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';
import {
  ensureTreasuryWallet,
  formatUsdtRaw,
  getSubscriptionSettings,
  isUsdtContractConfigured,
  saveSubscriptionSettings,
  type SubscriptionSettings,
  verifyUsdtContract,
} from '@/lib/server/subscription-wallets';

export const runtime = 'nodejs';

export async function GET() {
  const { role, response } = await requireAdmin('settings.manage');
  if (response) return response;
  if (role !== 'owner') return NextResponse.json({ error: 'Only an Owner can manage subscriptions and deposits.' }, { status: 403 });
  try {
    await ensureDatabaseSchema();
    const settings = await getSubscriptionSettings();
    const treasuryRows = await getNeonSql()`SELECT address FROM subscription_wallets
      WHERE wallet_type = 'treasury' LIMIT 1` as Record<string, unknown>[];
    const payments = await getNeonSql()`SELECT payment.id::text AS id,
      payment.user_id::text AS "userId", app_user.full_name AS "userName", app_user.email,
      wallet.address AS "depositAddress", payment.deposit_txid AS "depositTxid",
      payment.amount_raw::text AS "amountRaw", payment.expected_amount_raw::text AS "expectedAmountRaw",
      payment.status, payment.sweep_status AS "sweepStatus", payment.sweep_txid AS "sweepTxid",
      payment.received_at::text AS "receivedAt"
      FROM subscription_payments payment
      JOIN app_users app_user ON app_user.id = payment.user_id
      JOIN subscription_wallets wallet ON wallet.id = payment.wallet_id
      ORDER BY payment.received_at DESC LIMIT 300` as Record<string, unknown>[];
    const wallets = await getNeonSql()`SELECT wallet.id::text AS id,
      wallet.user_id::text AS "userId", app_user.full_name AS "userName", app_user.email,
      wallet.address, wallet.created_at::text AS "createdAt",
      wallet.last_checked_at::text AS "lastCheckedAt"
      FROM subscription_wallets wallet
      JOIN app_users app_user ON app_user.id = wallet.user_id
      WHERE wallet.wallet_type = 'user'
      ORDER BY wallet.created_at DESC` as Record<string, unknown>[];
    return NextResponse.json({
      settings,
      network: 'TRON Nile testnet',
      contractConfigured: isUsdtContractConfigured(),
      treasuryAddress: treasuryRows[0]?.address ? String(treasuryRows[0].address) : null,
      wallets: wallets.map((row) => ({
        id: String(row.id), userId: String(row.userId), userName: String(row.userName),
        email: String(row.email), address: String(row.address),
        createdAt: String(row.createdAt),
        lastCheckedAt: row.lastCheckedAt ? String(row.lastCheckedAt) : null,
      })),
      payments: payments.map((row) => ({
        id: String(row.id), userId: String(row.userId), userName: String(row.userName),
        email: String(row.email), depositAddress: String(row.depositAddress),
        depositTxid: String(row.depositTxid), amountUsdt: formatUsdtRaw(String(row.amountRaw)),
        expectedAmountUsdt: formatUsdtRaw(String(row.expectedAmountRaw)),
        status: String(row.status), sweepStatus: String(row.sweepStatus),
        sweepTxid: row.sweepTxid ? String(row.sweepTxid) : null,
        receivedAt: String(row.receivedAt),
      })),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Subscription administration lookup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not load subscription administration.' }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const { user: admin, role, response } = await requireAdmin('settings.manage', { recentReauthentication: true });
  if (response) return response;
  if (role !== 'owner') return NextResponse.json({ error: 'Only an Owner can change subscription settings.' }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  try {
    const enabled = body.enabled;
    const amountUsdt = body.amountUsdt;
    const durationDays = body.durationDays;
    if (typeof enabled !== 'boolean' || typeof amountUsdt !== 'number' ||
      !Number.isFinite(amountUsdt) || amountUsdt < (enabled ? 0.01 : 0) || amountUsdt > 1_000_000_000 ||
      Number(amountUsdt.toFixed(2)) !== amountUsdt ||
      !Number.isInteger(durationDays) || Number(durationDays) < 1 || Number(durationDays) > 3650) {
      return NextResponse.json({ error: 'When enabled, set a price from 0.01 to 1,000,000,000 USDT (up to 2 decimals); duration must be 1 to 3650 days.' }, { status: 400 });
    }
    if (enabled) {
      await verifyUsdtContract();
      await ensureTreasuryWallet();
    }
    const settings: SubscriptionSettings = { enabled, amountUsdt, durationDays: Number(durationDays) };
    await saveSubscriptionSettings(settings, admin!.id);
    await recordAppUserActivity({
      actorUserId: admin!.id,
      eventType: 'admin.subscription_settings_changed',
      details: { enabled, amountUsdt, durationDays, network: 'TRON Nile testnet' },
    });
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    console.error('Subscription settings update failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save subscription settings.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const { user: admin, role, response } = await requireAdmin('settings.manage', { recentReauthentication: true });
  if (response) return response;
  if (role !== 'owner') return NextResponse.json({ error: 'Only an Owner can review subscription payments.' }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }
  const paymentId = typeof body.paymentId === 'string' ? body.paymentId : '';
  if (body.action !== 'reject' || !/^\d+$/.test(paymentId)) {
    return NextResponse.json({ error: 'Choose a valid pending payment to reject.' }, { status: 400 });
  }
  try {
    const rows = await getNeonSql()`UPDATE subscription_payments SET status = 'rejected',
      sweep_status = 'not_required', updated_at = now()
      WHERE id = ${paymentId}::bigint AND status = 'pending'
      RETURNING user_id::text AS "userId", deposit_txid AS "depositTxid"` as Record<string, unknown>[];
    if (!rows[0]) return NextResponse.json({ error: 'Payment was not found or is no longer pending.' }, { status: 409 });
    await recordAppUserActivity({
      actorUserId: admin!.id,
      subjectUserId: String(rows[0].userId),
      eventType: 'admin.subscription_payment_rejected',
      details: { depositTxid: String(rows[0].depositTxid) },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Subscription payment review failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not update this payment.' }, { status: 503 });
  }
}
