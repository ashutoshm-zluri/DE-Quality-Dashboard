/**
 * RCA document store. Backend-agnostic — every read/write goes through
 * storage.js so flipping STORAGE_BACKEND between local and s3 is invisible.
 *
 * Logical layout:
 *   shared/rca/index.json            metadata (one entry per doc)
 *   shared/rca/files/<id>.{md,txt}   actual content
 */

import storage from "./storage.js";

const INDEX_KEY = "shared/rca/index.json";
const FILES_PREFIX = "shared/rca/files";

const MAX_BYTES = 5 * 1024 * 1024;
const SUPPORTED_FORMATS = new Set(["md", "txt"]);

function fileKey(id, format) {
  return `${FILES_PREFIX}/${id}.${format}`;
}

function newId(prefix = "rca") {
  return `${prefix}_${Math.random().toString(16).slice(2, 12).padEnd(10, "0")}`;
}

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

async function readIndex() {
  const doc = await storage.getJson(INDEX_KEY);
  return Array.isArray(doc?.items) ? doc.items : [];
}

async function writeIndex(items) {
  await storage.putJsonAtomic(INDEX_KEY, { items });
}

function detectFormat(filename) {
  const ext = (filename ?? "").toLowerCase().split(".").pop();
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "txt" || ext === "text") return "txt";
  return null;
}

function sanitize(s, maxLen = 200) {
  if (typeof s !== "string") return "";
  return s.trim().slice(0, maxLen);
}

function deriveName(filename) {
  if (!filename) return "Untitled RCA";
  const base = filename.split("/").pop() ?? filename;
  return base.replace(/\.(md|markdown|txt|text)$/i, "");
}

export const rca = {
  async list() {
    const items = await readIndex();
    return [...items].sort((a, b) =>
      (b.updated_at ?? "").localeCompare(a.updated_at ?? "")
    );
  },

  async get(id, { withContent = true } = {}) {
    const items = await readIndex();
    const doc = items.find((d) => d.id === id);
    if (!doc) throw httpErr(404, "RCA doc not found");
    if (!withContent) return doc;
    const content = (await storage.getText(fileKey(doc.id, doc.format))) ?? "";
    return { ...doc, content };
  },

  async create({ name, filename, content, owner, reviewer, tags }) {
    const safeContent = typeof content === "string" ? content : "";
    if (Buffer.byteLength(safeContent, "utf8") > MAX_BYTES) {
      throw httpErr(413, `RCA content exceeds ${MAX_BYTES} bytes`);
    }
    const format = detectFormat(filename) ?? "md";
    if (!SUPPORTED_FORMATS.has(format)) {
      throw httpErr(400, `Unsupported format. Use .md or .txt`);
    }

    const finalName = sanitize(name) || deriveName(filename);
    if (!finalName) throw httpErr(400, "Name is required");

    const id = newId();
    const now = new Date().toISOString();
    const doc = {
      id,
      name: finalName,
      format,
      owner: sanitize(owner),
      reviewer: sanitize(reviewer),
      tags: Array.isArray(tags)
        ? Array.from(new Set(tags.map((t) => sanitize(t, 40)).filter(Boolean)))
        : [],
      size_bytes: Buffer.byteLength(safeContent, "utf8"),
      created_at: now,
      updated_at: now,
    };

    await storage.putText(fileKey(id, format), safeContent, {
      contentType: format === "md" ? "text/markdown" : "text/plain",
    });

    const items = await readIndex();
    await writeIndex([...items, doc]);
    return doc;
  },

  async update(id, patch) {
    const items = await readIndex();
    const idx = items.findIndex((d) => d.id === id);
    if (idx < 0) throw httpErr(404, "RCA doc not found");
    const cur = items[idx];

    const next = { ...cur };
    if (patch.name !== undefined) next.name = sanitize(patch.name) || cur.name;
    if (patch.owner !== undefined) next.owner = sanitize(patch.owner);
    if (patch.reviewer !== undefined) next.reviewer = sanitize(patch.reviewer);
    if (Array.isArray(patch.tags)) {
      next.tags = Array.from(
        new Set(patch.tags.map((t) => sanitize(t, 40)).filter(Boolean))
      );
    }

    if (typeof patch.content === "string") {
      if (Buffer.byteLength(patch.content, "utf8") > MAX_BYTES) {
        throw httpErr(413, `RCA content exceeds ${MAX_BYTES} bytes`);
      }
      let nextFormat = cur.format;
      if (patch.filename) {
        const det = detectFormat(patch.filename);
        if (!det) throw httpErr(400, "Unsupported format. Use .md or .txt");
        nextFormat = det;
        if (det !== cur.format) {
          await storage.removeKey(fileKey(cur.id, cur.format));
        }
      }
      next.format = nextFormat;
      next.size_bytes = Buffer.byteLength(patch.content, "utf8");
      await storage.putText(fileKey(cur.id, nextFormat), patch.content, {
        contentType: nextFormat === "md" ? "text/markdown" : "text/plain",
      });
    }

    next.updated_at = new Date().toISOString();
    const updated = [...items];
    updated[idx] = next;
    await writeIndex(updated);
    return next;
  },

  async remove(id) {
    const items = await readIndex();
    const cur = items.find((d) => d.id === id);
    if (!cur) throw httpErr(404, "RCA doc not found");
    await storage.removeKey(fileKey(cur.id, cur.format));
    await writeIndex(items.filter((d) => d.id !== id));
    return { ok: true };
  },
};
