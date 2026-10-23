# G-squad

Mobile-first trading workspace for a user's application account and Deriv account. Application registration, sessions, trading configuration, and Deriv OAuth credentials are stored in Neon Postgres.

## Requirements

- Node.js 20 or later
- A Neon Postgres database
- A Deriv registered application ID and redirect URI

## Configure

Create `.env.local` with the server-only Neon connection string, encryption key, and Deriv application settings:

```env
APP_BASE_URL=https://your-public-app.example
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
# Generate with: openssl rand -base64 32
DERIV_TOKEN_ENCRYPTION_KEY=
# Generate a separate key with: openssl rand -base64 32
ADMIN_MFA_ENCRYPTION_KEY=
# Comma-separated server-only admin email allowlist
ADMIN_EMAILS=admin@example.com

NEXT_PUBLIC_DERIV_APP_ID=your-registered-app-id
NEXT_PUBLIC_DERIV_REDIRECT_URI=http://localhost:3000
NEXT_PUBLIC_DERIV_APP_NAME=G-squad
NEXT_PUBLIC_DERIV_OAUTH_SCOPES=trade
NEXT_PUBLIC_DERIV_ENV=production
```

Generate a key with `openssl rand -base64 32`, then set its output as `DERIV_TOKEN_ENCRYPTION_KEY` in `.env.local` and in the server environment for production. Keep the same key across deployments and restarts; changing it makes previously encrypted Deriv credentials unreadable. Never use a `NEXT_PUBLIC_` prefix for database credentials, the encryption key, or Deriv tokens. Do not commit `.env.local` or production secrets. The database role needs permission to create tables and indexes and to read/write application data.

The app creates its Postgres tables and indexes automatically when first used. Core tables include:

- `app_users`
- `app_sessions`
- `deriv_oauth_flows`
- `app_user_activity`
- `admin_chats`
- `admin_chat_messages`
- `admin_chat_typing`

Application passwords are stored as scrypt hashes. Login sessions use random opaque tokens stored only as SHA-256 hashes in Postgres and sent to the browser in HTTP-only, SameSite cookies. Deriv access and refresh tokens are AES-GCM encrypted in Postgres and are never written to browser storage.

### Admin workspace

Set `ADMIN_EMAILS` to a comma-separated list of trusted existing account email addresses in the server environment. Create each trusted account before adding its email to the allowlist; public registration rejects allowlisted addresses. Emails are matched case-insensitively; never use a `NEXT_PUBLIC_` prefix. This list bootstraps Owner access. Sign in with an allowlisted account, then open `/admin`.

Set `APP_BASE_URL` to the app's trusted public HTTPS origin (use `http://localhost:3000` locally). It is used to build staff invitation and password reset URLs; links are never generated from the incoming Host header. Generate `ADMIN_MFA_ENCRYPTION_KEY` independently with `openssl rand -base64 32`, then set that output as a server-only environment variable in every deployment environment and redeploy. It encrypts TOTP authenticator secrets at rest. Admins must enroll in a standard TOTP authenticator app, and each enrollment provides single-use recovery codes. Keep the encryption key safe and unchanged across deployments; losing it prevents authenticator-secret decryption. If admin setup reports that this key is missing or invalid, verify the production environment variable contains the complete generated output without quotes or whitespace, then redeploy. Admin API requests require MFA, and sensitive changes additionally require password plus a fresh authenticator or backup code (five-minute reauthentication window). MFA and account login verification are rate-limited.

The Owner can invite a registered app account to one of three least-privilege roles: **Support** (read assigned accounts/activity, revoke app sessions, suspend users, and manage support cases); **Account manager** (create/update assigned users, change risk settings, and issue one-time reset links); and **Read-only** (view permitted accounts, activity, health, and aggregate analytics). Restoring suspended accounts requires Owner approval. Permissions are checked in server route handlers, not only hidden in the UI. Invitations are single-use, expire after seven days, and bind to the invited email. Since no email-delivery service is configured, copy the generated invitation URL and share it through a trusted channel. Owners are bootstrapped from the server-only `ADMIN_EMAILS` setting. This allowlist does not bypass MFA; keep Owner recovery codes protected and consider maintaining two trusted Owners.

