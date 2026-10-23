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
DERIV_TOKEN_ENCRYPTION_KEY=generate-a-base64-encoded-32-byte-key

NEXT_PUBLIC_DERIV_APP_ID=your-registered-app-id
NEXT_PUBLIC_DERIV_REDIRECT_URI=http://localhost:3000
NEXT_PUBLIC_DERIV_APP_NAME=G-squad
NEXT_PUBLIC_DERIV_OAUTH_SCOPES=trade
NEXT_PUBLIC_DERIV_ENV=production

OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:8b
```

Generate the encryption key with `openssl rand -base64 32`. Never use a `NEXT_PUBLIC_` prefix for database credentials, the encryption key, or Deriv tokens. Do not commit `.env.local` or production secrets. The database role needs permission to create tables and indexes and to read/write application data.

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

### Local AI trade approval

Install Ollama on the same host/container network as the Next.js server, then download the default model with `ollama pull qwen3:8b`. Set `OLLAMA_BASE_URL` to the Ollama server URL reachable **from the Next.js server** and `OLLAMA_MODEL` to an installed model. When the dashboard bot is running, its internal signal detector submits a candidate and recent live ticks to the authenticated server-side Ollama review. Only an `approve` response proceeds to a Deriv demo proposal and order; rejects are skipped, and unavailable, timed-out, or invalid responses stop the bot without placing an order. Ollama is not exposed as a user-facing strategy control. A deployed app cannot reach Ollama on a user's computer through `127.0.0.1`; host Ollama alongside the server or configure a private network endpoint.

## Build and deploy

```bash
npm run build
npm start
```

This application now uses server route handlers for authentication and saved configuration. Deploy it to a Node.js-compatible Next.js host; a static export or static file host cannot run these routes.

## Trading automation status

The dashboard can run an AI-reviewed bot using the currently selected Deriv demo account. The bot runs in the open dashboard tab and stops if the tab closes, the account changes, a configured risk limit is reached, or review/order processing fails. It cannot trade real accounts. This is not a persistent server-side worker; do not rely on a browser tab for unattended trading. Ollama decisions are fallible and do not guarantee profitable outcomes.

The requested logo is served from `public/logo.png` and is used by the app header and favicon.
