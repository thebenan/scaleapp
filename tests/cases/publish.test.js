// Publishing a copy, reading the public list without a passphrase, and the
// permission rules around removing someone else's published recipe.

await fetch("/api/__reset", { method: "POST" });

// tester is the admin in the dev server config; other is not.
await sync.signIn("test-passphrase");
check("signed in as the admin", sync.person === "tester" && sync.admin === true);

// Signing in no longer adopts the device's recipes silently, so accept the offer
// explicitly — this is the "existing user signs in for the first time" path.
const __adoption = settleSignedOutRecipes();
await waitFor(() => adoptCount.textContent !== "");
adoptAddBtn.click();
await __adoption;


// --- publishing copies rather than moves ---
const mine = store.find("mine-1");
const publicId = await sync.publish(mine);

check("publish returns a separate public id", typeof publicId === "string" && publicId !== "mine-1",
      publicId);
check("private original keeps its own id", !!store.find("mine-1"));
check("private original stays private", store.find("mine-1").visibility === "private",
      store.find("mine-1").visibility);
check("private original records where it was published",
      store.find("mine-1").publishedAs === publicId,
      String(store.find("mine-1").publishedAs));

// --- the public list needs no passphrase ---
// Raw fetch with no Authorization header, which is what a stranger's browser
// sends. sync.request would attach the header, so it cannot test this.
const anonymous = await fetch("/api/public");
check("public list is readable unauthenticated", anonymous.status === 200,
      String(anonymous.status));
const anonBody = await anonymous.json();
check("published recipe is visible to anyone",
      anonBody.recipes.some(r => r.id === publicId && r.name === "My Cake"),
      JSON.stringify(anonBody.recipes.map(r => r.name)));
check("published copy records who published it",
      anonBody.recipes.find(r => r.id === publicId).publishedBy === "tester");
check("published copy carries the ingredients",
      anonBody.recipes.find(r => r.id === publicId).ingredients[0].name === "flour");

// A stranger must not be able to read anyone's private cookbook.
const anonPrivate = await fetch("/api/recipes");
check("private cookbook is not readable unauthenticated", anonPrivate.status === 401,
      String(anonPrivate.status));

// --- the panel is part of the page, not behind a click ---
check("the public panel is open on load", !publicPanel.classList.contains("d-none"),
      publicPanel.className);
check("its button offers to hide it", publicBtn.textContent === "Hide", publicBtn.textContent);
publicBtn.click();
check("clicking closes it", publicPanel.classList.contains("d-none"), publicPanel.className);
check("and offers to show it again", publicBtn.textContent === "Show", publicBtn.textContent);
check("the choice is remembered for the next load",
      localStorage.getItem("public.open") === "0",
      String(localStorage.getItem("public.open")));
publicBtn.click();
check("reopening works", !publicPanel.classList.contains("d-none"), publicPanel.className);
check("and is remembered too", localStorage.getItem("public.open") === "1",
      String(localStorage.getItem("public.open")));

// --- viewing a public recipe is read-only ---
await renderPublicList();
check("public panel lists the entry", publicList.textContent.includes("My Cake"),
      publicList.textContent);
check("a current list says nothing about staleness",
      publicMeta.classList.contains("d-none"), publicMeta.className);
const entry = anonBody.recipes.find(r => r.id === publicId);
showPublicRecipe(entry);
check("public recipe is displayed", recipeName.textContent === "My Cake");
check("edit is hidden for a public recipe", editRecipeBtn.classList.contains("d-none"));
check("delete is hidden for a public recipe", deleteRecipeBtn.classList.contains("d-none"));
check("scaling still works on a public recipe", (() => {
  desiredServings.value = "16";
  desiredServings.dispatchEvent(new Event("input"));
  return [...ingredientsList.children][0].querySelector('.ingredient-text').textContent === "600 g flour";
})(), [...ingredientsList.children][0]?.querySelector('.ingredient-text').textContent);

// --- unpublishing ---
showRecipe("mine-1");
check("publish button becomes an update button once published",
      !publishBtn.classList.contains("d-none") && /update/i.test(publishBtn.textContent),
      publishBtn.textContent);
