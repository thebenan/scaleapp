// Cloud sync for one person's private cookbook, plus publishing copies to a
// public list that needs no passphrase to read.
//
// Design rule: the UI never waits on the network. localStorage stays the working
// copy, so reading and scaling behave identically online and off; writes land
// locally first and are replayed from an outbox when a connection exists.

import { store, migrate, newId } from "./storage.js";

const AUTH_KEY = "auth.passphrase";
const OUTBOX_KEY = "outbox";

function readOutbox() {
  try {
    const raw = JSON.parse(localStorage.getItem(OUTBOX_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeOutbox(ids) {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify([...new Set(ids)]));
}

export const sync = {
  person: null,
  admin: false,
  // Set when the last network attempt failed, so the UI can say "not synced"
  // without guessing.
  offline: false,

  passphrase() {
    return localStorage.getItem(AUTH_KEY);
  },

  signedIn() {
    return !!this.passphrase() && !!this.person;
  },

  pending() {
    return readOutbox();
  },

  markPending(id) {
    writeOutbox([...readOutbox(), id]);
  },

  clearPending(id) {
    writeOutbox(readOutbox().filter(x => x !== id));
  },

  async request(method, path, body) {
    const headers = {};
    const secret = this.passphrase();
    if (secret) headers.authorization = `Bearer ${secret}`;
    if (body !== undefined) headers["content-type"] = "application/json";

    const res = await fetch(`/api/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    let payload = null;
    try { payload = await res.json(); } catch { /* empty body is fine */ }

    // 409 is expected and carries the winning record; callers handle it.
    if (!res.ok && res.status !== 409) {
      const err = new Error(payload?.error || `request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return { status: res.status, body: payload };
  },

  // --- identity ---

  async signIn(passphrase) {
    localStorage.setItem(AUTH_KEY, passphrase);
    try {
      const { body } = await this.request("GET", "whoami");
      this.person = body.person;
      this.admin = !!body.admin;
      return body;
    } catch (err) {
      // Never keep a passphrase the server rejected — it would 401 on every
      // subsequent call and look like an outage.
      if (err.status === 401) localStorage.removeItem(AUTH_KEY);
      this.person = null;
      this.admin = false;
      throw err;
    }
  },

  signOut() {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(OUTBOX_KEY);
    this.person = null;
    this.admin = false;
  },

  // Resume a session on load without prompting.
  async resume() {
    if (!this.passphrase()) return false;
    try {
      await this.signIn(this.passphrase());
      return true;
    } catch (err) {
      if (err.status !== 401) this.offline = true;
      return false;
    }
  },

  // --- private cookbook ---

  async pull() {
    const { body } = await this.request("GET", "recipes");
    // A misdeployed function can answer 200 with something that is not our
    // payload. Treating that as "the server has nothing" would look like a
    // successful empty sync, so refuse it instead.
    if (!body || !Array.isArray(body.recipes)) {
      throw new Error("unexpected response from the server");
    }
    const incoming = migrate({ recipes: body.recipes });

    // A recipe missing from the server means "never uploaded", never "deleted" —
    // deletes come back as tombstones. That distinction is the whole reason
    // tombstones exist, and it is what stops a first sync wiping local data.
    const result = store.merge(incoming);

    // merge() has already adopted anything the server had newer, so whatever is
    // still locally newer (or absent upstream) is ours to push.
    const remote = new Map(incoming.map(r => [r.id, r]));
    store.recipes.forEach(r => {
      const theirs = remote.get(r.id);
      if (!theirs || r.updatedAt > theirs.updatedAt) this.markPending(r.id);
    });

    store.save();
    this.offline = false;
    return result;
  },

  async push(id) {
    const recipe = store.findAny(id);
    if (!recipe) {
      this.clearPending(id);
      return { ok: true };
    }

    const { status, body } = await this.request("PUT", `recipes/${id}`, recipe);
    if (status === 409) {
      // Another device wrote something newer while we were away. Adopt it rather
      // than clobbering it, and tell the caller so the user can be informed.
      store.merge(migrate({ recipes: [body.recipe] }));
      store.save();
      this.clearPending(id);
      return { ok: true, superseded: true, recipe: body.recipe };
    }
    this.clearPending(id);
    return { ok: true };
  },

  async flush() {
    if (!this.signedIn()) return { pushed: 0, failed: 0, superseded: 0 };
    let pushed = 0, failed = 0, superseded = 0;
    for (const id of this.pending()) {
      try {
        const res = await this.push(id);
        if (res.superseded) superseded++; else pushed++;
      } catch (err) {
        // Left in the outbox deliberately — the next load or `online` event
        // retries it. Losing the edit would be worse than retrying forever.
        this.offline = err.status === undefined;
        failed++;
      }
    }
    return { pushed, failed, superseded };
  },

  // Local write, then best-effort upload. Never blocks the UI.
  async record(id) {
    this.markPending(id);
    if (!this.signedIn()) return;
    try {
      return await this.push(id);
    } catch (err) {
      this.offline = err.status === undefined;
    }
  },

  // --- publishing ---

  async listPublic() {
    const { body } = await this.request("GET", "public");
    return body.recipes || [];
  },

  // Copies rather than moves: the private original keeps its own id and stays
  // private, and holds the publicId so it can be updated or withdrawn later.
  async publish(recipe) {
    const publicId = recipe.publishedAs || newId();
    await this.request("PUT", `public/${publicId}`, {
      ...recipe,
      id: publicId,
      sourceId: recipe.id
    });
    store.update(recipe.id, { publishedAs: publicId });
    store.save();
    await this.record(recipe.id);
    return publicId;
  },

  async unpublish(recipe) {
    if (!recipe.publishedAs) return;
    await this.request("DELETE", `public/${recipe.publishedAs}`);
    store.update(recipe.id, { publishedAs: null });
    store.save();
    await this.record(recipe.id);
  },

  canRemovePublic(entry) {
    return this.signedIn() && (this.admin || entry.publishedBy === this.person);
  },

  async removePublic(entry) {
    await this.request("DELETE", `public/${entry.id}`);
  }
};
