import {
  store, migrate, newId, onStoreChange,
  SCHEMA_VERSION, buildExportPayload, activeStorageKey
} from "./storage.js";
import { sync } from "./sync.js";
import { formatAmount, formatIngredient } from "./format.js";

// --- DOM elements ---
const searchInput = document.getElementById("searchInput");
const clearSearchBtn = document.getElementById("clearSearchBtn");
const recipeList = document.getElementById("recipeList");
const listMeta = document.getElementById("listMeta");
const emptyState = document.getElementById("emptyState");
const emptyStateTitle = document.getElementById("emptyStateTitle");
const emptyStateHint = document.getElementById("emptyStateHint");
const recipeDisplay = document.getElementById("recipeDisplay");
const recipeName = document.getElementById("recipeName");
const originalServings = document.getElementById("originalServings");
const desiredServings = document.getElementById("desiredServings");
const ingredientsList = document.getElementById("ingredientsList");

const resetScaleBtn = document.getElementById("resetScaleBtn");
const scaleNote = document.getElementById("scaleNote");
const publicByline = document.getElementById("publicByline");
const themeBtn = document.getElementById("themeBtn");
const editRecipeBtn = document.getElementById("editRecipeBtn");
const deleteRecipeBtn = document.getElementById("deleteRecipeBtn");
const addRecipeBtn = document.getElementById("addRecipeBtn");

const modalTitle = document.getElementById("modalTitle");
const recipeError = document.getElementById("recipeError");
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
const buildStamp = document.getElementById("buildStamp");

const authBtn = document.getElementById("authBtn");
const syncStatus = document.getElementById("syncStatus");
const syncGlyph = document.getElementById("syncGlyph");
const syncLabel = document.getElementById("syncLabel");
const passphraseInput = document.getElementById("passphraseInput");
const togglePassphrase = document.getElementById("togglePassphrase");
const authError = document.getElementById("authError");
const signInBtn = document.getElementById("signInBtn");
const publishBtn = document.getElementById("publishBtn");
const unpublishBtn = document.getElementById("unpublishBtn");
const publishRecipeName = document.getElementById("publishRecipeName");
const confirmPublishBtn = document.getElementById("confirmPublishBtn");
const adoptCount = document.getElementById("adoptCount");
const adoptPerson = document.getElementById("adoptPerson");
const adoptVerb = document.getElementById("adoptVerb");
const adoptNoun = document.getElementById("adoptNoun");
const adoptAddBtn = document.getElementById("adoptAddBtn");
const adoptKeepBtn = document.getElementById("adoptKeepBtn");
const publicBtn = document.getElementById("publicBtn");
const publicPanel = document.getElementById("publicPanel");
const publicList = document.getElementById("publicList");

// Built on first use, not at parse time. Constructing these eagerly meant a
// missing Bootstrap threw here and aborted the rest of the file, so the recipe
// list never rendered — an app that looked empty rather than broken.
const modals = {};
export function modal(id) {
  if (!modals[id]) modals[id] = new bootstrap.Modal(document.getElementById(id));
  return modals[id];
}

// --- Status banner ---
// Replaces alert(): non-blocking, and somewhere for sync to report into.
// Problems stay until dismissed; confirmations clear themselves.
const BANNER_CLASSES = {
  info: "alert-info", success: "alert-success",
  warning: "alert-warning", error: "alert-danger"
};
let bannerTimer = null;

export function notify(message, kind = "info") {
  clearTimeout(bannerTimer);
  bannerText.textContent = message;
  banner.className = `alert alert-dismissible ${BANNER_CLASSES[kind] || BANNER_CLASSES.info}`;
  if (kind === "info" || kind === "success") {
    bannerTimer = setTimeout(dismissBanner, 4000);
  }
}

export function dismissBanner() {
  clearTimeout(bannerTimer);
  banner.classList.add("d-none");
}

bannerClose.addEventListener("click", dismissBanner);

