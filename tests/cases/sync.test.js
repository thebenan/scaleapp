// Private sync: identity, first-sync safety, reconciliation, tombstone
// propagation, conflicts, and the offline outbox.

const PASS = "test-passphrase";
const auth = { authorization: `Bearer ${PASS}` };

await fetch("/api/__reset", { method: "POST" });

// Stand in for a second device: talk to the API directly, then pull.
const asOtherDevice = (id, recipe) => fetch(`/api/recipes/${id}`, {
  method: "PUT",
  headers: { ...auth, "content-type": "application/json" },
  body: JSON.stringify(recipe)
});

// --- identity ---
const who = await sync.signIn(PASS);
check("sign in identifies the person", who.person === "tester", JSON.stringify(who));
check("admin flag comes from the server", who.admin === true);
check("signedIn reflects state", sync.signedIn() === true);

// --- first sync must upload, never wipe ---
// A recipe missing from the server means "not uploaded yet". If that were read as
// "deleted", everyone's existing recipes would vanish the moment they signed in.
const localCount = store.live().length;
check("seed has local recipes", localCount === 2, String(localCount));

await sync.pull();
check("first pull keeps local recipes", store.live().length === localCount,
      String(store.live().length));
check("first pull queues local recipes for upload", sync.pending().length === localCount,
      JSON.stringify(sync.pending()));

const flushed = await sync.flush();
check("first flush uploads them", flushed.pushed === localCount, JSON.stringify(flushed));
check("outbox drains", sync.pending().length === 0, JSON.stringify(sync.pending()));

const onServer = await (await fetch("/api/recipes", { headers: auth })).json();
check("server now holds both recipes", onServer.recipes.length === 2,
      String(onServer.recipes.length));
check("server stamps the owner", onServer.recipes.every(r => r.owner === "tester"));

// --- a second device adds something ---
await asOtherDevice("remote-1", {
  id: "remote-1", name: "From Phone", servings: 6, updatedAt: Date.now(),
  ingredients: [{ id: "ri-1", name: "oats", amount: 80, unit: "g" }]
});
await sync.pull();
check("pull adopts a recipe from another device", !!store.find("remote-1"));
check("adopted recipe has its ingredients",
      store.find("remote-1")?.ingredients[0].name === "oats");

// --- a delete on another device must propagate ---
await asOtherDevice("remote-1", {
  id: "remote-1", name: "From Phone", servings: 6,
  updatedAt: Date.now() + 1000, deletedAt: Date.now() + 1000, ingredients: []
});
await sync.pull();
check("remote tombstone deletes locally", store.find("remote-1") === null);

// ...and must stay deleted on the next pull, rather than resurrecting.
await sync.pull();
await sync.flush();
await sync.pull();
check("deleted recipe does not resurrect", store.find("remote-1") === null);

// --- conflict: another device wrote something newer ---
const target = store.find("local-1");
await asOtherDevice("local-1", {
  id: "local-1", name: "Won On Phone", servings: 9,
  updatedAt: target.updatedAt + 5000, ingredients: []
});
// Make a local edit that is deliberately older than the server's copy.
store.update("local-1", { name: "Lost Laptop Edit" });
store.findAny("local-1").updatedAt = target.updatedAt + 1000;
store.save();

const conflict = await sync.push("local-1");
check("stale push is reported as superseded", conflict.superseded === true,
      JSON.stringify(conflict));
check("the newer copy wins", store.find("local-1").name === "Won On Phone",
      store.find("local-1").name);
check("superseded id leaves the outbox", !sync.pending().includes("local-1"));

// --- offline ---
const realFetch = window.fetch;
window.fetch = () => Promise.reject(new TypeError("simulated network failure"));

store.update("local-2", { name: "Edited While Offline" });
store.save();
await sync.record("local-2");
check("offline edit is kept locally", store.find("local-2").name === "Edited While Offline");
check("offline edit stays in the outbox", sync.pending().includes("local-2"),
      JSON.stringify(sync.pending()));
check("offline is detected", sync.offline === true);

const failedFlush = await sync.flush();
check("flush while offline reports failure and retains the item",
      failedFlush.failed === 1 && sync.pending().includes("local-2"),
      JSON.stringify(failedFlush));

window.fetch = realFetch;
sync.offline = false;

const recovered = await sync.flush();
check("outbox flushes once back online", recovered.pushed === 1, JSON.stringify(recovered));
check("outbox is empty after recovery", sync.pending().length === 0);

const afterRecovery = await (await fetch("/api/recipes", { headers: auth })).json();
check("the offline edit reached the server",
      afterRecovery.recipes.find(r => r.id === "local-2")?.name === "Edited While Offline",
      JSON.stringify(afterRecovery.recipes.map(r => r.name)));

// --- rejected passphrase ---
sync.signOut();
check("sign out clears identity", sync.signedIn() === false);
check("sign out clears the outbox", sync.pending().length === 0);

let rejected = null;
try {
  await sync.signIn("definitely-not-the-passphrase");
} catch (err) {
  rejected = err;
}
check("wrong passphrase is rejected", rejected?.status === 401, String(rejected?.status));
check("a rejected passphrase is not kept",
      localStorage.getItem("auth.passphrase") === null,
      String(localStorage.getItem("auth.passphrase")));

// Recipes must survive signing out — they live on the device, not the session.
check("recipes survive sign out", store.live().length >= 2, String(store.live().length));
