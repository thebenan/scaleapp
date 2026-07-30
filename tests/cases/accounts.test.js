// Two people sharing one browser must not see or inherit each other's recipes.
// localStorage is per-browser, not per-person, so this is entirely a client-side
// concern — the server namespaces correctly either way.

await fetch("/api/__reset", { method: "POST" });

const raw = key => localStorage.getItem(key);

// --- first sign-in offers, but never assumes ---
check("starts with the signed-out set", store.live().length === 1, String(store.live().length));

await sync.signIn("test-passphrase");
check("signed in as tester", sync.person === "tester");
check("storage key is namespaced", activeStorageKey() === "recipes.tester", activeStorageKey());

// Signing in must NOT silently hand the device's recipes to the account — it is
// surprising and awkward to undo, so it is a choice.
check("signed-out recipes are not adopted automatically", store.find("anon-1") === null,
      JSON.stringify(store.live().map(r => r.name)));
check("the signed-out set is still intact before choosing", raw("recipes") !== null);

const adoption = settleSignedOutRecipes();
check("the choice is offered", await waitFor(() => adoptCount.textContent === "1"),
      adoptCount.textContent);
check("it names the account", adoptPerson.textContent === "tester", adoptPerson.textContent);
check("it uses singular wording for one recipe", adoptNoun.textContent === "recipe",
      adoptNoun.textContent);
adoptAddBtn.click();
await adoption;

check("accepting adopts the recipe", !!store.find("anon-1"));
// Moved rather than copied, or the next person to sign in would inherit it too.
check("the signed-out set is emptied after adoption", raw("recipes") === null,
      String(raw("recipes")));

await pullAndFlush();
const tCake = store.create({
  name: "Tester Cake", servings: 4,
  ingredients: [{ id: "ti-1", name: "flour", amount: 100, unit: "g" }]
});
store.save();
await sync.record(tCake.id);
check("tester's recipe is on tester's server account",
      (await (await fetch("/api/recipes", {
        headers: { authorization: "Bearer test-passphrase" }
      })).json()).recipes.some(r => r.id === tCake.id));

// --- switching people must not leak anything ---
sync.signOut();
check("sign out returns to the signed-out set", activeStorageKey() === "recipes",
      activeStorageKey());
check("signed-out view does not show tester's recipes", store.find(tCake.id) === null);
check("signed-out view does not show the adopted recipe", store.find("anon-1") === null);

await sync.signIn("other-passphrase");
check("signed in as other", sync.person === "other");
check("other gets their own storage key", activeStorageKey() === "recipes.other",
      activeStorageKey());

// This is the reported bug: other used to see, and then upload, tester's recipes.
check("other does NOT see tester's recipe", store.find(tCake.id) === null,
      JSON.stringify(store.live().map(r => r.name)));
check("other does NOT inherit the adopted recipe", store.find("anon-1") === null);
check("other starts empty", store.live().length === 0, String(store.live().length));

await pullAndFlush();
check("after syncing, other still has nothing of tester's", store.find(tCake.id) === null,
      JSON.stringify(store.live().map(r => r.name)));

// The decisive check: tester's recipe must never have been uploaded to other.
const otherOnServer = await (await fetch("/api/recipes", {
  headers: { authorization: "Bearer other-passphrase" }
})).json();
check("tester's recipe was never pushed into other's account",
      !otherOnServer.recipes.some(r => r.id === tCake.id),
      JSON.stringify(otherOnServer.recipes.map(r => r.name)));
check("other's server account is empty", otherOnServer.recipes.length === 0,
      String(otherOnServer.recipes.length));

// --- other's own work stays theirs ---
const oBread = store.create({
  name: "Other Bread", servings: 1,
  ingredients: [{ id: "oi-1", name: "yeast", amount: 7, unit: "g" }]
});
store.save();
await sync.record(oBread.id);

// --- switching back restores the first person exactly ---
sync.signOut();
await sync.signIn("test-passphrase");
check("tester's recipes come back", !!store.find(tCake.id));
check("tester's adopted recipe comes back", !!store.find("anon-1"));
check("tester does not see other's recipe", store.find(oBread.id) === null,
      JSON.stringify(store.live().map(r => r.name)));

await pullAndFlush();
check("after syncing, tester still does not see other's recipe",
      store.find(oBread.id) === null,
      JSON.stringify(store.live().map(r => r.name)));

// --- outboxes are per person too ---
// A shared outbox would attribute one person's unsent changes to whoever signs
// in next, which is the same leak by a different route.
check("outbox is namespaced", raw("outbox.tester") !== null || sync.pending().length === 0,
      String(raw("outbox.tester")));
sync.signOut();
await sync.signIn("other-passphrase");
check("other's outbox does not contain tester's recipe ids",
      !sync.pending().includes(tCake.id), JSON.stringify(sync.pending()));

// --- declining keeps them separate ---
// Simulate a fresh browser that has signed-out recipes and a person who has
// never had a cookbook here.
sync.signOut();
localStorage.removeItem("recipes.other");
localStorage.setItem("recipes", JSON.stringify({
  schemaVersion: 3,
  recipes: [{ id: "keep-me", name: "Stays Signed Out", servings: 1, updatedAt: Date.now(),
              deletedAt: null, visibility: "private", owner: null, publishedAs: null,
              ingredients: [] }]
}));
await sync.signIn("other-passphrase");

const declined = settleSignedOutRecipes();
check("the choice is offered again for a different person",
      await waitFor(() => adoptPerson.textContent === "other"), adoptPerson.textContent);
adoptKeepBtn.click();
await declined;

check("declining leaves the recipe out of the cookbook", store.find("keep-me") === null,
      JSON.stringify(store.live().map(r => r.name)));
check("declining keeps the signed-out set on the device", raw("recipes") !== null);
check("declining creates the person's cookbook so they are not asked again",
      store.hasNamespace("other") === true);
// hasNamespace is true now, so settling again must not show the dialog at all.
adoptPerson.textContent = "SHOULD-NOT-CHANGE";
await settleSignedOutRecipes();
check("no prompt on subsequent sign-ins",
      adoptPerson.textContent === "SHOULD-NOT-CHANGE", adoptPerson.textContent);

// The signed-out recipes are reachable again by signing out.
sync.signOut();
check("signing out shows the kept-separate recipes", !!store.find("keep-me"));

// --- sign-in error messages must say what happened and what still works ---
const msg401 = signInErrorMessage({ status: 401 });
check("401 explains the passphrase is wrong", /not recognised/i.test(msg401), msg401);

const msgNetwork = signInErrorMessage({ status: undefined });
check("a network failure names likely causes",
      /block|down/i.test(msgNetwork) && /unaffected|still/i.test(msgNetwork), msgNetwork);
check("a network failure is not the same message as a bad passphrase",
      msgNetwork !== msg401);

const msg500 = signInErrorMessage({ status: 500 });
check("a server error reports its status", /500/.test(msg500), msg500);

// The offline branch: navigator.onLine is always true in headless Chrome, so it
// has to be stubbed to reach it.
const onLineDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
const msgOffline = signInErrorMessage({ status: undefined });
Object.defineProperty(Navigator.prototype, "onLine", onLineDescriptor);
delete navigator.onLine;

check("being offline says so plainly", /offline/i.test(msgOffline), msgOffline);
check("offline advice differs from a server-unreachable message",
      msgOffline !== msgNetwork);
check("offline message says what still works", /scale|still/i.test(msgOffline), msgOffline);
