import { NextResponse } from 'next/server';
import { getCurrentAppUser } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';
import { requireActiveDemoAccount } from '@/lib/server/deriv-auth';

export const runtime = 'nodejs';

const MAX_TICKS = 60;
const DECISION_FORMAT = {
  type: 'object',
  properties: {
    decision: { type: 'string', enum: ['approve', 'reject'] },
    reason: { type: 'string' },
  },
  required: ['decision', 'reason'],
};

interface ReviewRequest {
  symbol: string;
  direction: 'CALL' | 'PUT';
  prices: number[];
}

function parseReviewRequest(value: unknown): ReviewRequest | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  if (
    typeof body.symbol !== 'string' ||
    !/^[A-Z0-9_]{2,20}$/.test(body.symbol) ||
    (body.direction !== 'CALL' && body.direction !== 'PUT') ||
    !Array.isArray(body.prices) ||
    body.prices.length < 20 ||
    body.prices.length > MAX_TICKS ||
    !body.prices.every((price) => typeof price === 'number' && Number.isFinite(price) && price > 0)
  ) return null;
  return { symbol: body.symbol, direction: body.direction, prices: body.prices };
}

function reviewReason(value: unknown): { decision: 'approve' | 'reject'; reason: string } | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const result = parsed as Record<string, unknown>;
    if (
      (result.decision !== 'approve' && result.decision !== 'reject') ||
      typeof result.reason !== 'string' ||
      result.reason.trim().length === 0 ||
      result.reason.length > 500
    ) return null;
    return { decision: result.decision, reason: result.reason.trim() };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentAppUser();
    if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    await requireActiveDemoAccount(user.id);

    let input: ReviewRequest | null;
    try {
      input = parseReviewRequest(await request.json());
    } catch {
      input = null;
    }
    if (!input) {
      return NextResponse.json({ error: `Provide a market, CALL or PUT candidate, and ${MAX_TICKS} or fewer recent positive price ticks (at least 20).` }, { status: 400 });
    }

    await ensureDatabaseSchema();
    const rows = await getNeonSql()`
      SELECT trading_config AS config FROM app_users WHERE id = ${user.id}::uuid LIMIT 1
    ` as Record<string, unknown>[];
    const config = rows[0]?.config as Record<string, unknown> | null | undefined;
    if (!config) return NextResponse.json({ error: 'Save your trading configuration before requesting an AI review.' }, { status: 409 });
    if (config.symbol !== input.symbol) {
      return NextResponse.json({ error: 'The live market does not match your saved strategy market. Select the configured market before reviewing.' }, { status: 409 });
    }

    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    const model = process.env.OLLAMA_MODEL || 'qwen3:8b';
    const endpoint = new URL('/api/chat', baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          think: false,
          format: DECISION_FORMAT,
          options: { temperature: 0 },
          messages: [
            {
              role: 'system',
              content: 'You are a cautious second-check for a proposed short-term synthetic-market trade. Analyze only the supplied recent prices and proposed direction. Return reject if evidence is weak, mixed, insufficient, or inconsistent with the proposed direction. Never claim a trade is safe or profitable. Your output is only an approval gate and cannot override deterministic risk limits.',
            },
            {
              role: 'user',
              content: JSON.stringify({
                market: input.symbol,
                proposedDirection: input.direction,
                recentPrices: input.prices,
              }),
            },
          ],
        }),
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      console.error('Ollama review request failed:', response.status);
      return NextResponse.json({ error: 'Local AI review is unavailable. Check that Ollama is running and the configured model is installed.' }, { status: 503 });
    }
    const payload: unknown = await response.json();
    const message = payload && typeof payload === 'object'
      ? (payload as { message?: { content?: unknown } }).message
      : undefined;
    const result = reviewReason(message?.content);
    if (!result) {
      console.error('Ollama returned an invalid review response.');
      return NextResponse.json({ error: 'Local AI returned an invalid review. No trade should be considered approved.' }, { status: 502 });
    }
    return NextResponse.json({ ...result, model });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({ error: 'Local AI review timed out. No trade should be considered approved.' }, { status: 504 });
    }
    console.error('AI trade review failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'AI review could not be completed. No trade should be considered approved.' }, { status: 503 });
  }
}