// --- Build identity ---
// Stamped with the commit SHA at deploy time by the sed in netlify.toml. Left as
// the literal placeholder when served straight off disk, which is how a local
// checkout tells itself apart from a deploy.
const RAW_BUILD_ID = "__BUILD_ID__";
const BUILD_ID = RAW_BUILD_ID.startsWith("__BUILD") ? "dev" : RAW_BUILD_ID.slice(0, 7);

// Recipe count goes in the footer too: phones have no devtools, so this is the
// only way to tell "storage was wiped" apart from "this device never had them".
function renderBuildStamp() {
  if (!buildStamp) return;
  buildStamp.textContent = store.broken
    ? `build ${BUILD_ID} · saved data unreadable, backed up`
    : `build ${BUILD_ID} · ${store.live().length} recipes on this device`;
}

// --- State that belongs to the view, not the data ---
let currentRecipeId = null;
// Which recipe the modal is editing, kept separate from which one is on screen.
// Overloading a single variable meant opening "Add" while a recipe was displayed
// silently disabled that recipe's own edit and delete buttons.
let editingId = null;
// A published recipe being viewed. Not in the store — it belongs to whoever
// published it — so it is held separately and rendered read-only.
let currentPublic = null;

// Whatever is on screen, private or public. Scaling works on either.
function activeRecipe() {
  return store.find(currentRecipeId) || currentPublic;
}

// --- Rendering ---

// One list, filtered by the search box. Previously a dropdown, a search box and
// a separate results panel all selected recipes, which meant three places to
// look and two of them hidden most of the time.
function renderRecipeList() {
  const keyword = searchInput.value.trim().toLowerCase();
  clearSearchBtn.classList.toggle("d-none", keyword === "");

  const all = store.live();
  const matches = keyword
    ? all.filter(r => r.name.toLowerCase().includes(keyword))
    : all;

  recipeList.innerHTML = "";
  matches
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(r => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "list-group-item list-group-item-action";
      item.classList.toggle("active", r.id === currentRecipeId);
      item.textContent = r.name;
      item.dataset.recipeId = r.id;
      item.onclick = () => {
        showRecipe(r.id);
        // The list is a fixed-height pane, so on a phone the recipe just tapped
        // opens below it. Only on a real tap: a sync or a save re-renders the
        // list too, and yanking the page then would be no-one's idea of helpful.
        recipeDisplay.scrollIntoView({ behavior: "smooth", block: "start" });
      };
      recipeList.appendChild(item);
    });

  // The list scrolls internally, so its length is no longer visible from the
  // page. Say how many there are, and how many the search is hiding.
  const total = all.length;
  // Pluralised on the total, not the match count, so a filtered list reads
  // "0 of 1 recipe" rather than "0 of 1 recipes".
  const noun = total === 1 ? "recipe" : "recipes";
  listMeta.textContent = total === 0 ? ""
    : keyword ? `${matches.length} of ${total} ${noun}`
    : `${total} ${noun}`;

  // Selecting from search, then clearing it, would otherwise leave the open
  // recipe scrolled out of sight inside the pane.
  const active = recipeList.querySelector(".active");
  if (active && recipeList.scrollHeight > recipeList.clientHeight) {
    active.scrollIntoView({ block: "nearest" });
  }

  // Distinguish "you have nothing" from "nothing matched", because the useful
  // next action is different in each case.
  const nothingToShow = matches.length === 0;
  emptyState.classList.toggle("d-none", !nothingToShow);
  recipeList.classList.toggle("d-none", nothingToShow);
  if (nothingToShow) {
    const searching = keyword !== "";
    emptyStateTitle.textContent = searching
      ? `No recipes match "${searchInput.value.trim()}"`
      : "No recipes yet";
    emptyStateHint.textContent = searching
      ? "Try a different word, or clear the search."
      : "Tap the + button to add your first one.";
  }
}

// Storage never calls rendering directly; it announces changes and the view
// reacts. That seam is what lets the sync layer mutate recipes safely.
onStoreChange(() => {
  renderRecipeList();
  renderBuildStamp();
});

