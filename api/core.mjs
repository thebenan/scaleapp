// Transport- and storage-agnostic API logic.
//
// Deliberately imports nothing from Netlify, so the same code runs under the
// local dev server (tests/devserver.mjs) with an in-memory store and is testable
// in plain Node. Swapping to another host means rewriting the thin adapter in
// netlify/functions/api.mjs, not this file.

import { createHash, timingSafeEqual } from "node:crypto";

// --- identity ---

// AUTH_TOKENS is {"person": "their-secret", ...}. Inverted to secret -> person.
export function parseTokens(raw) {
  const map = new Map();
  if (!raw) return map;
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    console.error("AUTH_TOKENS is not valid JSON — nobody will be able to sign in");
    return map;
  }
  for (const [person, secret] of Object.entries(obj)) {
    if (typeof secret === "string" && secret.length >= 8) {
      map.set(secret, person);
    } else {
      console.error(`AUTH_TOKENS: ignoring "${person}" — secret must be a string of 8+ chars`);
    }
  }
  return map;
}

const sha256 = value => createHash("sha256").update(String(value)).digest();

// Hashing first guarantees equal-length buffers, which timingSafeEqual requires,
// and every entry is compared so the work does not reveal which token matched.
export function identify(tokens, authorization) {
  const presented = /^Bearer (.+)$/.exec(authorization || "")?.[1];
  if (!presented) return null;
  const given = sha256(presented);
  let found = null;
  for (const [secret, person] of tokens) {
    if (timingSafeEqual(given, sha256(secret))) found = person;
  }
  return found;
}

// --- validation ---

// Client JSON is never stored verbatim. Everything is rebuilt from a whitelist
// with length caps, so a malicious or buggy client cannot stuff unbounded data
// into the store or smuggle extra fields past the schema.
const MAX_NAME = 200;
const MAX_UNIT = 50;
const MAX_INGREDIENTS = 200;

class BadRequest extends Error {}

function str(value, max, field) {
  if (typeof value !== "string") throw new BadRequest(`${field} must be a string`);
  if (value.length > max) throw new BadRequest(`${field} must be at most ${max} characters`);
  return value;
}

export function sanitizeRecipe(input) {
  if (!input || typeof input !== "object") throw new BadRequest("body must be an object");

  const name = str(input.name ?? "", MAX_NAME, "name").trim();
  if (!name) throw new BadRequest("name is required");

  const servings = Number(input.servings);
  if (!Number.isFinite(servings) || servings <= 0) {
    throw new BadRequest("servings must be a positive number");
  }

  const rawIngredients = Array.isArray(input.ingredients) ? input.ingredients : [];
  if (rawIngredients.length > MAX_INGREDIENTS) {
    throw new BadRequest(`at most ${MAX_INGREDIENTS} ingredients`);
  }

  const ingredients = rawIngredients.map((ing, i) => {
    if (!ing || typeof ing !== "object") throw new BadRequest(`ingredient ${i} must be an object`);
    const amount = ing.amount === null || ing.amount === undefined ? null : Number(ing.amount);
    if (amount !== null && !Number.isFinite(amount)) {
      throw new BadRequest(`ingredient ${i} amount must be a number or null`);
    }
    return {
      id: str(ing.id ?? "", 64, `ingredient ${i} id`) || null,
      name: str(ing.name ?? "", MAX_NAME, `ingredient ${i} name`),
      amount,
      unit: str(ing.unit ?? "", MAX_UNIT, `ingredient ${i} unit`)
    };
  });

  const updatedAt = Number(input.updatedAt);
  const deletedAt = input.deletedAt === null || input.deletedAt === undefined
    ? null
    : Number(input.deletedAt);

  return {
    id: str(input.id ?? "", 64, "id"),
    name,
    servings,
    ingredients,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    deletedAt: Number.isFinite(deletedAt) ? deletedAt : null
  };
}

// --- api ---

const json = (status, body, headers) => ({ status, body, headers });

const privKey = (person, id) => `priv/${person}/${id}`;
const pubKey = id => `pub/${id}`;

