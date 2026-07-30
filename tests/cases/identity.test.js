// Stable ids, the v1 -> v2 migration, and soft deletes.

const stored = () => JSON.parse(localStorage.getItem("recipes"));

// --- migration from v1 ---
check("v1 data survives migration",
      store.recipes.length === 3 && store.recipes[0].name === "Alpha",
      store.recipes.map(r => r.name).join(","));
check("every recipe got an id",
      store.recipes.every(r => typeof r.id === "string" && r.id.length > 8));
check("ids are unique", new Set(store.recipes.map(r => r.id)).size === 3);
check("every ingredient got an id",
      store.recipes.every(r => r.ingredients.every(i => typeof i.id === "string" && i.id.length > 8)));
check("updatedAt populated", store.recipes.every(r => Number.isFinite(r.updatedAt)));
check("deletedAt defaults to null", store.recipes.every(r => r.deletedAt === null));
check("null amount preserved through migration",
      store.recipes[0].ingredients[1].amount === null,
      JSON.stringify(store.recipes[0].ingredients[1]));

// v3 fields. Defaulting to private is what stops turning sync on from dumping
// one person's collection into everyone else's view.
check("migrated recipes default to private",
      store.recipes.every(r => r.visibility === "private"),
      store.recipes.map(r => r.visibility).join(","));
check("owner defaults to null", store.recipes.every(r => r.owner === null));
check("publishedAs defaults to null", store.recipes.every(r => r.publishedAs === null));

// Idempotence is what makes it safe to run migrate() on every load forever.
const idsBefore = store.recipes.map(r => r.id).join(",");
const twice = migrate(migrate({ schemaVersion: 2, recipes: store.recipes }));
check("migrate is idempotent", twice.map(r => r.id).join(",") === idsBefore);

// --- envelope on disk ---
store.save();
// Compared against the app's own constant: the risk being tested is "does the
// envelope carry a version at all", not which number it currently is.
check("writes schemaVersion envelope", stored().schemaVersion === SCHEMA_VERSION,
      JSON.stringify(stored().schemaVersion));
check("schema is at least v3", SCHEMA_VERSION >= 3, String(SCHEMA_VERSION));
check("envelope holds the recipe array",
      Array.isArray(stored().recipes) && stored().recipes.length === 3);
check("ids stable across a reload",
      store.load().map(r => r.id).join(",") === idsBefore);

// --- the bug that index-based identity caused ---
const alphaId = store.recipes[0].id;
const gammaId = store.recipes[2].id;
showRecipe(gammaId);
const shownBefore = recipeName.textContent;
// Delete Alpha, which was index 0. Under index identity this shifted Gamma from
// index 2 to index 1, so the displayed recipe silently became the wrong one.
showRecipe(alphaId);
confirmDeleteBtn.click();
showRecipe(gammaId);
check("delete does not shift other recipes",
      recipeName.textContent === shownBefore && shownBefore === "Gamma",
      recipeName.textContent);
check("ingredients still match the recipe",
      [...ingredientsList.children][0].textContent === "50 g sugar",
      [...ingredientsList.children].map(l => l.textContent).join("|"));

// --- soft delete ---
check("tombstone kept in memory", store.recipes.length === 3 && store.live().length === 2);
check("tombstone has deletedAt", store.recipes.find(r => r.id === alphaId).deletedAt > 0);
check("tombstone persisted to disk", stored().recipes.length === 3,
      "stored=" + stored().recipes.length);
check("findRecipe refuses a tombstone", store.find(alphaId) === null);
check("dropdown excludes tombstone", recipeSelect.options.length === 3,
      "options=" + recipeSelect.options.length);
check("footer count excludes tombstone", /2 recipes/.test(buildStamp.textContent),
      buildStamp.textContent);
handleSearch("Alpha");
check("search excludes tombstone",
      searchResultsList.textContent.includes("No recipes found"),
      searchResultsList.textContent);
clearSearch();

// A stale id (deleted elsewhere, or a dropdown rebuilt mid-interaction) must
// hide the display rather than throw.
showRecipe("no-such-id");
check("unknown id hides display",
      recipeDisplay.classList.contains("d-none") && app.currentRecipeId === null);

// --- ingredient ids survive an edit ---
// The instruction grid will reference ingredient ids, so an edit that
// regenerated them would silently detach steps from their ingredients.
showRecipe(gammaId);
const ingIdBefore = store.find(gammaId).ingredients[0].id;
editRecipeBtn.click();
servingsInput.value = "16";
saveRecipeBtn.click();
const after = store.find(gammaId);
check("edit preserves recipe id", after !== null && after.id === gammaId);
check("edit preserves ingredient id", after.ingredients[0].id === ingIdBefore,
      ingIdBefore + " -> " + after.ingredients[0].id);
check("edit applies the change", after.servings === 16, String(after.servings));
check("edit bumps updatedAt", after.updatedAt > 0);

// --- a new recipe is shown immediately (it used to vanish on save) ---
addRecipeBtn.click();
recipeNameInput.value = "Delta";
servingsInput.value = "3";
ingredientsFields.querySelector(".ingredient-name").value = "butter";
ingredientsFields.querySelector(".ingredient-amount").value = "20";
saveRecipeBtn.click();
check("new recipe is displayed after save", recipeName.textContent === "Delta",
      recipeName.textContent);
check("new recipe selected in dropdown", recipeSelect.value === app.currentRecipeId);
check("new recipe got an id",
      typeof app.currentRecipeId === "string" && app.currentRecipeId.length > 8);
check("new recipe has a tombstone field", store.find(app.currentRecipeId).deletedAt === null);

// Opening "Add" must not disown the recipe already on screen.
showRecipe(gammaId);
addRecipeBtn.click();
modal("recipeModal").hide();
check("add modal leaves current recipe intact", app.currentRecipeId === gammaId,
      String(app.currentRecipeId));
deleteRecipeBtn.click();
check("delete still targets displayed recipe", deleteRecipeName.textContent === "Gamma",
      deleteRecipeName.textContent);
