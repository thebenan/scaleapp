// Local storage key
const STORAGE_KEY = "recipes";
const SCHEMA_VERSION = 3;

// v1 was a bare array of {name, servings, ingredients} with no identity at all.
// v2 wraps it in an envelope and gives every recipe and ingredient a permanent
// id, a modified time, and a tombstone field.
function newId() {
  // randomUUID needs a secure context, which a bare http:// LAN address is not
  // — that's the case when testing a phone against a laptop dev server.
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Idempotent by construction: existing ids and timestamps are preserved, so
// this is safe to run on every load forever.
function migrate(parsed) {
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
    // v3. Everything starts private, so turning sync on never dumps one
    // person's collection into anyone else's view — publishing is deliberate.
    visibility: r.visibility === "public" ? "public" : "private",
    owner: r.owner ?? null,
    // publicId of the published copy, or null. Publishing copies rather than
    // moves, so the private original and the public snapshot are independent.
    publishedAs: r.publishedAs ?? null
  }));
}

// Guarded, because an unparseable value here used to throw before a single
// handler was attached — bricking the app with no way back. Stash the raw
// string rather than discarding it, so bad data is never silently destroyed.
let storageBroken = false;
function loadRecipes() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return [];
  try {
    return migrate(JSON.parse(raw));
  } catch (err) {
    console.error("Could not read saved recipes:", err);
    localStorage.setItem(`${STORAGE_KEY}.corrupt.${Date.now()}`, raw);
    storageBroken = true;
    return [];
  }
}

// State. `recipes` holds tombstones too; everything user-facing goes through
// liveRecipes().
let recipes = loadRecipes();
let currentRecipeId = null;

function liveRecipes() {
  return recipes.filter(r => !r.deletedAt);
}

function findRecipe(id) {
  return recipes.find(r => r.id === id && !r.deletedAt) || null;
}

// DOM elements
const recipeSelect = document.getElementById("recipeSelect");
const searchInput = document.getElementById("searchInput");
const clearSearchBtn = document.getElementById("clearSearchBtn");
const searchResults = document.getElementById("searchResults");
const searchResultsList = document.getElementById("searchResultsList");
const recipeDisplay = document.getElementById("recipeDisplay");
const recipeName = document.getElementById("recipeName");
const originalServings = document.getElementById("originalServings");
const desiredServings = document.getElementById("desiredServings");
const ingredientsList = document.getElementById("ingredientsList");

const scaleBtn = document.getElementById("scaleBtn");
const editRecipeBtn = document.getElementById("editRecipeBtn");
const deleteRecipeBtn = document.getElementById("deleteRecipeBtn");
const addRecipeBtn = document.getElementById("addRecipeBtn");

// Built on first use, not at parse time. Constructing these eagerly meant a
// missing Bootstrap threw here and aborted the rest of the file, so the recipe
// list never rendered — an app that looked empty rather than broken.
const modals = {};
function modal(id) {
  if (!modals[id]) modals[id] = new bootstrap.Modal(document.getElementById(id));
  return modals[id];
}

const modalTitle = document.getElementById("modalTitle");
const recipeNameInput = document.getElementById("recipeNameInput");
const servingsInput = document.getElementById("servingsInput");
const ingredientsFields = document.getElementById("ingredientsFields");
const addIngredientFieldBtn = document.getElementById("addIngredientFieldBtn");
const saveRecipeBtn = document.getElementById("saveRecipeBtn");
const deleteRecipeName = document.getElementById("deleteRecipeName");
const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");

const banner = document.getElementById("banner");
const bannerText = document.getElementById("bannerText");
const bannerClose = document.getElementById("bannerClose");
const exportBtn = document.getElementById("exportBtn");
const importBtn = document.getElementById("importBtn");
const importFile = document.getElementById("importFile");
const trashBtn = document.getElementById("trashBtn");
const trashPanel = document.getElementById("trashPanel");
const trashList = document.getElementById("trashList");

// Replaces alert(): non-blocking, and somewhere for sync to report into.
// Problems stay until dismissed; confirmations clear themselves.
const BANNER_CLASSES = {
  info: "alert-info", success: "alert-success",
  warning: "alert-warning", error: "alert-danger"
};
let bannerTimer = null;

