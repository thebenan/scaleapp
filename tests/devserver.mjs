// Static files plus a working /api, using the same api/core.mjs the deployed
// function uses. Backed by an in-memory store, so `netlify dev` (and therefore
// npm) is not needed to develop or test against a real server.
//
//   node tests/devserver.mjs [port]
//
// Data lives only in memory and is gone when the process exits — that is the
// point: every test run starts from a clean store.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createApi, parseTokens } from "../api/core.mjs";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const PORT = Number(process.argv[2] || process.env.PORT || 8766);

// Overridable so a test can set up its own people.
const AUTH_TOKENS = process.env.AUTH_TOKENS
  || JSON.stringify({ tester: "test-passphrase", other: "other-passphrase" });
const ADMIN_USER = process.env.ADMIN_USER || "tester";

const memory = new Map();
const blobs = {
  async get(key) {
    const raw = memory.get(key);
    return raw === undefined ? null : JSON.parse(raw);
  },
  async set(key, value) { memory.set(key, JSON.stringify(value)); },
  async del(key) { memory.delete(key); },
  async list(prefix) { return [...memory.keys()].filter(k => k.startsWith(prefix)); }
};

const api = createApi({
  blobs,
  tokens: parseTokens(AUTH_TOKENS),
  adminUser: ADMIN_USER
});

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function readBody(req) {
  return new Promise(resolve => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : null); } catch { resolve(null); }
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Test-only. Lives here rather than in api/core.mjs so it cannot possibly
  // reach production: one server serves every case, and without a reset the
  // cases would pollute each other and become order-dependent.
  if (url.pathname === "/api/__reset" && req.method === "POST") {
    memory.clear();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ reset: true }));
    return;
  }

  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    const body = req.method === "PUT" || req.method === "POST" ? await readBody(req) : null;
    const result = await api({
      method: req.method,
      path: url.pathname.replace(/^\/api\/?/, ""),
      authorization: req.headers.authorization,
      body
    });
    res.writeHead(result.status, { "content-type": "application/json" });
    res.end(JSON.stringify(result.body));
    return;
  }

  // Static. resolve() then a prefix check keeps ../ traversal out.
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = resolve(join(ROOT, requested));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME[extname(filePath)] || "application/octet-stream",
      // Never cache during development; the deployed site sets its own headers.
      "cache-control": "no-store"
    });
    res.end(content);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`dev server on http://127.0.0.1:${PORT} (api backed by memory)`);
});