function clearSearch() {
  searchInput.value = "";
  renderRecipeList();
}

// Rows are built with textContent, not innerHTML. Recipe text is user input, and
// with a public recipe list this stops being self-XSS and becomes stored XSS.
function renderIngredients(ingredients, factor = 1) {
  ingredientsList.innerHTML = "";
  ingredients.forEach(ing => {
    const li = document.createElement("li");
    li.className = "list-group-item";

    const text = document.createElement("span");
    text.className = "ingredient-text";
    text.textContent = formatIngredient(ing, factor);
    li.appendChild(text);

    // Show what it was before scaling, so the original is never lost from view.
    const hasAmount = ing.amount !== null && ing.amount !== undefined;
    if (factor !== 1 && hasAmount) {
      const original = document.createElement("span");
      original.className = "original-amount";
      original.textContent = `(was ${formatAmount(ing.amount, ing.unit)}${ing.unit ? " " + ing.unit : ""})`;
      li.appendChild(original);
    }

    ingredientsList.appendChild(li);
  });
}

// --- Scaling ---
// Applied from the recipe's stored amounts every time, so it never compounds.
function currentScaleFactor() {
  const r = activeRecipe();
  const desired = parseFloat(desiredServings.value);
  if (!r || !Number.isFinite(desired) || desired <= 0) return 1;
  if (!r.servings || r.servings <= 0) return 1;
  return desired / r.servings;
}

function renderScaledIngredients() {
  const r = activeRecipe();
  if (!r) return;

  const desired = parseFloat(desiredServings.value);
  const wantsScaling = Number.isFinite(desired) && desired > 0;

  // Recipes saved before servings were validated can hold null, which would
  // divide to Infinity and render "Infinity g flour".
  if (wantsScaling && (!r.servings || r.servings <= 0)) {
    scaleNote.textContent = `"${r.name}" has no original serving count — edit it and set one first.`;
    scaleNote.classList.remove("d-none");
    resetScaleBtn.classList.add("d-none");
    renderIngredients(r.ingredients);
    return;
  }

  const factor = currentScaleFactor();
  renderIngredients(r.ingredients, factor);

  const scaled = factor !== 1;
  resetScaleBtn.classList.toggle("d-none", !scaled);
  scaleNote.classList.toggle("d-none", !scaled);
  if (scaled) {
    scaleNote.textContent = `Scaled from ${r.servings} to ${formatAmount(desired)} servings `
      + `(×${formatAmount(factor)}).`;
  }
}

// Live, so there is no "did I press the button?" moment.
desiredServings.addEventListener("input", renderScaledIngredients);

resetScaleBtn.addEventListener("click", () => {
  desiredServings.value = "";
  renderScaledIngredients();
  desiredServings.focus();
});

function showRecipe(id) {
  const r = store.find(id);
  // The id can be stale — a recipe deleted on another device, or the list
  // rebuilt mid-interaction. Hide rather than throw.
  if (!r) {
    currentRecipeId = null;
    recipeDisplay.classList.add("d-none");
    renderRecipeList();
    return;
  }
  currentRecipeId = id;
  currentPublic = null;
  recipeName.textContent = r.name;
  originalServings.textContent = r.servings;
  publicByline.textContent = "";
  desiredServings.value = "";
  renderScaledIngredients();
  recipeDisplay.classList.remove("d-none");
  renderRecipeList();
  renderOwnershipControls();
}

// A published recipe is someone else's copy: viewable and scalable, never
// editable here. Only the buttons change; the rendering path is shared.
function showPublicRecipe(entry) {
  currentRecipeId = null;
  currentPublic = entry;
  recipeName.textContent = entry.name;
  originalServings.textContent = entry.servings;
  publicByline.textContent = entry.publishedBy ? ` · published by ${entry.publishedBy}` : "";
  desiredServings.value = "";
  renderScaledIngredients();
  recipeDisplay.classList.remove("d-none");
  renderRecipeList();
  renderOwnershipControls();
}