function notify(message, kind = "info") {
  clearTimeout(bannerTimer);
  bannerText.textContent = message;
  banner.className = `alert alert-dismissible ${BANNER_CLASSES[kind] || BANNER_CLASSES.info}`;
  if (kind === "info" || kind === "success") {
    bannerTimer = setTimeout(dismissBanner, 4000);
  }
}

function dismissBanner() {
  clearTimeout(bannerTimer);
  banner.classList.add("d-none");
}

bannerClose.addEventListener("click", dismissBanner);

// Stamped with the commit SHA at deploy time by the sed in netlify.toml. Left
// as the literal placeholder when served straight off disk, which is how a
// local checkout tells itself apart from a deploy.
const RAW_BUILD_ID = "__BUILD_ID__";
const BUILD_ID = RAW_BUILD_ID.startsWith("__BUILD") ? "dev" : RAW_BUILD_ID.slice(0, 7);

// Recipe count goes in the footer too: phones have no devtools, so this is the
// only way to tell "storage was wiped" apart from "this device never had them".
const buildStamp = document.getElementById("buildStamp");
function renderBuildStamp() {
  if (!buildStamp) return;
  buildStamp.textContent = storageBroken
    ? `build ${BUILD_ID} · saved data unreadable, backed up`
    : `build ${BUILD_ID} · ${liveRecipes().length} recipes on this device`;
}
renderBuildStamp();

// Asks the browser not to evict this origin's storage under pressure. Granted
// automatically for installed PWAs; on iOS Safari it is the difference between
// recipes surviving a quiet week and being deleted by ITP.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

// On localhost the build id is never substituted, so the cache name never
// changes and the worker would serve stale files after every edit — the exact
// "my changes don't show up" symptom this whole rewrite was fixing. Skip it
// locally and tear down any worker a previous session left behind. Append
// ?sw=1 when you actually want to test offline behaviour.
const localDev = ["localhost", "127.0.0.1"].includes(location.hostname)
  && !new URLSearchParams(location.search).has("sw");

if (localDev && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then(regs => regs.forEach(r => r.unregister()))
    .then(() => caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))))
    .catch(() => {});
}

// Register Service Worker
if (!localDev && "serviceWorker" in navigator && window.isSecureContext) {
  // No controller at load time means this is a first install, and the
  // controllerchange that follows is expected — reloading on it would give
  // every brand-new visitor a gratuitous refresh.
  const hadController = !!navigator.serviceWorker.controller;
  let refreshing = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  navigator.serviceWorker.register("/sw.js")
    .then(registration => {
      // This poll is what pulls the fix onto clients still running the old
      // worker, so it has to stay at least until everyone has loaded once.
      setInterval(() => registration.update(), 60000);
    })
    .catch(error => console.log("Service Worker registration failed:", error));
}

// Save state to localStorage. Tombstones are written too — they are what stops
// a delete being undone later.
function saveRecipes() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    recipes
  }));
  renderRecipeList();
  renderBuildStamp();
}

// Render dropdown list (always shows all live recipes)
function renderRecipeList() {
  recipeSelect.innerHTML = `<option value="">-- Select recipe --</option>`;

  liveRecipes().forEach(r => {
    const option = document.createElement("option");
    option.value = r.id;
    option.textContent = r.name;
    recipeSelect.appendChild(option);
  });

  // Keep the dropdown pointing at whatever is on screen; rebuilding the options
  // otherwise resets it to the placeholder.
  recipeSelect.value = currentRecipeId ?? "";
}

// Handle search and show filtered results
function handleSearch(filterKeyword = '') {
  // Show/hide clear button based on whether there's text
  if (filterKeyword.trim()) {
    clearSearchBtn.classList.remove("d-none");
  } else {
    clearSearchBtn.classList.add("d-none");
  }
  
  if (filterKeyword.trim()) {
    const filteredRecipes = liveRecipes().filter(recipe =>
      recipe.name.toLowerCase().includes(filterKeyword.toLowerCase())
    );

    searchResults.classList.remove("d-none");
    searchResultsList.innerHTML = "";

    if (filteredRecipes.length === 0) {
      searchResultsList.innerHTML = '<div class="list-group-item">No recipes found</div>';
    } else {
      filteredRecipes.forEach((r) => {
        const item = document.createElement("div");
        item.className = "list-group-item list-group-item-action";
        item.textContent = r.name;
        item.onclick = () => {
          showRecipe(r.id);
          // Clear search and hide results when recipe is selected
          clearSearch();
        };
        searchResultsList.appendChild(item);
      });
    }
  } else {
    searchResults.classList.add("d-none");
  }
}

