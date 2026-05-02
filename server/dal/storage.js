import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  NoSuchKey,
} from "@aws-sdk/client-s3";

/**
 * Single low-level storage layer used by every DAL — both env-scoped data
 * (failures_latest.json under <env>/ui_data/...) and shared data
 * (labels.json under shared/...).
 *
 * Logical paths are POSIX strings, e.g.
 *   "shared/labels.json"
 *   "dev/ui_data/failures_latest.json"
 *   "prod/snapshots/<run>/<doc>.json"
 *
 * Two backends, switched via STORAGE_BACKEND env var:
 *   - "local"  → <FAILING_FLOWS_DIR>/<path>          (default in dev)
 *   - "s3"     → s3://<S3_BUCKET>/<S3_PREFIX><path>  (production)
 *
 * Both backends expose the same API:
 *   getJson(key)             → Object | null
 *   putJsonAtomic(key, data) → void          (atomic on both backends)
 *   listKeys(prefix)         → string[]      (logical paths under prefix)
 *   removeKey(key)           → void          (no-throw on 404)
 *   appendJsonl(key, line)   → void          (audit logs)
 */

// Accept either STORAGE_BACKEND or STORAGE (Python recovery package also
// reads STORAGE), and either "local" or "local-fs" as aliases.
const RAW_BACKEND = (
  process.env.STORAGE_BACKEND ??
  process.env.STORAGE ??
  "local"
).toLowerCase();
const BACKEND = RAW_BACKEND === "local-fs" ? "local" : RAW_BACKEND;

// ── LOCAL backend ──────────────────────────────────────────────────────────

function makeLocalBackend() {
  const baseDir = process.env.FAILING_FLOWS_DIR;
  if (!baseDir) {
    throw new Error("FAILING_FLOWS_DIR must be set when STORAGE_BACKEND=local");
  }

  const resolve = (key) => {
    if (key.startsWith("/") || key.includes("..")) {
      throw new Error(`unsafe key: ${key}`);
    }
    return path.join(baseDir, key);
  };

  return {
    name: "local",
    location: baseDir,

    async getJson(key) {
      try {
        const buf = await fs.readFile(resolve(key), "utf8");
        return JSON.parse(buf);
      } catch (err) {
        if (err.code === "ENOENT") return null;
        throw err;
      }
    },

    async putJsonAtomic(key, data) {
      const file = resolve(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
      await fs.rename(tmp, file);
    },

    async listKeys(prefix) {
      const root = resolve(prefix.replace(/\/+$/, ""));
      let entries;
      try {
        entries = await fs.readdir(root, { withFileTypes: true, recursive: true });
      } catch (err) {
        if (err.code === "ENOENT") return [];
        throw err;
      }
      const out = [];
      for (const ent of entries) {
        if (!ent.isFile()) continue;
        const fullPath = path.join(ent.parentPath ?? root, ent.name);
        out.push(path.relative(baseDir, fullPath).split(path.sep).join("/"));
      }
      return out.sort();
    },

    async removeKey(key) {
      try {
        await fs.unlink(resolve(key));
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
    },

    async appendJsonl(key, line) {
      const file = resolve(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, JSON.stringify(line) + "\n", "utf8");
    },

    async getText(key) {
      try {
        return await fs.readFile(resolve(key), "utf8");
      } catch (err) {
        if (err.code === "ENOENT") return null;
        throw err;
      }
    },

    async putText(key, body, { contentType = "text/plain" } = {}) {
      void contentType;
      const file = resolve(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, body, "utf8");
      await fs.rename(tmp, file);
    },
  };
}

// ── S3 backend ─────────────────────────────────────────────────────────────

function makeS3Backend() {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error("S3_BUCKET must be set when STORAGE_BACKEND=s3");
  }
  const region = process.env.S3_REGION ?? "us-east-1";
  const prefix = (process.env.S3_PREFIX ?? "").replace(/^\/+|\/+$/g, "");
  const client = new S3Client({ region });

  const fullKey = (key) => {
    if (key.startsWith("/") || key.includes("..")) {
      throw new Error(`unsafe key: ${key}`);
    }
    return prefix ? `${prefix}/${key}` : key;
  };
  const stripPrefix = (s3Key) =>
    prefix && s3Key.startsWith(prefix + "/")
      ? s3Key.slice(prefix.length + 1)
      : s3Key;

  async function streamToString(stream) {
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  return {
    name: "s3",
    location: `s3://${bucket}${prefix ? "/" + prefix : ""}`,

    async getJson(key) {
      try {
        const res = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: fullKey(key) })
        );
        const text = await streamToString(res.Body);
        return JSON.parse(text);
      } catch (err) {
        if (
          err instanceof NoSuchKey ||
          err?.$metadata?.httpStatusCode === 404 ||
          err?.name === "NoSuchKey" ||
          err?.Code === "NoSuchKey"
        ) {
          return null;
        }
        throw err;
      }
    },

    async putJsonAtomic(key, data) {
      // S3 PutObject is atomic per-object; readers either see the old version
      // or the new version, never partial. No tempfile dance needed.
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: fullKey(key),
          Body: JSON.stringify(data, null, 2),
          ContentType: "application/json",
        })
      );
    },

    async listKeys(prefixKey) {
      const fullPrefix = fullKey(
        prefixKey.endsWith("/") ? prefixKey : prefixKey + "/"
      );
      const out = [];
      let continuationToken;
      do {
        const res = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: fullPrefix,
            ContinuationToken: continuationToken,
          })
        );
        for (const c of res.Contents ?? []) {
          if (c.Key) out.push(stripPrefix(c.Key));
        }
        continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (continuationToken);
      return out.sort();
    },

    async removeKey(key) {
      try {
        await client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: fullKey(key) })
        );
      } catch (err) {
        // S3 delete returns 204 for missing keys; only re-throw on real errors.
        if (err?.$metadata?.httpStatusCode !== 404) throw err;
      }
    },

    async appendJsonl(key, line) {
      // S3 has no native append. Read-modify-write is fine for low-frequency
      // audit logs; for high-volume use Kinesis or Firehose. Here we accept
      // the race for simplicity.
      const existing = await this.getRaw(key);
      const next = (existing ?? "") + JSON.stringify(line) + "\n";
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: fullKey(key),
          Body: next,
          ContentType: "application/x-ndjson",
        })
      );
    },

    async getRaw(key) {
      try {
        const res = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: fullKey(key) })
        );
        return await streamToString(res.Body);
      } catch (err) {
        if (
          err instanceof NoSuchKey ||
          err?.$metadata?.httpStatusCode === 404
        ) {
          return null;
        }
        throw err;
      }
    },

    async getText(key) {
      return this.getRaw(key);
    },

    async putText(key, body, { contentType = "text/plain" } = {}) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: fullKey(key),
          Body: body,
          ContentType: contentType,
        })
      );
    },
  };
}

const storage = BACKEND === "s3" ? makeS3Backend() : makeLocalBackend();

console.log(`[storage] backend=${storage.name} location=${storage.location}`);

export default storage;
export const storageBackend = storage.name;
