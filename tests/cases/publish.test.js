// Publishing a copy, reading the public list without a passphrase, and the
// permission rules around removing someone else's published recipe.

await fetch("/api/__reset", { method: "POST" });

// tester is the admin in the dev server config; other is not.
await sync.signIn("test-passphrase");
check("signed in as the admin", sync.person === "tester" && sync.admin === true);

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

// --- viewing a public recipe is read-only ---
await renderPublicList();
check("public panel lists the entry", publicList.textContent.includes("My Cake"),
      publicList.textContent);
const entry = anonBody.recipes.find(r => r.id === publicId);
showPublicRecipe(entry);
check("public recipe is displayed", recipeName.textContent === "My Cake");
check("edit is hidden for a public recipe", editRecipeBtn.classList.contains("d-none"));
check("delete is hidden for a public recipe", deleteRecipeBtn.classList.contains("d-none"));
check("scaling still works on a public recipe", (() => {
  desiredServings.value = "16";
  scaleBtn.click();
  return [...ingredientsList.children][0].textContent === "600 g flour";
})(), [...ingredientsList.children][0]?.textContent);

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

// tester published nothing now, so make one to attack.
sync.signOut();
await sync.signIn("test-passphrase");
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
