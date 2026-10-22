import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { DerivAccount } from '@deriv/core';
import { getApiBaseUrl, getAuthBaseUrl, parseReferralLink, resolveReferralViaProxy } from '@deriv/core';
import { ensureDatabaseSchema, getNeonSql } from './neon';

interface StoredDerivTokens {
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  expiresAt: number;
  scope: string;
}

interface TokenPayload {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  scope: string;
}

function encryptionKey(): Buffer {
  const value = process.env.DERIV_TOKEN_ENCRYPTION_KEY;
  if (!value) throw new Error('DERIV_TOKEN_ENCRYPTION_KEY is not configured.');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('DERIV_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  return key;
}

function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

function decrypt(value: string): string {
  const [ivText, tagText, encryptedText] = value.split('.');
  if (!ivText || !tagText || !encryptedText) throw new Error('Stored Deriv credential is invalid.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]).toString('utf8');
}

function clientId(): string {
  const id = process.env.NEXT_PUBLIC_DERIV_APP_ID;
  if (!id) throw new Error('NEXT_PUBLIC_DERIV_APP_ID is not configured.');
  return id;
}

export function redirectUri(requestUrl: string): string {
  return process.env.NEXT_PUBLIC_DERIV_REDIRECT_URI || new URL(requestUrl).origin;
}

export async function createOAuthFlow(userId: string, callbackUrl: string, landingSearch = ''): Promise<string> {
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const stateHash = createHash('sha256').update(state).digest('hex');
  await ensureDatabaseSchema();
  const sql = getNeonSql();
  await sql`DELETE FROM deriv_oauth_flows WHERE expires_at <= now()`;
  await sql`INSERT INTO deriv_oauth_flows (state_hash, code_verifier, user_id, expires_at)
    VALUES (${stateHash}, ${verifier}, ${userId}::uuid, ${new Date(Date.now() + 10 * 60 * 1000)})`;

  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(callbackUrl),
    response_type: 'code',
    scope: process.env.NEXT_PUBLIC_DERIV_OAUTH_SCOPES?.split(',').join(' ') || 'trade',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  const referralLink = process.env.NEXT_PUBLIC_DERIV_REFERRAL_LINK ?? '';
  let referral = parseReferralLink(referralLink);
  if (!referral) referral = await resolveReferralViaProxy(referralLink);
  if (referral) {
    params.set(referral.affiliateTokenParam, referral.affiliateToken);
    if (referral.utmCampaign) params.set('utm_campaign', referral.utmCampaign);
    if (referral.utmSource) params.set('utm_source', referral.utmSource);
    if (referral.utmMedium) params.set('utm_medium', referral.utmMedium);
  }
  const landing = new URLSearchParams(landingSearch);
  const landingToken = landing.get('t');
  if (landingToken) params.set('t', landingToken);
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign']) {
    const value = landing.get(key);
    if (value) params.set(key, value);
  }
  return `${getAuthBaseUrl()}/auth?${params.toString()}`;
}

async function takeOAuthFlow(userId: string, state: string): Promise<string> {
  const stateHash = createHash('sha256').update(state).digest('hex');
  await ensureDatabaseSchema();
  const result = await getNeonSql()`
    DELETE FROM deriv_oauth_flows
    WHERE state_hash = ${stateHash} AND user_id = ${userId}::uuid AND expires_at > now()
    RETURNING code_verifier
  ` as Record<string, unknown>[];
  if (!result[0]) throw new Error('OAuth state is invalid or expired. Restart Deriv connection.');
  return String(result[0].code_verifier);
}

async function exchangeCode(code: string, verifier: string, callbackUrl: string): Promise<TokenPayload> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId(),
    redirect_uri: redirectUri(callbackUrl),
    code_verifier: verifier,
  });
  const response = await fetch(`${getAuthBaseUrl()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Deriv authorization failed (${response.status}).`);
  const payload = await response.json() as TokenPayload;
  if (!payload.access_token || !payload.refresh_token || !payload.scope) throw new Error('Deriv returned an incomplete authorization response.');
  if (!payload.scope.split(/\s+/).includes('trade')) throw new Error('Deriv authorization is missing the required trade permission.');
  return payload;
}

async function saveTokens(userId: string, payload: TokenPayload): Promise<void> {
  await ensureDatabaseSchema();
  await getNeonSql()`
    UPDATE app_users SET deriv_access_token = ${encrypt(payload.access_token)},
      deriv_refresh_token = ${encrypt(payload.refresh_token)},
      deriv_token_expires_at = ${payload.expires_at ?? Math.floor(Date.now() / 1000) + payload.expires_in},
      deriv_scope = ${payload.scope}
    WHERE id = ${userId}::uuid
  `;
}

export async function finishOAuth(userId: string, code: string, state: string, callbackUrl: string): Promise<void> {
  const verifier = await takeOAuthFlow(userId, state);
  const payload = await exchangeCode(code, verifier, callbackUrl);
  await saveTokens(userId, payload);
}

