import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';

export async function GET() {
  const { response } = await requireAdmin('health.read');
  if (response) return response;
  try {
    await ensureDatabaseSchema();
    await getNeonSql()`SELECT 1`;
    return NextResponse.json({
      status: 'operational',
      checkedAt: new Date().toISOString(),
      processUptimeSeconds: Math.floor(process.uptime()),
      services: { application: 'operational', database: 'operational' },
      configured: {
        derivOAuth: Boolean(process.env.NEXT_PUBLIC_DERIV_APP_ID && process.env.NEXT_PUBLIC_DERIV_REDIRECT_URI),
        encryptedTokenStorage: Boolean(process.env.DERIV_TOKEN_ENCRYPTION_KEY),
      },
    });
  } catch (error) {
    console.error('Admin health check failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({
      status: 'degraded',
      checkedAt: new Date().toISOString(),
      services: { application: 'operational', database: 'unavailable' },
    }, { status: 503 });
  }
}
