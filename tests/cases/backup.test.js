// Import merging, and restoring from Recently deleted.

check("seed loaded", recipes.length === 3 && liveRecipes().length === 2,
      recipes.length + "/" + liveRecipes().length);

// --- import merge semantics ---
// mergeRecipes is what the file picker feeds, so it is tested directly rather
// than by synthesising a File and a change event.

// A recipe the collection has never seen is added.
let res = mergeRecipes(migrate([
  { id: "r-new", name: "Fresh", servings: 6, updatedAt: Date.now(),
    ingredients: [{ id: "i-9", name: "oats", amount: 80, unit: "g" }] }
]));
check("unknown recipe is added", res.added === 1 && !!findRecipe("r-new"),
      JSON.stringify(res));

// Importing the same file twice must be a no-op — this is the property that
// makes an import safe to retry, and it only works because ids are stable.
res = mergeRecipes(migrate({ schemaVersion: 3, recipes: recipes.map(r => ({ ...r })) }));
check("re-importing the same data changes nothing",
      res.added === 0 && res.updated === 0, JSON.stringify(res));

// A newer copy wins.
const keeper = findRecipe("r-keep");
res = mergeRecipes([{ ...keeper, name: "Keeper v2", updatedAt: keeper.updatedAt + 5000 }]);
check("newer copy overwrites", res.updated === 1 && findRecipe("r-keep").name === "Keeper v2",
      findRecipe("r-keep").name);

// A stale copy must not clobber current work — an old backup is additive only.
res = mergeRecipes([{ ...findRecipe("r-keep"), name: "Keeper OLD", updatedAt: 1 }]);
check("stale copy is ignored", res.skipped === 1 && findRecipe("r-keep").name === "Keeper v2",
      findRecipe("r-keep").name);

// A backup taken before a delete must not resurrect the recipe, because the
// tombstone is newer. This is why exports include tombstones.
res = mergeRecipes([{ id: "r-gone", name: "Deleted One", servings: 1, updatedAt: 1,
                      deletedAt: null, visibility: "private", owner: null,
                      publishedAs: null, ingredients: [] }]);
check("stale backup does not resurrect a deleted recipe", findRecipe("r-gone") === null);

// --- Recently deleted ---
trashBtn.click();
check("trash panel opens", !trashPanel.classList.contains("d-none"));
check("trash lists the deleted recipe", trashList.textContent.includes("Deleted One"),
      trashList.textContent);
check("trash excludes live recipes", !trashList.textContent.includes("Keeper v2"),
      trashList.textContent);

const tombstoneUpdatedAt = recipes.find(r => r.id === "r-gone").updatedAt;
trashList.querySelector(".restore-btn").click();
const restored = findRecipe("r-gone");
check("restore clears the tombstone", restored !== null && restored.deletedAt === null);
check("restore bumps updatedAt past the tombstone",
      restored.updatedAt > tombstoneUpdatedAt,
      tombstoneUpdatedAt + " -> " + restored.updatedAt);
check("restored recipe is displayed", recipeName.textContent === "Deleted One",
      recipeName.textContent);
check("restored recipe is back in the dropdown",
      [...recipeSelect.options].some(o => o.value === "r-gone"));
check("restore persisted",
      JSON.parse(localStorage.getItem("recipes")).recipes
        .find(r => r.id === "r-gone").deletedAt === null);
check("trash is empty after restoring the only entry",
      trashList.textContent.includes("Nothing deleted"), trashList.textContent);

// --- export payload ---
// Delete something so there is a tombstone to look for, then check the exact
// payload the export button serialises.
showRecipe("r-edit");
confirmDeleteBtn.click();

const payload = buildExportPayload();
check("export is tagged as ours", payload.app === "recipe-scaler", payload.app);
check("export carries the schema version", payload.schemaVersion === SCHEMA_VERSION,
      String(payload.schemaVersion));
check("export has a timestamp", !Number.isNaN(Date.parse(payload.exportedAt)),
      payload.exportedAt);
check("export includes live recipes",
      payload.recipes.some(r => r.id === "r-keep" && r.deletedAt === null));
check("export includes tombstones",
      payload.recipes.some(r => r.id === "r-edit" && r.deletedAt !== null),
      JSON.stringify(payload.recipes.map(r => r.id + ":" + !!r.deletedAt)));
check("every exported recipe carries the v3 fields",
      payload.recipes.every(r => "visibility" in r && "owner" in r && "publishedAs" in r));

// A full round trip through the real file-picker handler, which is async.
const roundTrip = new File([JSON.stringify(payload)], "backup.json",
                           { type: "application/json" });
const dt = new DataTransfer();
dt.items.add(roundTrip);
importFile.files = dt.files;
importFile.dispatchEvent(new Event("change"));
check("importing our own export is a no-op",
      await waitFor(() => /0 added, 0 updated/.test(bannerText.textContent)),
      bannerText.textContent);
check("round trip left the tombstone deleted", findRecipe("r-edit") === null);

// A success notify leaves a pending auto-dismiss timer, and Chrome's virtual
// clock fast-forwards to pending timers — which would eat the time budget before
// the next async handler resolves. Clearing it keeps the test deterministic.
dismissBanner();

// A file that is not a backup at all must fail cleanly.
const junk = new File(["this is not json"], "junk.json", { type: "application/json" });
const dt2 = new DataTransfer();
dt2.items.add(junk);
importFile.files = dt2.files;
importFile.dispatchEvent(new Event("change"));
check("garbage file reports an error",
      await waitFor(() => /could not read/i.test(bannerText.textContent)),
      bannerText.textContent);
check("garbage file leaves data intact", !!findRecipe("r-keep"));
