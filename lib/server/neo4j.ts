import 'server-only';
import neo4j, { type Driver } from 'neo4j-driver';

declare global {
  var neo4jDriver: Driver | undefined;
  var neo4jAuthConstraints: Promise<void> | undefined;
}

export function getNeo4jDriver(): Driver {
  if (globalThis.neo4jDriver) return globalThis.neo4jDriver;

  const uri = process.env.NEO4J_URI;
  const username = process.env.NEO4J_USERNAME;
  const password = process.env.NEO4J_PASSWORD;
  if (!uri || !username || !password) {
    throw new Error('Neo4j is not configured. Set NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD.');
  }

  globalThis.neo4jDriver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  return globalThis.neo4jDriver;
}

export async function ensureAuthConstraints(): Promise<void> {
  if (globalThis.neo4jAuthConstraints) return globalThis.neo4jAuthConstraints;

  globalThis.neo4jAuthConstraints = (async () => {
    const session = getNeo4jDriver().session({ database: process.env.NEO4J_DATABASE });
    try {
      await session.run(
        'CREATE CONSTRAINT app_user_email_unique IF NOT EXISTS FOR (u:AppUser) REQUIRE u.email IS UNIQUE'
      );
      await session.run(
        'CREATE CONSTRAINT app_user_account_id_unique IF NOT EXISTS FOR (u:AppUser) REQUIRE u.accountId IS UNIQUE'
      );
      await session.run(
        'CREATE CONSTRAINT app_session_token_hash_unique IF NOT EXISTS FOR (s:AppSession) REQUIRE s.tokenHash IS UNIQUE'
      );
    } catch (error) {
      globalThis.neo4jAuthConstraints = undefined;
      throw error;
    } finally {
      await session.close();
    }
  })();
  return globalThis.neo4jAuthConstraints;
}