/**
 * blobs adapter: { get(key), set(key, value), del(key), list(prefix) }
 * tokens: Map of secret -> person, from parseTokens
 * adminUser: person allowed to delete anyone's published recipe, or null
 */
export function createApi({ blobs, tokens, adminUser = null, now = () => Date.now() }) {
  async function listPrivate(person) {
    const keys = await blobs.list(`priv/${person}/`);
    const found = await Promise.all(keys.map(k => blobs.get(k)));
    return found.filter(Boolean);
  }

  async function listPublic() {
    const keys = await blobs.list("pub/");
    const found = await Promise.all(keys.map(k => blobs.get(k)));
    return found.filter(Boolean);
  }

  return async function handle({ method, path, authorization, body }) {
    // "recipes/abc" -> ["recipes", "abc"]
    const [resource, ...rest] = String(path || "").replace(/^\/+|\/+$/g, "").split("/");
    const id = rest.join("/");

    // The public list is the only unauthenticated route: anyone who opens the
    // site can read published recipes without a passphrase.
    if (resource === "public" && method === "GET" && !id) {
      const all = await listPublic();
      return json(200, { recipes: all }, {
        // Let the CDN absorb bot traffic rather than spending a function
        // invocation on every hit.
        "cache-control": "public, max-age=30",
        "netlify-cdn-cache-control": "public, max-age=30, stale-while-revalidate=300"
      });
    }

    const person = identify(tokens, authorization);
    if (!person) return json(401, { error: "unauthorized" });
    const isAdmin = adminUser !== null && person === adminUser;

    try {
      if (resource === "whoami" && method === "GET") {
        return json(200, { person, admin: isAdmin });
      }

      // --- private cookbook ---
      if (resource === "recipes") {
        if (method === "GET" && !id) {
          return json(200, { recipes: await listPrivate(person) });
        }

        // Deletes are tombstones, which are just updates — so upsert is the only
        // write this resource needs.
        if (method === "PUT" && id) {
          const incoming = sanitizeRecipe(body);
          if (incoming.id !== id) return json(400, { error: "id in body must match the url" });

          const existing = await blobs.get(privKey(person, id));
          if (existing && existing.updatedAt > incoming.updatedAt) {
            // Someone else's device wrote something newer. Hand back the winner
            // so the client can adopt it instead of silently losing the edit.
            return json(409, { error: "stale", recipe: existing });
          }
          const saved = { ...incoming, owner: person, visibility: "private" };
          await blobs.set(privKey(person, id), saved);
          return json(200, { recipe: saved });
        }
      }

      // --- published copies ---
      if (resource === "public") {
        if (method === "PUT" && id) {
          const incoming = sanitizeRecipe(body);
          const existing = await blobs.get(pubKey(id));
          if (existing && existing.publishedBy !== person && !isAdmin) {
            return json(403, { error: "only the person who published this can change it" });
          }
          const saved = {
            ...incoming,
            id,
            visibility: "public",
            publishedBy: existing ? existing.publishedBy : person,
            sourceId: typeof body?.sourceId === "string" ? body.sourceId.slice(0, 64) : null,
            publishedAt: existing ? existing.publishedAt : now(),
            updatedAt: now(),
            deletedAt: null
          };
          await blobs.set(pubKey(id), saved);
          return json(200, { recipe: saved });
        }

        if (method === "DELETE" && id) {
          const existing = await blobs.get(pubKey(id));
          if (!existing) return json(404, { error: "not found" });
          if (existing.publishedBy !== person && !isAdmin) {
            return json(403, { error: "only the person who published this can remove it" });
          }
          // A hard delete: the publisher's private original is untouched, so
          // there is nothing to tombstone for later reconciliation.
          await blobs.del(pubKey(id));
          return json(200, { removed: id });
        }
      }

      return json(404, { error: "no such route" });
    } catch (err) {
      if (err instanceof BadRequest) return json(400, { error: err.message });
      console.error("api error:", err);
      return json(500, { error: "internal error" });
    }
  };
}
