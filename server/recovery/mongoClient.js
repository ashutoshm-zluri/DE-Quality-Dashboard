import { MongoClient } from "mongodb";

/**
 * Lazy mongo client cache, keyed by env (dev | prod). One MongoClient per
 * env stays alive for the lifetime of the process — driver pools internally,
 * so per-request connect/disconnect would be wasteful.
 *
 * URIs come from MONGO_URI_DEV / MONGO_URI_PROD env vars.
 */

const clients = new Map();

function uriFor(env) {
  if (env === "dev") return process.env.MONGO_URI_DEV;
  if (env === "prod") return process.env.MONGO_URI_PROD;
  throw new Error(`unsupported env "${env}"`);
}

export async function getDb(env, dbName = "zluri") {
  let entry = clients.get(env);
  if (!entry) {
    const uri = uriFor(env);
    if (!uri) {
      throw new Error(
        `MONGO_URI_${env.toUpperCase()} is not set — discover for ${env} cannot run`
      );
    }
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10_000,
    });
    await client.connect();
    entry = { client, db: client.db(dbName) };
    clients.set(env, entry);
  }
  return entry.db;
}

export async function closeAll() {
  await Promise.all(
    [...clients.values()].map((e) => e.client.close().catch(() => {}))
  );
  clients.clear();
}
