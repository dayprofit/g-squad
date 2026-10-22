# G-squad

Mobile-first trading workspace for a user's application account and Deriv account. Application registration and sessions are stored in Neo4j; Deriv OAuth remains a separate authorization flow.

## Requirements

- Node.js 20 or later
- Neo4j 5.x or Neo4j Aura
- A Deriv registered application ID and redirect URI

## Configure

Create `.env.local` with server-only Neo4j credentials and the public Deriv application ID:

```env
NEO4J_URI=neo4j+s://your-instance.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=replace-with-a-secret
NEO4J_DATABASE=neo4j
DERIV_TOKEN_ENCRYPTION_KEY=generate-a-base64-encoded-32-byte-key

NEXT_PUBLIC_DERIV_APP_ID=your-registered-app-id
NEXT_PUBLIC_DERIV_REDIRECT_URI=http://localhost:3000
NEXT_PUBLIC_DERIV_APP_NAME=G-squad
NEXT_PUBLIC_DERIV_OAUTH_SCOPES=trade
NEXT_PUBLIC_DERIV_ENV=production
```

Generate the encryption key with `openssl rand -base64 32`. Never use a `NEXT_PUBLIC_` prefix for database credentials, the encryption key, or Deriv tokens. Do not commit `.env.local` or production secrets. The database account must be allowed to create uniqueness constraints and read/write application nodes.

The app creates these Neo4j uniqueness constraints on first registration:

- `AppUser.email`
- `AppUser.accountId`
- `AppSession.tokenHash`

Application passwords are stored as scrypt hashes. Login sessions use random opaque tokens stored only as SHA-256 hashes in Neo4j and sent to the browser in HTTP-only, SameSite cookies. Deriv access and refresh tokens are AES-GCM encrypted in Neo4j and are never written to browser storage.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Registration and app login require a reachable Neo4j instance. Deriv account connection requires a valid public app ID and matching registered redirect URI.

## Build and deploy

```bash
npm run build
npm start
```

This application now uses server route handlers for authentication and saved configuration. Deploy it to a Node.js-compatible Next.js host; a static export or static file host cannot run these routes.

## Trading automation status

The current app can display live Deriv account data and persist risk configuration, but it does not include a persistent, independently running trading worker. Start and Stop remain disabled. Do not enable real-money trading until a worker is deployed with server-side Deriv authorization, per-user trade isolation, contract monitoring, idempotency, and enforced session risk limits. The UI does not claim a worker is running and does not place automatic trades.

The requested logo is served from `public/logo.png` and is used by the app header and favicon.