check("unpublish button shown once published", !unpublishBtn.classList.contains("d-none"));

// The public copy is a snapshot: editing the private original must not silently
// change what everyone else sees, but there must be a way to refresh it.
store.update("mine-1", { name: "My Cake v2" });
store.save();
const beforeRefresh = await (await fetch("/api/public")).json();
check("editing privately does not change the public copy",
      beforeRefresh.recipes.find(r => r.id === publicId).name === "My Cake",
      beforeRefresh.recipes.find(r => r.id === publicId).name);

await sync.publish(store.find("mine-1"));
const afterRefresh = await (await fetch("/api/public")).json();
check("re-publishing refreshes the public copy in place",
      afterRefresh.recipes.filter(r => r.id === publicId).length === 1
        && afterRefresh.recipes.find(r => r.id === publicId).name === "My Cake v2",
      JSON.stringify(afterRefresh.recipes.map(r => r.name)));
check("refreshing does not create a second public entry",
      afterRefresh.recipes.length === beforeRefresh.recipes.length,
      `${beforeRefresh.recipes.length} -> ${afterRefresh.recipes.length}`);

await sync.unpublish(store.find("mine-1"));
check("unpublish clears the link", store.find("mine-1").publishedAs === null);
const afterUnpublish = await (await fetch("/api/public")).json();
check("unpublished recipe leaves the public list",
      !afterUnpublish.recipes.some(r => r.id === publicId),
      JSON.stringify(afterUnpublish.recipes.map(r => r.id)));
check("the private original survives unpublishing", !!store.find("mine-1"));

// --- published recipes are readable with no connection ---
// The service worker never caches /api/*, so without a copy on the device the
// public list is simply gone offline — which is when a recipe is most wanted.
//
// Republished first: the unpublish above emptied the list, and a cache test that
// leaned on a copy taken before it would be passing by accident.
await sync.publish(store.find("mine-1"));
await renderPublicList();
// Read from the store rather than hardcoded: the refresh test above renamed this
// recipe, and "My Cake" still matches "My Cake v2" as a substring, so a literal
// would keep passing while pointing at nothing.
const publishedName = store.find("mine-1").name;
check("the list is populated again for the offline tests",
      publicList.textContent.includes(publishedName),
      publishedName + " :: " + publicList.textContent);

const cached = JSON.parse(localStorage.getItem("public.cache"));
check("a successful fetch leaves a copy on the device",
      cached && Array.isArray(cached.recipes) && cached.recipes.length > 0,
      String(localStorage.getItem("public.cache")));
check("the copy is stamped with when it was taken",
      Number.isFinite(cached.fetchedAt), String(cached?.fetchedAt));
check("the copy carries the ingredients, so it can be scaled offline",
      cached.recipes.every(r => Array.isArray(r.ingredients)),
      JSON.stringify(cached.recipes.map(r => r.ingredients?.length)));

const realFetch = window.fetch;
window.fetch = () => Promise.reject(new TypeError("simulated network failure"));

const offlineEntries = await sync.listPublic();
check("the list still comes back with no connection", offlineEntries.length > 0,
      JSON.stringify(offlineEntries.map(r => r.name)));
check("it is marked as the saved copy", sync.publicStale === true);

await renderPublicList();
check("the panel renders it offline", publicList.textContent.includes(publishedName),
      publicList.textContent);
check("and says it is a saved copy rather than pretending it is current",
      !publicMeta.classList.contains("d-none") && /saved copy/i.test(publicMeta.textContent),
      publicMeta.textContent);

// A public recipe read from the cache must scale like any other.
// Matched on sourceId, which does not change when the recipe is renamed.
const offlineEntry = offlineEntries.find(r => r.sourceId === "mine-1");
showPublicRecipe(offlineEntry);
desiredServings.value = "16";
desiredServings.dispatchEvent(new Event("input"));
check("an offline public recipe still scales",
      ingredientsList.querySelector(".ingredient-text").textContent === "600 g flour",
      ingredientsList.querySelector(".ingredient-text").textContent);