// Clear search function
function clearSearch() {
  searchInput.value = "";
  clearSearchBtn.classList.add("d-none");
  searchResults.classList.add("d-none");
}

// Rows are built with textContent, not innerHTML. Recipe text is user input,
// and once a cookbook is shared between people this stops being self-XSS and
// becomes stored XSS.
function renderIngredients(ingredients, factor = 1) {
  ingredientsList.innerHTML = "";
  ingredients.forEach(ing => {
    const li = document.createElement("li");
    li.className = "list-group-item";
    // A null amount means "to taste" — show the name without inventing a 0.
    const hasAmount = ing.amount !== null && ing.amount !== undefined;
    // Unary + drops trailing zeros, so 2.00 reads as 2 but 0.33 survives.
    const amount = hasAmount ? `${+(ing.amount * factor).toFixed(2)} ` : "";
    const unit = ing.unit ? `${ing.unit} ` : "";
    li.textContent = `${amount}${unit}${ing.name}`;
    ingredientsList.appendChild(li);
  });
}

// Display selected recipe
function showRecipe(id) {
  const r = findRecipe(id);
  // The id can be stale — a recipe deleted on another device, or a dropdown
  // rebuilt mid-interaction. Hide rather than throw.
  if (!r) {
    currentRecipeId = null;
    recipeDisplay.classList.add("d-none");
    return;
  }
  currentRecipeId = id;
  recipeName.textContent = r.name;
  originalServings.textContent = r.servings;
  desiredServings.value = "";
  renderIngredients(r.ingredients);
  recipeDisplay.classList.remove("d-none");
  recipeSelect.value = id;
}

// Scale recipe
scaleBtn.addEventListener("click", () => {
  const desired = parseFloat(desiredServings.value);
  const r = findRecipe(currentRecipeId);
  if (!desired || desired <= 0 || !r) return;
  // Recipes saved before servings were validated can hold null, which would
  // divide to Infinity and render "Infinity g flour".
  if (!r.servings || r.servings <= 0) {
    notify(`"${r.name}" has no original serving count — edit it and set one first.`, "warning");
    return;
  }
  renderIngredients(r.ingredients, desired / r.servings);
});


// Predefined measurement units
const measurementUnits = [
  { value: '', text: 'Select unit' },
  // Weight units
  { value: 'g', text: 'g (grams)' },
  { value: 'kg', text: 'kg (kilograms)' },
  { value: 'oz', text: 'oz (ounces)' },
  { value: 'lb', text: 'lb (pounds)' },
  // Volume units
  { value: 'ml', text: 'ml (milliliters)' },
  { value: 'l', text: 'l (liters)' },
  { value: 'tsp', text: 'tsp (teaspoon)' },
  { value: 'tbsp', text: 'tbsp (tablespoon)' },
  { value: 'cup', text: 'cup' },
  { value: 'fl oz', text: 'fl oz (fluid ounces)' },
  { value: 'pint', text: 'pint' },
  { value: 'quart', text: 'quart' },
  { value: 'gallon', text: 'gallon' },
  // Count units
  { value: 'pcs', text: 'pcs (pieces)' },
  { value: 'whole', text: 'whole' },
  { value: 'dozen', text: 'dozen' },
  // Length units
  { value: 'cm', text: 'cm (centimeters)' },
  { value: 'inch', text: 'inch' },
  // Other units
  { value: 'pinch', text: 'pinch' },
  { value: 'dash', text: 'dash' },
  { value: 'slice', text: 'slice' },
  { value: 'clove', text: 'clove' },
  { value: 'can', text: 'can' },
  { value: 'bottle', text: 'bottle' },
  { value: 'package', text: 'package' },
  { value: 'bag', text: 'bag' }
];