// Edit, delete and publish only make sense for your own recipes.
function renderOwnershipControls() {
  const recipe = store.find(currentRecipeId);
  const mine = !!recipe;
  editRecipeBtn.classList.toggle("d-none", !mine);
  deleteRecipeBtn.classList.toggle("d-none", !mine);

  const published = !!recipe?.publishedAs;
  // Publishing needs an identity, so these stay hidden until you sign in.
  const canPublish = mine && sync.signedIn();
  publishBtn.classList.toggle("d-none", !canPublish);
  unpublishBtn.classList.toggle("d-none", !canPublish || !published);
  // The public copy is a snapshot, so editing the private original leaves it
  // stale. Without this there would be no way to refresh it.
  publishBtn.textContent = published ? "🌍 Update public copy" : "🌍 Publish";
}

// --- Ingredient form rows ---
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

function addIngredientField(ingredient = { name: '', amount: '', unit: '' }) {
  const div = document.createElement('div');
  div.className = 'input-group mb-2 ingredient-row';
  // Carried on the row so an edit preserves ingredient identity. The instruction
  // grid will reference these ids, so regenerating them on every save would
  // silently detach steps from their ingredients.
  div.dataset.ingredientId = ingredient.id || newId();

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

addIngredientFieldBtn.addEventListener('click', () => addIngredientField());

// --- Add / edit ---

// These messages used to go to the page banner, which the modal backdrop covers:
// you could neither read the complaint nor dismiss it, and it was still sitting
// there after you had fixed the field it was complaining about.
function showRecipeError(message, field) {
  recipeError.textContent = message;
  recipeError.classList.remove("d-none");
  field.classList.add("is-invalid");
  field.focus();
}

function clearRecipeError() {
  recipeError.classList.add("d-none");
  recipeNameInput.classList.remove("is-invalid");
  servingsInput.classList.remove("is-invalid");
}

// Typing is the fix, so typing is what clears the complaint.
recipeNameInput.addEventListener("input", clearRecipeError);
servingsInput.addEventListener("input", clearRecipeError);

addRecipeBtn.addEventListener("click", () => {
  editingId = null;
  modalTitle.textContent = "Add Recipe";
  recipeNameInput.value = "";
  servingsInput.value = "";
  ingredientsFields.innerHTML = "";
  clearRecipeError();
  addIngredientField();
  modal("recipeModal").show();
});

editRecipeBtn.addEventListener("click", () => {
  const r = store.find(currentRecipeId);
  if (!r) return;
  editingId = r.id;
  modalTitle.textContent = "Edit Recipe";
  recipeNameInput.value = r.name;
  servingsInput.value = r.servings;
  ingredientsFields.innerHTML = "";
  clearRecipeError();
  r.ingredients.forEach(ing => addIngredientField(ing));
  if (r.ingredients.length === 0) addIngredientField();
  modal("recipeModal").show();
});

saveRecipeBtn.addEventListener("click", () => {
  const name = recipeNameInput.value.trim();
  const servings = parseFloat(servingsInput.value);

  // Both of these used to save silently: a blank name became an unlabelled row
  // in the dropdown, and a blank servings count became NaN, serialised to null,
  // and scaled to Infinity.
  if (!name) {
    showRecipeError("Give the recipe a name.", recipeNameInput);
    return;
  }
  if (!Number.isFinite(servings) || servings <= 0) {
    showRecipeError("Set how many servings this recipe makes.", servingsInput);
    return;
  }
  clearRecipeError();

  const ingredients = Array.from(ingredientsFields.querySelectorAll('.ingredient-row')).map(row => {
    const amount = parseFloat(row.querySelector('.ingredient-amount').value);
    return {
      id: row.dataset.ingredientId || newId(),
      name: row.querySelector('.ingredient-name').value.trim(),
      // null, not 0: a blank amount means "to taste", and 0 would scale an
      // ingredient to nothing.
      amount: Number.isFinite(amount) ? amount : null,
      unit: row.querySelector('.ingredient-unit').value
    };
  }).filter(ing => ing.name);

  if (store.find(editingId)) {
    store.update(editingId, { name, servings, ingredients });
  } else {
    // Show what was just added. Previously the dropdown was rebuilt and reset to
    // the placeholder, so a new recipe vanished the moment you saved it.
    currentRecipeId = store.create({ name, servings, ingredients }).id;
  }

  store.save();
  modal("recipeModal").hide();
  showRecipe(currentRecipeId);
  queueSync(currentRecipeId);
  editingId = null;
});

// --- Delete ---
deleteRecipeBtn.addEventListener("click", () => {
  const r = store.find(currentRecipeId);
  if (!r) return;
  deleteRecipeName.textContent = r.name;
  modal("deleteModal").show();
});

confirmDeleteBtn.addEventListener("click", () => {
  // Tombstoned, not spliced out. A removed entry looks identical to one that
  // never arrived, so another device holding the recipe would sync it back.
  const deletedId = currentRecipeId;
  if (!store.remove(deletedId)) return;

  currentRecipeId = null;
  store.save();
  // The tombstone itself must be uploaded, or the delete never reaches the
  // other devices.
  queueSync(deletedId);

  recipeDisplay.classList.add("d-none");
  renderRecipeList();
  modal("deleteModal").hide();
});

// --- Search ---
clearSearchBtn.addEventListener("click", () => {
  clearSearch();
  searchInput.focus();
});

searchInput.addEventListener("input", () => {
  renderRecipeList();

  // Hide the display if the recipe on screen is no longer in the filtered set,
  // so the list and the open recipe never disagree.
  const keyword = searchInput.value.trim();
  const current = store.find(currentRecipeId);
  if (current && keyword && !current.name.toLowerCase().includes(keyword.toLowerCase())) {
    recipeDisplay.classList.add("d-none");
    currentRecipeId = null;
  }
});

// --- Backup ---
exportBtn.addEventListener("click", () => {
  const payload = buildExportPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `recipes-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  notify(`Exported ${store.live().length} recipes.`, "success");
});

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
    const { added, updated, skipped } = store.merge(incoming);
    store.save();
    // Everything from the file needs uploading, not just the counts we report.
    incoming.forEach(r => queueSync(r.id));
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
  const deleted = store.deleted();
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
      store.restore(r.id);
      currentRecipeId = r.id;
      store.save();
      queueSync(r.id);
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

// --- Storage durability ---
// Asks the browser not to evict this origin's storage under pressure. Granted
// automatically for installed PWAs; on iOS Safari it is the difference between
// recipes surviving a quiet week and being deleted by ITP.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

// --- Service worker ---
// On localhost the build id is never substituted, so the cache name never changes
// and the worker would serve stale files after every edit — the exact "my changes
// don't show up" symptom this whole rewrite was fixing. Skip it locally and tear
// down any worker a previous session left behind. Append ?sw=1 to test offline.
const localDev = ["localhost", "127.0.0.1"].includes(location.hostname)
  && !new URLSearchParams(location.search).has("sw");

if (localDev && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then(regs => regs.forEach(r => r.unregister()))
    .then(() => caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))))
    .catch(() => {});
}

if (!localDev && "serviceWorker" in navigator && window.isSecureContext) {
  // No controller at load time means this is a first install, and the
  // controllerchange that follows is expected — reloading on it would give every
  // brand-new visitor a gratuitous refresh.
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

// --- Sync, identity and publishing ---

function renderAuthState() {
  if (sync.signedIn()) {
    authBtn.textContent = `Sign out (${sync.person})`;
    authBtn.className = "btn btn-sm btn-outline-secondary";
  } else {
    authBtn.textContent = "Sign in";
    authBtn.className = "btn btn-sm btn-outline-primary";
  }

  // A glyph plus words, because on a phone there is only room for the glyph and
  // the words are what pushed the header onto two lines.
  const waiting = sync.pending().length;
  let glyph = "", label = "";
  if (!sync.signedIn()) {
    glyph = "";
  } else if (waiting > 0 && sync.offline) {
    glyph = "⚠";
    label = `${waiting} not synced (offline)`;
  } else if (waiting > 0) {
    glyph = "↻";
    label = `${waiting} syncing…`;
  } else {
    glyph = "✓";
    label = "synced";
  }
  syncGlyph.textContent = glyph;
  syncLabel.textContent = label;
  // The only thing a screen reader or a long-press has to go on when the words
  // are hidden.
  syncStatus.title = label;
  syncStatus.setAttribute("aria-label", label);

  renderOwnershipControls();
}

function showAuthError(message) {
  authError.textContent = message;
  authError.classList.remove("d-none");
}

function hideAuthError() {
  authError.classList.add("d-none");
}

// Passphrases are long and typed on phone keyboards, so let people check what
// they typed. Resets to hidden every time the dialog opens.
function setPassphraseVisible(visible) {
  passphraseInput.type = visible ? "text" : "password";
  togglePassphrase.setAttribute("aria-pressed", String(visible));
  togglePassphrase.setAttribute("aria-label", visible ? "Hide passphrase" : "Show passphrase");
  togglePassphrase.textContent = visible ? "🙈" : "👁️";
}

togglePassphrase.addEventListener("click", () => {
  setPassphraseVisible(passphraseInput.type === "password");
  passphraseInput.focus();
});

authBtn.addEventListener("click", async () => {
  if (sync.signedIn()) {
    sync.signOut();
    renderAuthState();
    showRecipe(null);
    notify("Signed out. Your recipes are waiting when you sign back in.", "info");
    return;
  }
  passphraseInput.value = "";
  setPassphraseVisible(false);
  hideAuthError();
  modal("authModal").show();
});

passphraseInput.addEventListener("input", hideAuthError);

signInBtn.addEventListener("click", async () => {
  const passphrase = passphraseInput.value.trim();
  if (!passphrase) {
    showAuthError("Enter your passphrase.");
    return;
  }
  try {
    await sync.signIn(passphrase);
    hideAuthError();
    modal("authModal").hide();
    // Signing in swaps to this person's own recipes, so the view must be rebuilt
    // rather than left pointing at the previous person's recipe.
    showRecipe(null);
    await settleSignedOutRecipes();
    notify(`Signed in as ${sync.person}. Syncing…`, "success");
    await pullAndFlush();
  } catch (err) {
    showAuthError(signInErrorMessage(err));
  }
  renderAuthState();
});

// Recipes saved before signing in belong to whoever was using the device, not
// automatically to the account they happen to sign into. Resolves once the
// person has chosen.
function askAdoption(count, person) {
  return new Promise(resolve => {
    adoptCount.textContent = String(count);
    adoptPerson.textContent = person;
    adoptVerb.textContent = count === 1 ? "is" : "are";
    adoptNoun.textContent = count === 1 ? "recipe" : "recipes";

    const finish = choice => {
      adoptAddBtn.removeEventListener("click", onAdd);
      adoptKeepBtn.removeEventListener("click", onKeep);
      modal("adoptModal").hide();
      resolve(choice);
    };
    const onAdd = () => finish(true);
    const onKeep = () => finish(false);

    adoptAddBtn.addEventListener("click", onAdd);
    adoptKeepBtn.addEventListener("click", onKeep);
    modal("adoptModal").show();
  });
}

async function settleSignedOutRecipes() {
  if (!sync.signedIn() || store.hasNamespace(sync.person)) return;

  const count = store.signedOutCount();
  if (count === 0) {
    // Write an empty cookbook so this person counts as known and is not asked
    // again on every sign-in.
    store.save();
    return;
  }

  if (await askAdoption(count, sync.person)) {
    const added = store.adoptSignedOut(sync.person);
    notify(`Added ${added} recipe${added === 1 ? "" : "s"} to ${sync.person}'s cookbook.`,
           "success");
  } else {
    store.save();
    notify("Kept separate — they are still here when you sign out.", "info");
  }
  renderRecipeList();
}

