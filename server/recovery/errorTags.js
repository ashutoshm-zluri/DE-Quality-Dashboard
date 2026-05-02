import storage from "../dal/storage.js";

/**
 * Error-tag rules live in shared/error_tags.json. We translate each rule's
 * `match` string into a JS RegExp with the `i` (case-insensitive) and `s`
 * (dotall) flags — same semantics as the Python tagger's IGNORECASE | DOTALL.
 */

export async function loadTagger() {
  const doc = (await storage.getJson("shared/error_tags.json")) ?? {};
  const rules = [];
  for (const r of doc.rules ?? []) {
    const tag = (r?.tag ?? "").trim();
    const match = r?.match;
    if (!tag || !match) continue;
    try {
      rules.push({
        tag,
        pattern: new RegExp(match, "is"),
        color: r?.color ?? "neutral",
      });
    } catch {
      // bad regex in user config — skip, don't crash discover
    }
  }
  return new ErrorTagger(rules);
}

export class ErrorTagger {
  constructor(rules) {
    this.rules = rules;
  }

  tag(errorReason) {
    if (!errorReason) return ["unknown"];
    const out = [];
    for (const r of this.rules) {
      if (r.pattern.test(errorReason)) out.push(r.tag);
    }
    return out.length ? out : ["other"];
  }
}