// Add ingredient field logic
function addIngredientField(ingredient = { name: '', amount: '', unit: '' }) {
  const div = document.createElement('div');
  div.className = 'input-group mb-2 ingredient-row';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'form-control ingredient-name';
  nameInput.placeholder = 'Name';
  // Assigned rather than interpolated into a value="" attribute: an ingredient
  // named with a double quote used to break out and mangle the form.
  nameInput.value = ingredient.name || '';

  const amountInput = document.createElement('input');
  amountInput.type = 'number';
  amountInput.className = 'form-control ingredient-amount';
  amountInput.placeholder = 'Amount';
  amountInput.min = '0';
  amountInput.step = 'any';
  amountInput.value = ingredient.amount ?? '';

  div.dataset.ingredientId = ingredient.id || newId();

  const unitSelect = document.createElement('select');
  unitSelect.className = 'form-select ingredient-unit';
  unitSelect.style.maxWidth = '150px';
  measurementUnits.forEach(unit => {
    const option = document.createElement('option');
    option.value = unit.value;
    option.textContent = unit.text;
    unitSelect.appendChild(option);
  });
  unitSelect.value = ingredient.unit || '';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn btn-outline-danger remove-ingredient-btn';
  removeBtn.textContent = '×';
  removeBtn.onclick = () => div.remove();

  div.append(nameInput, amountInput, unitSelect, removeBtn);
  ingredientsFields.appendChild(div);
}

// Which recipe the modal is editing, kept separate from which one is on screen.
// Overloading a single variable meant opening "Add" while a recipe was displayed
// silently disabled that recipe's own edit and delete buttons.
let editingId = null;

// Add recipe button
addRecipeBtn.addEventListener("click", () => {
  editingId = null;
  modalTitle.textContent = "Add Recipe";
  recipeNameInput.value = "";
  servingsInput.value = "";
  ingredientsFields.innerHTML = "";
  addIngredientField();
  modal("recipeModal").show();
});

// Edit recipe button
editRecipeBtn.addEventListener("click", () => {
  const r = findRecipe(currentRecipeId);
  if (!r) return;
  editingId = r.id;
  modalTitle.textContent = "Edit Recipe";
  recipeNameInput.value = r.name;
  servingsInput.value = r.servings;
  ingredientsFields.innerHTML = "";
  r.ingredients.forEach(ing => addIngredientField(ing));
  if (r.ingredients.length === 0) addIngredientField();
  modal("recipeModal").show();
});

// Save recipe
saveRecipeBtn.addEventListener("click", () => {
  const name = recipeNameInput.value.trim();
  const servings = parseFloat(servingsInput.value);

  // Both of these used to save silently: a blank name became an unlabelled row
  // in the dropdown, and a blank servings count became NaN, serialised to null,
  // and scaled to Infinity.
  if (!name) {
    recipeNameInput.focus();
    notify("Give the recipe a name.", "warning");
    return;
  }
  if (!Number.isFinite(servings) || servings <= 0) {
    servingsInput.focus();
    notify("Set how many servings this recipe makes.", "warning");
    return;
  }

  const ingredientRows = ingredientsFields.querySelectorAll('.ingredient-row');
  const ingredients = Array.from(ingredientRows).map(row => {
    const name = row.querySelector('.ingredient-name').value.trim();
    const amount = parseFloat(row.querySelector('.ingredient-amount').value);
    const unit = row.querySelector('.ingredient-unit').value;
    // null, not 0: a blank amount means "to taste", and 0 would scale an
    // ingredient to nothing.
    return {
      // Carried on the row so an edit preserves ingredient identity. The
      // instruction grid will reference these ids, so regenerating them on
      // every save would silently detach steps from their ingredients.
      id: row.dataset.ingredientId || newId(),
      name,
      amount: Number.isFinite(amount) ? amount : null,
      unit
    };
  }).filter(ing => ing.name);

  const existing = findRecipe(editingId);
  if (existing) {
    Object.assign(existing, { name, servings, ingredients, updatedAt: Date.now() });
  } else {
    const recipe = {
      id: newId(), name, servings, ingredients,
      updatedAt: Date.now(), deletedAt: null
    };
    recipes.push(recipe);
    // Show what was just added. Previously the dropdown was rebuilt and reset
    // to the placeholder, so a new recipe vanished the moment you saved it.
    currentRecipeId = recipe.id;
  }

  saveRecipes();
  modal("recipeModal").hide();
  showRecipe(currentRecipeId);
  editingId = null;
});

addIngredientFieldBtn.addEventListener('click', () => addIngredientField());

// Delete recipe
deleteRecipeBtn.addEventListener("click", () => {
  const r = findRecipe(currentRecipeId);
  if (!r) return;

  deleteRecipeName.textContent = r.name;
  modal("deleteModal").show();
});