// Says what actually went wrong and what still works, rather than a shrug.
function signInErrorMessage(err) {
  if (err.status === 401) return "That passphrase was not recognised.";
  if (!navigator.onLine) {
    return "You appear to be offline. Signing in needs a connection — recipes already "
         + "on this device still open and scale as normal. Try again once you reconnect.";
  }
  if (err.status === undefined) {
    return "Couldn't reach the server. It may be down, or your network may be blocking "
         + "it — some university and workplace networks block netlify.app. Recipes "
         + "already on this device are unaffected.";
  }
  return `The server replied with an error (${err.status}). Recipes already on this `
       + "device are unaffected; please try again shortly.";
}

async function pullAndFlush() {
  try {
    const merged = await sync.pull();
    const flushed = await sync.flush();
    if (merged.added || flushed.pushed) {
      notify(`Synced: ${merged.added} received, ${flushed.pushed} sent.`, "success");
    }
    if (flushed.superseded) {
      notify(`${flushed.superseded} recipe(s) were changed on another device; the newer version won.`,
             "warning");
    }
    if (flushed.failed) {
      notify(`${flushed.failed} change(s) could not be sent yet — they will retry.`, "warning");
    }
    if (currentRecipeId) showRecipe(currentRecipeId);
  } catch (err) {
    sync.offline = err.status === undefined;
    notify(navigator.onLine
      ? `Sync unavailable (${err.status ?? "no response"}). Your recipes still work here, `
        + "and changes will be sent when it comes back."
      : "You're offline. Your recipes still work here, and changes will be sent when "
        + "you reconnect.", "warning");
  }
  renderAuthState();
}

