import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { TronWeb, utils as tronUtils } from 'tronweb';
import { ensureDatabaseSchema, getNeonSql } from './neon';

const TRON_NILE_URL = 'https://nile.trongrid.io';
const USDT_DECIMALS = 6;
const USDT_SCALE = BigInt('1000000');
const MAX_WALLETS_PER_SCAN = 20;
const MAX_PAGES_PER_WALLET = 3;
const TRON_REQUEST_TIMEOUT_MS = 5_000;
const TREASURY_FEE_LIMIT = 50_000_000;
const USDT_ABI = [{
  constant: false,
  inputs: [
    { name: '_to', type: 'address' },
    { name: '_value', type: 'uint256' },
  ],
  name: 'transfer',
  outputs: [{ name: '', type: 'bool' }],
  payable: false,
  stateMutability: 'nonpayable',
  type: 'function',
}, {
  constant: true,
  inputs: [],
  name: 'decimals',
  outputs: [{ name: '', type: 'uint8' }],
  stateMutability: 'view',
  type: 'function',
}, {
  constant: true,
  inputs: [],
  name: 'symbol',
  outputs: [{ name: '', type: 'string' }],
  stateMutability: 'view',
  type: 'function',
}] as const;

export interface SubscriptionSettings {
  enabled: boolean;
  amountUsdt: number;
  durationDays: number;
}

interface Trc20Transfer {
  transaction_id?: string;
  to?: string;
  value?: string;
  token_info?: { address?: string; decimals?: number; symbol?: string };
}

interface Trc20Response {
  data?: Trc20Transfer[];
  meta?: { fingerprint?: string };
}

