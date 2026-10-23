# G-squad

Mobile-first trading workspace for a user's application account and Deriv account. Application registration, sessions, trading configuration, and Deriv OAuth credentials are stored in Neon Postgres.

## Requirements

- Node.js 20 or later
- A Neon Postgres database
- A Deriv registered application ID and redirect URI

## Configure

Create `.env.local` with the server-only Neon connection string, encryption key, and Deriv application settings:

```env
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
# Generate with: openssl rand -base64 32
DERIV_TOKEN_ENCRYPTION_KEY=

NEXT_PUBLIC_DERIV_APP_ID=your-registered-app-id
NEXT_PUBLIC_DERIV_REDIRECT_URI=http://localhost:3000
NEXT_PUBLIC_DERIV_APP_NAME=G-squad
NEXT_PUBLIC_DERIV_OAUTH_SCOPES=trade
NEXT_PUBLIC_DERIV_ENV=production
```

Generate a key with `openssl rand -base64 32`, then set its output as `DERIV_TOKEN_ENCRYPTION_KEY` in `.env.local` and in the server environment for production. Keep the same key across deployments and restarts; changing it makes previously encrypted Deriv credentials unreadable. Never use a `NEXT_PUBLIC_` prefix for database credentials, the encryption key, or Deriv tokens. Do not commit `.env.local` or production secrets. The database role needs permission to create tables and indexes and to read/write application data.

The app creates its Postgres tables and indexes automatically when first used:

- `app_users`
- `app_sessions`
- `deriv_oauth_flows`

Application passwords are stored as scrypt hashes. Login sessions use random opaque tokens stored only as SHA-256 hashes in Postgres and sent to the browser in HTTP-only, SameSite cookies. Deriv access and refresh tokens are AES-GCM encrypted in Postgres and are never written to browser storage.

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

The dashboard can run automated trades using the fixed Volatility 100 (1s) Index market. It allows only one bot-managed open contract at a time. The bot runs in the open dashboard tab and stops if the tab closes, the account changes, a configured risk limit is reached, or order processing fails. Demo and real Deriv accounts are supported; starting the bot on a real account requires an explicit confirmation and places trades with real funds. This is not a persistent server-side worker; do not rely on a browser tab for unattended trading. Automated trading can lose money and does not guarantee profit.

The requested logo is served from `public/logo.png` and is used by the app header and favicon.