// Called after every local mutation. Fire-and-forget: the UI has already updated,
// and anything that fails stays in the outbox for the next attempt.
function queueSync(id) {
  if (!id) return;
  sync.record(id).then(renderAuthState).catch(() => renderAuthState());
}

// --- Publishing ---

publishBtn.addEventListener("click", async () => {
  const r = store.find(currentRecipeId);
  if (!r) return;
  // Confirm only the first time. Refreshing an already-public copy does not
  // change who can see it, so a warning would just be noise.
  if (r.publishedAs) {
    await doPublish(r, `"${r.name}" updated for everyone.`);
    return;
  }
  publishRecipeName.textContent = r.name;
  modal("publishModal").show();
});

async function doPublish(recipe, successMessage) {
  try {
    await sync.publish(recipe);
    notify(successMessage, "success");
  } catch (err) {
    notify(`Could not publish: ${err.message}`, "error");
  }
  renderOwnershipControls();
  renderAuthState();
}

confirmPublishBtn.addEventListener("click", async () => {
  const r = store.find(currentRecipeId);
  if (!r) return;
  modal("publishModal").hide();
  await doPublish(r, `"${r.name}" is now public. Your own copy is unchanged.`);
});

unpublishBtn.addEventListener("click", async () => {
  const r = store.find(currentRecipeId);
  if (!r) return;
  try {
    await sync.unpublish(r);
    notify(`"${r.name}" is no longer public.`, "success");
  } catch (err) {
    notify(`Could not unpublish: ${err.message}`, "error");
  }
  renderOwnershipControls();
  renderAuthState();
});

