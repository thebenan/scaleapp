// Netlify entry point. Everything here is adapter: the logic lives in
// api/core.mjs so it can run under the local dev server and be tested without
// Netlify. Porting to another host means rewriting this file only.

import { getStore } from "@netlify/blobs";
import { createApi, parseTokens } from "../../api/core.mjs";

const blobs = {
  async get(key) {
    const store = getStore("recipes");
    return await store.get(key, { type: "json" });
  },
  async set(key, value) {
    const store = getStore("recipes");
    await store.setJSON(key, value);
  },
  async del(key) {
    const store = getStore("recipes");
    await store.delete(key);
  },
  async list(prefix) {
    const store = getStore("recipes");
    const { blobs: found } = await store.list({ prefix });
    return found.map(b => b.key);
  }
};

export default async (request) => {
  const api = createApi({
    blobs,
    // Parsed per request so rotating a passphrase in the Netlify UI takes effect
    // without a redeploy.
    tokens: parseTokens(process.env.AUTH_TOKENS),
    adminUser: process.env.ADMIN_USER || null
  });

  // Reached via the /api/* redirect in netlify.toml, so strip either shape.
  const path = new URL(request.url).pathname
    .replace(/^\/\.netlify\/functions\/api\/?/, "")
    .replace(/^\/api\/?/, "");

  let body = null;
  if (request.method === "PUT" || request.method === "POST") {
    body = await request.json().catch(() => null);
  }

  const result = await api({
    method: request.method,
    path,
    authorization: request.headers.get("authorization"),
    body
  });

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "content-type": "application/json", ...(result.headers || {}) }
  });
};