function encryptionKey(): Buffer {
  const encoded = process.env.SUBSCRIPTION_WALLET_ENCRYPTION_KEY?.trim();
  if (!encoded) {
    throw new Error('Set SUBSCRIPTION_WALLET_ENCRYPTION_KEY to a base64-encoded 32-byte key.');
  }
  const key = Buffer.from(encoded, 'base64');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded) ||
    key.length !== 32 || key.toString('base64') !== encoded) {
    throw new Error('SUBSCRIPTION_WALLET_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  return key;
}

function encryptPrivateKey(privateKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

function decryptPrivateKey(value: string): string {
  const [ivValue, tagValue, ciphertextValue] = value.split('.');
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error('Stored wallet key is invalid.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function tronWeb(privateKey?: string): TronWeb {
  return new TronWeb({
    fullHost: TRON_NILE_URL,
    ...(process.env.TRON_GRID_API_KEY ? { headers: { 'TRON-PRO-API-KEY': process.env.TRON_GRID_API_KEY } } : {}),
    ...(privateKey ? { privateKey } : {}),
  });
}

export function getUsdtContractAddress(): string {
  const address = process.env.TRON_USDT_CONTRACT_ADDRESS?.trim() ?? '';
  if (!address || !TronWeb.isAddress(address)) {
    throw new Error('Set TRON_USDT_CONTRACT_ADDRESS to the verified 6-decimal USDT token contract on TRON Nile.');
  }
  return address;
}

export function isUsdtContractConfigured(): boolean {
  const address = process.env.TRON_USDT_CONTRACT_ADDRESS?.trim() ?? '';
  return Boolean(address && TronWeb.isAddress(address));
}

export async function verifyUsdtContract(): Promise<string> {
  const address = getUsdtContractAddress();
  const contract = await tronWeb().contract(USDT_ABI, address);
  const [decimals, symbol] = await Promise.all([
    contract.decimals().call(),
    contract.symbol().call(),
  ]);
  if (Number(decimals) !== USDT_DECIMALS || String(symbol).toUpperCase() !== 'USDT') {
    throw new Error('TRON_NILE USDT contract must report symbol USDT and exactly 6 decimals.');
  }
  return address;
}

export function usdtAmountToRaw(amount: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) {
    throw new Error('Subscription amount must be between 0.01 and 1,000,000,000 USDT.');
  }
  const amountString = amount.toFixed(USDT_DECIMALS);
  const [whole, fractional = ''] = amountString.split('.');
  return BigInt(whole) * USDT_SCALE + BigInt(fractional.padEnd(USDT_DECIMALS, '0'));
}

export function formatUsdtRaw(raw: string | bigint): string {
  const value = BigInt(raw);
  const whole = value / USDT_SCALE;
  const fraction = (value % USDT_SCALE).toString().padStart(USDT_DECIMALS, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export async function getSubscriptionSettings(): Promise<SubscriptionSettings> {
  await ensureDatabaseSchema();
  const rows = await getNeonSql()`SELECT setting_value AS value FROM admin_settings
    WHERE setting_key = 'subscription_settings' LIMIT 1` as Record<string, unknown>[];
  const value = rows[0]?.value;
  if (!value || typeof value !== 'object') {
    return { enabled: true, amountUsdt: 0, durationDays: 30 };
  }
  const settings = value as Record<string, unknown>;
  const amountUsdt = typeof settings.amountUsdt === 'number' ? settings.amountUsdt : Number(settings.amountUsdt);
  const durationDays = Number(settings.durationDays);
  if (typeof settings.enabled !== 'boolean' || !Number.isFinite(amountUsdt) ||
    amountUsdt < 0 || amountUsdt > 1_000_000_000 || Number(amountUsdt.toFixed(2)) !== amountUsdt ||
    !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) {
    throw new Error('Stored subscription settings are invalid. Ask an Owner to review them.');
  }
  return {
    enabled: settings.enabled,
    amountUsdt,
    durationDays,
  };
}

export async function saveSubscriptionSettings(
  settings: SubscriptionSettings,
  updatedBy: string,
): Promise<void> {
  await ensureDatabaseSchema();
  await getNeonSql()`INSERT INTO admin_settings (setting_key, setting_value, updated_by)
    VALUES ('subscription_settings', ${JSON.stringify(settings)}::jsonb, ${updatedBy}::uuid)
    ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value,
      updated_by = EXCLUDED.updated_by, updated_at = now()`;
}

async function createWallet(walletType: 'user' | 'treasury', userId: string | null) {
  const account = tronUtils.accounts.generateAccount();
  const encryptedPrivateKey = encryptPrivateKey(account.privateKey);
  const sql = getNeonSql();
  try {
    const rows = walletType === 'user'
      ? await sql`INSERT INTO subscription_wallets (wallet_type, user_id, address, encrypted_private_key)
          VALUES ('user', ${userId!}::uuid, ${account.address.base58}, ${encryptedPrivateKey})
          ON CONFLICT (user_id) WHERE wallet_type = 'user' DO NOTHING
          RETURNING id::text AS id, address` as Record<string, unknown>[]
      : await sql`INSERT INTO subscription_wallets (wallet_type, address, encrypted_private_key)
          VALUES ('treasury', ${account.address.base58}, ${encryptedPrivateKey})
          ON CONFLICT (wallet_type) WHERE wallet_type = 'treasury' DO NOTHING
          RETURNING id::text AS id, address` as Record<string, unknown>[];
    return rows[0] ?? null;
  } catch (error) {
    console.error('Subscription wallet creation failed:', error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
}

export async function ensureUserDepositWallet(userId: string): Promise<{ id: string; address: string }> {
  await ensureDatabaseSchema();
  encryptionKey();
  const existing = await getNeonSql()`SELECT id::text AS id, address FROM subscription_wallets
    WHERE wallet_type = 'user' AND user_id = ${userId}::uuid LIMIT 1` as Record<string, unknown>[];
  if (existing[0]) return { id: String(existing[0].id), address: String(existing[0].address) };
  const created = await createWallet('user', userId);
  if (created) return { id: String(created.id), address: String(created.address) };
  const raced = await getNeonSql()`SELECT id::text AS id, address FROM subscription_wallets
    WHERE wallet_type = 'user' AND user_id = ${userId}::uuid LIMIT 1` as Record<string, unknown>[];
  if (!raced[0]) throw new Error('Could not create the subscription deposit wallet.');
  return { id: String(raced[0].id), address: String(raced[0].address) };
}

export async function ensureTreasuryWallet(): Promise<{ id: string; address: string }> {
  await ensureDatabaseSchema();
  encryptionKey();
  const existing = await getNeonSql()`SELECT id::text AS id, address FROM subscription_wallets
    WHERE wallet_type = 'treasury' LIMIT 1` as Record<string, unknown>[];
  if (existing[0]) return { id: String(existing[0].id), address: String(existing[0].address) };
  const created = await createWallet('treasury', null);
  if (created) return { id: String(created.id), address: String(created.address) };
  const raced = await getNeonSql()`SELECT id::text AS id, address FROM subscription_wallets
    WHERE wallet_type = 'treasury' LIMIT 1` as Record<string, unknown>[];
  if (!raced[0]) throw new Error('Could not create the treasury wallet.');
  return { id: String(raced[0].id), address: String(raced[0].address) };
}

async function readTrc20Transfers(address: string, contractAddress: string): Promise<Trc20Transfer[]> {
  const transfers: Trc20Transfer[] = [];
  let fingerprint = '';
  for (let page = 0; page < MAX_PAGES_PER_WALLET; page += 1) {
    const url = new URL(`${TRON_NILE_URL}/v1/accounts/${encodeURIComponent(address)}/transactions/trc20`);
    url.searchParams.set('only_confirmed', 'true');
    url.searchParams.set('limit', '200');
    url.searchParams.set('contract_address', contractAddress);
    if (fingerprint) url.searchParams.set('fingerprint', fingerprint);
    const response = await fetch(url, {
      cache: 'no-store',
      headers: process.env.TRON_GRID_API_KEY ? { 'TRON-PRO-API-KEY': process.env.TRON_GRID_API_KEY } : {},
      signal: AbortSignal.timeout(TRON_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`TRON Nile transfer lookup failed with status ${response.status}.`);
    const result = await response.json() as Trc20Response;
    transfers.push(...(result.data ?? []));
    fingerprint = result.meta?.fingerprint ?? '';
    if (!fingerprint) break;
  }
  return transfers;
}

async function recordConfirmedTransfer(input: {
  walletId: string;
  userId: string;
  walletAddress: string;
  transaction: Trc20Transfer;
  contractAddress: string;
}) {
  const txid = input.transaction.transaction_id ?? '';
  const amountRaw = input.transaction.value ?? '';
  if (!/^[a-fA-F0-9]{64}$/.test(txid) || !/^\d+$/.test(amountRaw) ||
    input.transaction.to?.toLowerCase() !== input.walletAddress.toLowerCase() ||
    input.transaction.token_info?.decimals !== USDT_DECIMALS ||
    input.transaction.token_info.address?.toLowerCase() !== input.contractAddress.toLowerCase()) return;
  const settings = await getSubscriptionSettings();
  if (!settings.enabled || settings.amountUsdt <= 0) return;
  const expectedAmount = usdtAmountToRaw(settings.amountUsdt);
  const sql = getNeonSql();
  const inserted = await sql`INSERT INTO subscription_payments
    (user_id, wallet_id, deposit_txid, amount_raw, expected_amount_raw, token_contract, duration_days)
    VALUES (${input.userId}::uuid, ${input.walletId}::bigint, ${txid}, ${amountRaw}::numeric,
      ${expectedAmount.toString()}::numeric, ${input.contractAddress}, ${settings.durationDays})
    ON CONFLICT (deposit_txid) DO NOTHING
    RETURNING id::text AS id` as Record<string, unknown>[];
  await sql`WITH activated AS (
      UPDATE subscription_payments SET status = 'successful',
        sweep_status = 'queued', updated_at = now()
      WHERE deposit_txid = ${txid} AND status = 'pending'
        AND amount_raw >= expected_amount_raw
      RETURNING user_id, duration_days
    )
    INSERT INTO user_subscriptions (user_id, expires_at)
    SELECT user_id, now() + make_interval(days => duration_days)
    FROM activated
    ON CONFLICT (user_id) DO UPDATE SET
      expires_at = GREATEST(user_subscriptions.expires_at, now())
        + (EXCLUDED.expires_at - now()),
      updated_at = now()`;
  return Boolean(inserted[0]);
}

async function updateSweepReceipt(paymentId: string, txid: string) {
  const response = await fetch(`${TRON_NILE_URL}/wallet/gettransactioninfobyid`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.TRON_GRID_API_KEY ? { 'TRON-PRO-API-KEY': process.env.TRON_GRID_API_KEY } : {}),
    },
    body: JSON.stringify({ value: txid }),
    cache: 'no-store',
    signal: AbortSignal.timeout(TRON_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`TRON Nile sweep receipt lookup failed with status ${response.status}.`);
  const receipt = await response.json() as { id?: string; receipt?: { result?: string } };
  if (receipt.receipt?.result === 'SUCCESS') {
    await getNeonSql()`UPDATE subscription_payments SET sweep_status = 'swept', updated_at = now()
      WHERE id = ${paymentId}::bigint AND sweep_txid = ${txid}`;
  } else if (receipt.receipt?.result) {
    await getNeonSql()`UPDATE subscription_payments SET sweep_status = 'failed', updated_at = now()
      WHERE id = ${paymentId}::bigint AND sweep_txid = ${txid}`;
  }
}

async function sweepSuccessfulDeposits(treasuryAddress: string, contractAddress: string) {
  let sweepsStarted = 0;
  const sql = getNeonSql();
  const submitted = await sql`SELECT id::text AS id, sweep_txid AS "sweepTxid"
    FROM subscription_payments WHERE status = 'successful' AND sweep_status = 'submitted'
      AND sweep_txid IS NOT NULL ORDER BY received_at LIMIT 20` as Record<string, unknown>[];
  await Promise.all(submitted.map(async (payment) => {
    try {
      await updateSweepReceipt(String(payment.id), String(payment.sweepTxid));
    } catch (error) {
      console.error('Subscription sweep receipt check failed:', error instanceof Error ? error.message : 'Unknown error');
    }
  }));

  await sql`UPDATE subscription_payments SET sweep_status = 'failed', updated_at = now()
    WHERE status = 'successful' AND sweep_status = 'sweeping'
      AND sweep_started_at < now() - interval '15 minutes'`;
  const pending = await sql`SELECT p.id::text AS id, p.deposit_txid AS "depositTxid",
    p.amount_raw::text AS "amountRaw", wallet.id::text AS "walletId",
    wallet.encrypted_private_key AS "encryptedPrivateKey"
    FROM subscription_payments p JOIN subscription_wallets wallet ON wallet.id = p.wallet_id
    WHERE p.status = 'successful' AND p.sweep_status IN ('queued', 'fee_required')
    ORDER BY p.received_at LIMIT 20` as Record<string, unknown>[];
  await Promise.all(pending.map(async (payment) => {
    const claimed = await sql`UPDATE subscription_payments SET sweep_status = 'sweeping',
      sweep_started_at = now(), updated_at = now()
      WHERE id = ${String(payment.id)}::bigint
        AND status = 'successful'
        AND sweep_status IN ('queued', 'fee_required')
      RETURNING id::text AS id` as Record<string, unknown>[];
    if (!claimed[0]) return;
    try {
      const privateKey = decryptPrivateKey(String(payment.encryptedPrivateKey));
      const web = tronWeb();
      const contract = await web.contract(USDT_ABI, contractAddress);
      const sweepTxid = await contract.transfer(treasuryAddress, BigInt(String(payment.amountRaw)))
        .send({ feeLimit: TREASURY_FEE_LIMIT, shouldPollResponse: false }, privateKey);
      if (!/^[a-fA-F0-9]{64}$/.test(sweepTxid)) throw new Error('TRON Nile did not return a valid sweep transaction ID.');
      await sql`UPDATE subscription_payments SET sweep_status = 'submitted',
        sweep_txid = ${sweepTxid}, updated_at = now()
        WHERE id = ${String(payment.id)}::bigint AND sweep_status = 'sweeping'`;
      sweepsStarted += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown transfer failure';
      const requiresFee = /bandwidth|energy|fee|balance|insufficient|resource/i.test(message);
      console.error('Subscription treasury sweep failed:', message);
      await sql`UPDATE subscription_payments SET sweep_status = ${requiresFee ? 'fee_required' : 'failed'},
        updated_at = now() WHERE id = ${String(payment.id)}::bigint AND sweep_status = 'sweeping'`;
    }
  }));
  return sweepsStarted;
}

export async function synchronizeSubscriptionPayments(maxWallets = MAX_WALLETS_PER_SCAN) {
  await ensureDatabaseSchema();
  const settings = await getSubscriptionSettings();
  if (!settings.enabled) return { scannedWallets: 0, detectedTransfers: 0, sweepsStarted: 0, scanErrors: 0 };
  const contractAddress = await verifyUsdtContract();
  const treasury = await getNeonSql()`SELECT address FROM subscription_wallets
    WHERE wallet_type = 'treasury' LIMIT 1` as Record<string, unknown>[];
  if (!treasury[0]) throw new Error('Create the subscription treasury wallet in Admin → Settings before monitoring deposits.');

  const sql = getNeonSql();
  const wallets = await sql`SELECT id::text AS id, user_id::text AS "userId", address
    FROM subscription_wallets WHERE wallet_type = 'user'
    ORDER BY last_checked_at NULLS FIRST, created_at LIMIT ${Math.max(1, Math.min(maxWallets, 50))}` as Record<string, unknown>[];
  let detectedTransfers = 0;
  let scanErrors = 0;
  await Promise.all(wallets.map(async (wallet) => {
    try {
      const transfers = await readTrc20Transfers(String(wallet.address), contractAddress);
      for (const transfer of transfers) {
        if (transfer.to?.toLowerCase() !== String(wallet.address).toLowerCase()) continue;
        const recorded = await recordConfirmedTransfer({
          walletId: String(wallet.id),
          userId: String(wallet.userId),
          walletAddress: String(wallet.address),
          transaction: transfer,
          contractAddress,
        });
        if (recorded) detectedTransfers += 1;
      }
      await sql`UPDATE subscription_wallets SET last_checked_at = now()
        WHERE id = ${String(wallet.id)}::bigint`;
    } catch (error) {
      scanErrors += 1;
      console.error(`Subscription wallet scan failed for ${String(wallet.id)}:`, error instanceof Error ? error.message : 'Unknown error');
      await sql`UPDATE subscription_wallets SET last_checked_at = now()
        WHERE id = ${String(wallet.id)}::bigint`;
    }
  }));
  const sweepsStarted = await sweepSuccessfulDeposits(String(treasury[0].address), contractAddress);
  return { scannedWallets: wallets.length, detectedTransfers, sweepsStarted, scanErrors };
}

export async function getUserSubscriptionSnapshot(userId: string) {
  const settings = await getSubscriptionSettings();
  const sql = getNeonSql();
  const subscriptionRows = await sql`SELECT expires_at::text AS "expiresAt"
    FROM user_subscriptions WHERE user_id = ${userId}::uuid LIMIT 1` as Record<string, unknown>[];
  const expiresAt = subscriptionRows[0]?.expiresAt ? String(subscriptionRows[0].expiresAt) : null;
  const active = Boolean(expiresAt && Date.parse(expiresAt) > Date.now());
  const payments = await sql`SELECT deposit_txid AS "depositTxid", amount_raw::text AS "amountRaw",
    status, sweep_status AS "sweepStatus", sweep_txid AS "sweepTxid",
    received_at::text AS "receivedAt"
    FROM subscription_payments WHERE user_id = ${userId}::uuid
    ORDER BY received_at DESC LIMIT 20` as Record<string, unknown>[];
  let wallet: { address: string } | null = null;
  if (settings.enabled && settings.amountUsdt > 0) {
    getUsdtContractAddress();
    wallet = await ensureUserDepositWallet(userId);
  }
  return {
    settings: {
      enabled: settings.enabled,
      configured: settings.amountUsdt > 0 && Number.isInteger(settings.durationDays) && settings.durationDays > 0,
      amountUsdt: settings.amountUsdt,
      durationDays: settings.durationDays,
      network: 'TRON Nile testnet',
      tokenContractConfigured: isUsdtContractConfigured(),
    },
    subscription: { active, expiresAt },
    depositAddress: wallet?.address ?? null,
    payments: payments.map((row) => ({
      depositTxid: String(row.depositTxid),
      amountUsdt: formatUsdtRaw(String(row.amountRaw)),
      status: String(row.status),
      sweepStatus: String(row.sweepStatus),
      sweepTxid: row.sweepTxid ? String(row.sweepTxid) : null,
      receivedAt: String(row.receivedAt),
    })),
  };
}

export function getDecryptedWalletKeyForServerOnly(encryptedPrivateKey: string): string {
  return decryptPrivateKey(encryptedPrivateKey);
}