async function renderPublicList() {
  publicList.innerHTML = "";
  const loading = document.createElement("div");
  loading.className = "list-group-item text-muted";
  loading.textContent = "Loading…";
  publicList.appendChild(loading);

  let entries;
  try {
    entries = await sync.listPublic();
  } catch {
    publicList.innerHTML = "";
    const failed = document.createElement("div");
    failed.className = "list-group-item text-muted";
    failed.textContent = "Could not load public recipes.";
    publicList.appendChild(failed);
    return;
  }

  publicList.innerHTML = "";
  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "list-group-item text-muted";
    empty.textContent = "Nothing published yet.";
    publicList.appendChild(empty);
    return;
  }

  entries.forEach(entry => {
    const row = document.createElement("div");
    row.className = "list-group-item d-flex justify-content-between align-items-center gap-2";

    const open = document.createElement("button");
    open.className = "btn btn-link p-0 text-start flex-grow-1 public-open";
    open.textContent = `${entry.name} · by ${entry.publishedBy}`;
    open.onclick = () => showPublicRecipe(entry);
    row.appendChild(open);

    // Shown only to the publisher or the admin; the server enforces it too, so
    // hiding the button is convenience rather than the actual boundary.
    if (sync.canRemovePublic(entry)) {
      const remove = document.createElement("button");
      remove.className = "btn btn-sm btn-outline-danger public-remove";
      remove.textContent = "Remove";
      remove.onclick = async () => {
        try {
          await sync.removePublic(entry);
          notify(`Removed "${entry.name}" from public recipes.`, "success");
          renderPublicList();
        } catch (err) {
          notify(`Could not remove: ${err.message}`, "error");
        }
      };
      row.appendChild(remove);
    }

    publicList.appendChild(row);
  });
}