// With no copy at all there is nothing to fall back to, and it must say so
// rather than sit on "Loading…".
localStorage.removeItem("public.cache");
let noCache = null;
try { await sync.listPublic(); } catch (err) { noCache = err; }
check("with no saved copy the failure still surfaces", noCache !== null, String(noCache));

window.fetch = realFetch;
await renderPublicList();
check("reconnecting drops the stale marker", sync.publicStale === false);
check("and the notice goes with it", publicMeta.classList.contains("d-none"),
      publicMeta.className);

// --- identity-dependent chrome has to follow identity ---
// The panel is painted at load, before whoami has answered, so the first paint
// carries nobody's Remove button. They have to arrive when identity does and go
// when it goes — a Remove button left behind after signing out offers an action
// the server will refuse.
const removeButtons = () => publicList.querySelectorAll(".public-remove").length;
check("the publisher sees a Remove button", removeButtons() > 0, String(removeButtons()));

// Through the real sign-out path, not by poking the renderer: the bug this
// guards against is the redraw not being wired to identity changes at all.
let fetchCount = 0;
const countingFetch = window.fetch;
window.fetch = (...args) => { fetchCount++; return countingFetch(...args); };
await signOutFlow();
window.fetch = countingFetch;

check("signing out takes it away", removeButtons() === 0, String(removeButtons()));
check("the entry itself is still listed", publicList.textContent.includes(publishedName),
      publicList.textContent);
check("and the list was not refetched to manage it", fetchCount === 0, String(fetchCount));

// Also through the real path: sync.signIn is only the network call, and it is
// the handler around it that redraws.
passphraseInput.value = "test-passphrase";
signInBtn.click();
check("signing back in brings it back", await waitFor(() => removeButtons() > 0),
      String(removeButtons()));

// Leave the public list as the permissions block below expects to find it.
await sync.pull();
await sync.unpublish(store.find("mine-1"));

// --- permissions ---
// "other" publishes something of their own.
sync.signOut();
await sync.signIn("other-passphrase");
check("signed in as a non-admin", sync.person === "other" && sync.admin === false);

const theirs = store.create({
  name: "Their Bread", servings: 2,
  ingredients: [{ id: "ti-1", name: "yeast", amount: 7, unit: "g" }]
});
store.save();
const theirPublicId = await sync.publish(theirs);
check("non-admin can publish their own recipe", typeof theirPublicId === "string");

// tester published nothing now, so make one to attack. Signing out took tester's
// recipes off the device, so they have to come back from the server first.
sync.signOut();
await sync.signIn("test-passphrase");
await sync.pull();
const adminPublicId = await sync.publish(store.find("mine-1"));

sync.signOut();
await sync.signIn("other-passphrase");

let refused = null;
try {
  await sync.removePublic({ id: adminPublicId });
} catch (err) {
  refused = err;
}
check("non-owner cannot remove someone else's published recipe", refused?.status === 403,
      String(refused?.status));
const stillThere = await (await fetch("/api/public")).json();
check("the attacked recipe is still published",
      stillThere.recipes.some(r => r.id === adminPublicId));

// The UI must not offer a Remove button it has no right to use. The server is
// the real boundary; this only checks the button is consistent with it.
check("canRemovePublic is false for someone else's entry",
      sync.canRemovePublic({ id: adminPublicId, publishedBy: "tester" }) === false);
check("canRemovePublic is true for your own entry",
      sync.canRemovePublic({ id: theirPublicId, publishedBy: "other" }) === true);

// The admin may remove anyone's.
sync.signOut();
await sync.signIn("test-passphrase");
check("admin canRemovePublic on someone else's entry",
      sync.canRemovePublic({ id: theirPublicId, publishedBy: "other" }) === true);
await sync.removePublic({ id: theirPublicId });
const afterAdmin = await (await fetch("/api/public")).json();
check("admin removal takes effect", !afterAdmin.recipes.some(r => r.id === theirPublicId),
      JSON.stringify(afterAdmin.recipes.map(r => r.id)));