// Confirm delete
confirmDeleteBtn.addEventListener("click", () => {
  const r = findRecipe(currentRecipeId);
  if (!r) return;

  // Tombstoned, not spliced out. A removed entry looks identical to one that
  // never arrived, so another device holding the recipe would sync it back.
  r.deletedAt = Date.now();
  r.updatedAt = r.deletedAt;

  currentRecipeId = null;
  saveRecipes();

  recipeSelect.value = "";
  // keep the current search filter; list already re-rendered in saveRecipes()
  recipeDisplay.classList.add("d-none");
  modal("deleteModal").hide();
});

// Handle dropdown select
recipeSelect.addEventListener("change", e => {
  if (e.target.value) {
    showRecipe(e.target.value);
    // Clear search and hide search results when recipe is selected from dropdown
    clearSearch();
  }
});

// Clear search button
clearSearchBtn.addEventListener("click", () => {
  clearSearch();
});

// Handle search filter
searchInput.addEventListener("input", () => {
  const keyword = searchInput.value.trim();
  handleSearch(keyword);
  
  // Clear recipe display if current recipe is not in filtered results
  const current = findRecipe(currentRecipeId);
  if (current && keyword) {
    if (!current.name.toLowerCase().includes(keyword.toLowerCase())) {
      recipeDisplay.classList.add("d-none");
      currentRecipeId = null;
      recipeSelect.value = "";
    }
  }
});

// --- Backup ---

// Tombstones are included on purpose: importing a backup must not resurrect
// recipes that were deleted after it was taken.
function buildExportPayload() {
  return {
    app: "recipe-scaler",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    recipes
  };
}

exportBtn.addEventListener("click", () => {
  const payload = buildExportPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `recipes-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  notify(`Exported ${liveRecipes().length} recipes.`, "success");
});

// Merge by id, newest updatedAt wins. Deliberately additive — there is no
// "replace everything" option, so importing a stale backup can never silently
// destroy newer work. Use Recently deleted to bring back a specific recipe.
function mergeRecipes(incoming) {
  let added = 0, updated = 0, skipped = 0;
  incoming.forEach(inc => {
    const existing = recipes.find(r => r.id === inc.id);
    if (!existing) {
      recipes.push(inc);
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

importBtn.addEventListener("click", () => importFile.click());

importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  if (!file) return;
  try {
    // migrate() accepts both the envelope and a bare v1 array, so old exports
    // and hand-edited files both work.
    const incoming = migrate(JSON.parse(await file.text()));
    if (incoming.length === 0) {
      notify("That file has no recipes in it.", "warning");
      return;
    }
    const { added, updated, skipped } = mergeRecipes(incoming);
    saveRecipes();
    if (currentRecipeId) showRecipe(currentRecipeId);
    notify(`Imported: ${added} added, ${updated} updated, ${skipped} already current.`, "success");
  } catch (err) {
    console.error("Import failed:", err);
    notify("Could not read that file — it does not look like a Recipe Scaler backup.", "error");
  } finally {
    // Cleared so picking the same file again still fires a change event.
    importFile.value = "";
  }
});

// --- Recently deleted ---

function renderTrash() {
  const deleted = recipes.filter(r => r.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt);
  trashList.innerHTML = "";

  if (deleted.length === 0) {
    const empty = document.createElement("div");
    empty.className = "list-group-item text-muted";
    empty.textContent = "Nothing deleted.";
    trashList.appendChild(empty);
    return;
  }

  deleted.forEach(r => {
    const row = document.createElement("div");
    row.className = "list-group-item d-flex justify-content-between align-items-center gap-2";

    const label = document.createElement("span");
    label.textContent = `${r.name} · deleted ${new Date(r.deletedAt).toLocaleDateString()}`;

    const restore = document.createElement("button");
    restore.className = "btn btn-sm btn-outline-success restore-btn";
    restore.textContent = "Restore";
    restore.onclick = () => {
      r.deletedAt = null;
      // Must be newer than the tombstone, or last-write-wins would let another
      // device's delete undo this restore on the next sync.
      r.updatedAt = Date.now();
      currentRecipeId = r.id;
      saveRecipes();
      renderTrash();
      showRecipe(r.id);
      notify(`Restored "${r.name}".`, "success");
    };

    row.append(label, restore);
    trashList.appendChild(row);
  });
}

trashBtn.addEventListener("click", () => {
  trashPanel.classList.toggle("d-none");
  if (!trashPanel.classList.contains("d-none")) renderTrash();
});

// Init
renderRecipeList();