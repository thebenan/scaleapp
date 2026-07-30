// Data ownership and persistence. Deliberately knows nothing about the DOM:
// the UI subscribes via onStoreChange, so the sync layer can mutate recipes
// without reaching into rendering code.

const STORAGE_KEY = "recipes";
export const SCHEMA_VERSION = 3;

// localStorage is per-browser, not per-person, so each signed-in person gets
// their own key. Without this, signing in as someone else on the same browser
// leaves the previous person's recipes in the store — and the outbox then
// uploads them into the second person's account.
let activeKey = STORAGE_KEY;
export function activeStorageKey() {
  return activeKey;
}
export function namespaceKeyFor(person) {
  return person ? `${STORAGE_KEY}.${person}` : STORAGE_KEY;
}

export function newId() {
  // randomUUID needs a secure context, which a bare http:// LAN address is not
  // — that's the case when testing a phone against a laptop dev server.
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// v1 was a bare array of {name, servings, ingredients} with no identity at all.
// v2 added an envelope, ids, updatedAt and tombstones. v3 added visibility,
// owner and publishedAs.
//
// Idempotent by construction: existing ids and timestamps are preserved, so this
// is safe to run on every load forever.
export function migrate(parsed) {
  const list = Array.isArray(parsed) ? parsed
    : (parsed && Array.isArray(parsed.recipes) ? parsed.recipes : []);
  const now = Date.now();
  return list.map(r => ({
    id: r.id || newId(),
    name: r.name ?? "",
    servings: r.servings,
    ingredients: (r.ingredients || []).map(ing => ({
      id: ing.id || newId(),
      name: ing.name ?? "",
      amount: ing.amount ?? null,
      unit: ing.unit ?? ""
    })),
    updatedAt: r.updatedAt || now,
    // A deleted recipe is kept as a tombstone rather than spliced out. Without
    // it, one device's delete is undone by another device that still has the
    // recipe locally and syncs it back.
    deletedAt: r.deletedAt ?? null,
    // Everything starts private, so turning sync on never exposes one person's
    // collection — publishing is always deliberate.
    visibility: r.visibility === "public" ? "public" : "private",
    owner: r.owner ?? null,
    // publicId of the published copy, or null. Publishing copies rather than
    // moves, so the private original and the public snapshot are independent.
    publishedAs: r.publishedAs ?? null
  }));
}

const listeners = [];
export function onStoreChange(fn) {
  listeners.push(fn);
}

export const store = {
  // Holds tombstones too; everything user-facing goes through live().
  recipes: [],
  // True when the saved value could not be parsed, so the UI can say so.
  broken: false,

  // Switch to a person's own recipes, or back to the signed-out set when person
  // is null. Always reloads, so the in-memory list can never belong to someone
  // other than whoever is signed in.
  useNamespace(person) {
    activeKey = namespaceKeyFor(person);
    return this.load();
  },

  // Whether this person has ever had a cookbook on this browser. Used to decide
  // if they should be asked about recipes saved before they signed in.
  hasNamespace(person) {
    return localStorage.getItem(namespaceKeyFor(person)) !== null;
  },

  signedOutCount() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) return 0;
      return migrate(JSON.parse(raw)).filter(r => !r.deletedAt).length;
    } catch {
      return 0;
    }
  },

  // Moves recipes saved before signing in into this person's cookbook. Moved
  // rather than copied, so the next person to sign in cannot inherit them too.
  // Never called without asking first — it is not obvious that signing in should
  // hand your recipes to an account, and it is awkward to undo.
  adoptSignedOut(person) {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return 0;
    let incoming;
    try {
      incoming = migrate(JSON.parse(raw));
    } catch {
      return 0;
    }
    this.useNamespace(person);
    const { added } = this.merge(incoming);
    this.save();
    localStorage.removeItem(STORAGE_KEY);
    return added;
  },

  load() {
    const raw = localStorage.getItem(activeKey);
    if (raw === null) {
      this.recipes = [];
      return this.recipes;
    }
    try {
      this.recipes = migrate(JSON.parse(raw));
    } catch (err) {
      // Unguarded, this used to throw before a single handler was attached and
      // bricked the app. Stash the raw string rather than discarding it, so bad
      // data is never silently destroyed.
      console.error("Could not read saved recipes:", err);
      localStorage.setItem(`${activeKey}.corrupt.${Date.now()}`, raw);
      this.broken = true;
      this.recipes = [];
    }
    return this.recipes;
  },

  save() {
    localStorage.setItem(activeKey, JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      recipes: this.recipes
    }));
    listeners.forEach(fn => fn());
  },

  live() {
    return this.recipes.filter(r => !r.deletedAt);
  },

  find(id) {
    return this.recipes.find(r => r.id === id && !r.deletedAt) || null;
  },

  // Including tombstones — the sync layer needs to see them.
  findAny(id) {
    return this.recipes.find(r => r.id === id) || null;
  },

  create({ name, servings, ingredients }) {
    const recipe = {
      id: newId(), name, servings, ingredients,
      updatedAt: Date.now(), deletedAt: null,
      visibility: "private", owner: null, publishedAs: null
    };
    this.recipes.push(recipe);
    return recipe;
  },

  update(id, changes) {
    const existing = this.find(id);
    if (!existing) return null;
    Object.assign(existing, changes, { updatedAt: Date.now() });
    return existing;
  },

  remove(id) {
    const existing = this.find(id);
    if (!existing) return null;
    const now = Date.now();
    existing.deletedAt = now;
    existing.updatedAt = now;
    return existing;
  },

  restore(id) {
    const existing = this.findAny(id);
    if (!existing || !existing.deletedAt) return null;
    existing.deletedAt = null;
    // Must be newer than the tombstone, or last-write-wins would let another
    // device's delete undo this restore on the next sync.
    existing.updatedAt = Date.now();
    return existing;
  },

  deleted() {
    return this.recipes.filter(r => r.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt);
  },

  // Merge by id, newest updatedAt wins. Deliberately additive — there is no
  // "replace everything", so importing a stale backup can never destroy newer
  // work. Bringing back one recipe is Recently deleted's job.
  merge(incoming) {
    let added = 0, updated = 0, skipped = 0;
    incoming.forEach(inc => {
      const existing = this.findAny(inc.id);
      if (!existing) {
        this.recipes.push(inc);
        added++;
      } else if (inc.updatedAt > existing.updatedAt) {
        Object.assign(existing, inc);
        updated++;
      } else {
        skipped++;
      }
    });
    return { added, updated, skipped };
  }
};

// Tombstones are included on purpose: importing a backup must not resurrect
// recipes that were deleted after it was taken.
export function buildExportPayload() {
  return {
    app: "recipe-scaler",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    recipes: store.recipes
  };
}