publicBtn.addEventListener("click", () => {
  publicPanel.classList.toggle("d-none");
  if (!publicPanel.classList.contains("d-none")) renderPublicList();
});

// Retry the outbox as soon as connectivity returns.
window.addEventListener("online", () => {
  sync.offline = false;
  if (sync.signedIn()) pullAndFlush();
});

// --- Theme ---
// Follows the system setting until the person chooses; after that their choice
// wins on this device.
const THEME_KEY = "theme";

function systemTheme() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark" : "light";
}

function activeTheme() {
  return localStorage.getItem(THEME_KEY) || systemTheme();
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-bs-theme", theme);
  themeBtn.textContent = theme === "dark" ? "☀️" : "🌙";
  themeBtn.setAttribute("aria-label",
    theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  // Keep the browser chrome in step with the page on mobile.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#212529" : "#e91e63");
}

themeBtn.addEventListener("click", () => {
  const next = activeTheme() === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});

// Track the system setting for as long as no explicit choice has been made.
if (window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!localStorage.getItem(THEME_KEY)) applyTheme(systemTheme());
  });
}

applyTheme(activeTheme());

// --- Init ---
// Load the remembered person's recipes straight away. Loading the signed-out set
// first and switching after the whoami round trip would briefly show the wrong
// person's cookbook.
store.useNamespace(localStorage.getItem("auth.person"));
renderRecipeList();
renderBuildStamp();
renderAuthState();

// Resume a previous session without prompting, then reconcile in the background.
// Nothing here blocks first paint.
sync.resume().then(async ok => {
  renderAuthState();
  if (!ok) return;
  // Also asked here, so someone who signed in on another device and only later
  // opens this one still gets the choice rather than a silent merge.
  await settleSignedOutRecipes();
  await pullAndFlush();
});

// Module scope is not global, so tests need a deliberate seam. DOM elements are
// still reachable as window.<id>; this exposes the behaviour.
window.__app = {
  store, sync, migrate, newId, SCHEMA_VERSION, buildExportPayload,
  activeStorageKey, showAuthError, hideAuthError, setPassphraseVisible,
  settleSignedOutRecipes, askAdoption, signInErrorMessage,
  showRecipe, showPublicRecipe, renderRecipeList, renderTrash, renderPublicList,
  renderAuthState, renderOwnershipControls, pullAndFlush,
  clearSearch, notify, dismissBanner, modal, addIngredientField, clearRecipeError,
  renderScaledIngredients, formatAmount, formatIngredient, applyTheme, activeTheme,
  get currentRecipeId() { return currentRecipeId; },
  get currentPublic() { return currentPublic; }
};
