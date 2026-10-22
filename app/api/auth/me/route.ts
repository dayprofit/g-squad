import { NextResponse } from 'next/server';
import { getCurrentAppUser } from '@/lib/server/app-auth';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const user = await getCurrentAppUser();
    return NextResponse.json({ user });
  } catch (error) {
    console.error('Application session lookup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Application authentication is unavailable.' }, { status: 503 });
  }
}