The responsive admin workspace includes staff and role management, account search and pagination, audit filters and CSV export, saved activity views, account details, session revocation, scoped account assignments, support cases, internal user notes/flags, in-app staff notifications, service health, aggregate usage analytics, operational alerts, investor support chat, and bot configuration change history. Investor and staff chat messages, typing status, assignment, and open/resolved/closed state are stored in Neon. Support and account-management queues are scoped to their staff roles; Owners can see every chat. Authorized staff can transfer a conversation to a department queue or an eligible staff member/Owner. Chat refresh and typing indicators use short polling; incoming messages play an automatic sound when browser audio is available, after the first user interaction unlocks audio playback. High-impact staff role changes, administrator MFA resets, and account restorations use two-person Owner approval. Staff departures immediately lose admin access and sessions; Owners can track the remaining case handoff and final-review checklist. Owners can schedule recurring staff permission reviews and confirm, record changes, or revoke access.

Owners can set each non-Owner staff member's weekly work shifts in an IANA timezone and optional role start/end dates. Staff and managers are blocked from admin APIs outside their configured shift or role period; investor app access is unchanged, and Owners retain emergency access. Newly accepted staff have no active shifts until an Owner configures them. Explicit account assignments govern which user records staff can access; team and region labels are organizational metadata and do not independently grant access. Audit retention is configurable; cleanup is manual and Owner-triggered, and an unset period retains records indefinitely.

Trading configuration, the bot's session starting balance and win/loss counters, and settled bot-trade reports are persisted in Neon. Current Deriv balance and market ticks remain live Deriv data rather than cached Neon values. Settled bot-trade results are submitted by the signed-in user's browser and are not independently verified by Deriv on the server; totals therefore are not a complete or independently verified Deriv account statement. Admin totals are grouped by Demo/Real and currency without conversion. Admins can create app accounts with one-time password-setup links; passwords are never shown or directly set by an administrator. Reset links expire after one hour and work once. Keep at least two protected Owners where possible and store each Owner's recovery codes securely.

Passkeys, external SSO, email/SMS delivery, automated retention cleanup, and a full bulk-action preview/rollback workflow are not enabled. Invitation links must be shared over a trusted channel. Audit exports are limited to the latest 10,000 matching activity rows.

Audit entries record the actor, affected account, event, and safe before/after configuration values where applicable. Passwords, reset tokens, authenticator secrets, recovery codes, Deriv tokens, and trade controls are not exposed in the admin UI or audit details. Admins can see only whether a user has connected Deriv; they cannot read Deriv credentials, impersonate users, or place trades. Trading settings are risk configuration only, not a promise of results.

All administrator mutations show a transparent full-screen progress layer for at least two seconds and keep it visible while the server is still processing the action.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Registration, login, saved trading configuration, and Deriv account connection require a reachable Neon database. Deriv account connection also requires a valid public app ID and matching registered redirect URI.

## Build and deploy

```bash
npm run build
npm start
```

This application now uses server route handlers for authentication and saved configuration. Deploy it to a Node.js-compatible Next.js host; a static export or static file host cannot run these routes.

## Trading automation status

The dashboard can run automated trades using the fixed Volatility 100 (1s) Index market and 5-tick contracts. Signals require both a volatility breakout and momentum in the breakout direction. After a settled loss, the next stake is multiplied by 1.5; after a profitable trade it resets to the configured base stake. The bot allows only one bot-managed open contract at a time and stops if the account balance, configured loss budget, or another configured session limit cannot cover the next trade. It runs in the open dashboard tab and stops if the app closes, the connection fails, the account changes, or order processing fails. Demo and real Deriv accounts are supported; starting the bot on a real account requires explicit confirmation and places trades with real funds. This is not a persistent server-side worker and cannot continue trading while the user is offline or the app is closed. Automated trading can lose money and does not guarantee profit.

The requested logo is served from `public/logo.png` and is used by the app header and favicon.