async function readTokens(userId: string): Promise<StoredDerivTokens | null> {
  await ensureDatabaseSchema();
  const result = await getNeonSql()`
    SELECT deriv_access_token AS "accessToken", deriv_refresh_token AS "refreshToken",
      deriv_token_expires_at AS "expiresAt", deriv_scope AS scope
    FROM app_users WHERE id = ${userId}::uuid LIMIT 1
  ` as Record<string, unknown>[];
  const record = result[0];
  if (!record?.accessToken || !record.refreshToken) return null;
  return {
    accessTokenEncrypted: String(record.accessToken),
    refreshTokenEncrypted: String(record.refreshToken),
    expiresAt: Number(record.expiresAt),
    scope: String(record.scope),
  };
}

async function refreshTokens(userId: string, refreshToken: string): Promise<TokenPayload> {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId() });
  const response = await fetch(`${getAuthBaseUrl()}/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, cache: 'no-store',
  });
  if (!response.ok) throw new Error('Deriv authorization expired. Reconnect the account.');
  const payload = await response.json() as TokenPayload;
  if (!payload.access_token || !payload.refresh_token || !payload.scope) throw new Error('Deriv token refresh response was incomplete.');
  if (!payload.scope.split(/\s+/).includes('trade')) throw new Error('Deriv authorization lost the required trade permission.');
  await saveTokens(userId, payload);
  return payload;
}

async function getAccessToken(userId: string): Promise<{ token: string; scope: string } | null> {
  const stored = await readTokens(userId);
  if (!stored) return null;
  if (stored.expiresAt <= Math.floor(Date.now() / 1000) + 30) {
    const refreshed = await refreshTokens(userId, decrypt(stored.refreshTokenEncrypted));
    return { token: refreshed.access_token, scope: refreshed.scope };
  }
  return { token: decrypt(stored.accessTokenEncrypted), scope: stored.scope };
}

async function authorizedRequest<T>(token: string, path: string, method = 'GET'): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Deriv-App-ID': clientId() },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Deriv account request failed (${response.status}).`);
  return response.json() as Promise<T>;
}

interface AccountsResponse { data: DerivAccount[] }
interface OTPResponse { data: { url: string } }

async function listAccounts(token: string): Promise<DerivAccount[]> {
  const result = await authorizedRequest<AccountsResponse>(token, '/accounts');
  return Array.isArray(result.data) ? result.data : [];
}

async function getOTP(token: string, accountId: string): Promise<string> {
  const result = await authorizedRequest<OTPResponse>(token, `/accounts/${encodeURIComponent(accountId)}/otp`, 'POST');
  if (!result.data?.url) throw new Error('Deriv did not return a WebSocket session URL.');
  return result.data.url;
}

async function getActiveAccountId(userId: string): Promise<string | null> {
  const result = await getNeonSql()`
    SELECT deriv_account_id AS "accountId" FROM app_users WHERE id = ${userId}::uuid LIMIT 1
  ` as Record<string, unknown>[];
  return result[0]?.accountId ? String(result[0].accountId) : null;
}

async function saveActiveAccount(userId: string, accountId: string): Promise<void> {
  await getNeonSql()`
    UPDATE app_users SET deriv_account_id = ${accountId} WHERE id = ${userId}::uuid
  `;
}

export async function loadDerivSession(userId: string): Promise<{ accounts: DerivAccount[]; activeAccountId: string | null; wsUrl: string | null }> {
  const auth = await getAccessToken(userId);
  if (!auth) return { accounts: [], activeAccountId: null, wsUrl: null };
  if (!auth.scope.split(/\s+/).includes('trade')) throw new Error('Deriv authorization is missing trade permission.');
  const accounts = await listAccounts(auth.token);
  const previousId = await getActiveAccountId(userId);
  const selected = accounts.find((account) => account.account_id === previousId) ?? accounts[0];
  if (!selected) return { accounts, activeAccountId: null, wsUrl: null };
  if (selected.account_id !== previousId) await saveActiveAccount(userId, selected.account_id);
  return { accounts, activeAccountId: selected.account_id, wsUrl: await getOTP(auth.token, selected.account_id) };
}

export async function switchDerivAccount(userId: string, accountId: string): Promise<{ accounts: DerivAccount[]; activeAccountId: string; wsUrl: string }> {
  const auth = await getAccessToken(userId);
  if (!auth) throw new Error('Connect a Deriv account first.');
  const accounts = await listAccounts(auth.token);
  const selected = accounts.find((account) => account.account_id === accountId);
  if (!selected) throw new Error('That Deriv account is not authorized for this user.');
  await saveActiveAccount(userId, accountId);
  return { accounts, activeAccountId: accountId, wsUrl: await getOTP(auth.token, accountId) };
}

export async function disconnectDeriv(userId: string): Promise<void> {
  await ensureDatabaseSchema();
  await getNeonSql()`
    UPDATE app_users SET deriv_access_token = NULL, deriv_refresh_token = NULL,
      deriv_token_expires_at = NULL, deriv_scope = NULL, deriv_account_id = NULL
    WHERE id = ${userId}::uuid
  `;
  await getNeonSql()`DELETE FROM deriv_oauth_flows WHERE user_id = ${userId}::uuid`;
}
