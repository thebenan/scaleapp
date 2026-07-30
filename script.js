// Local storage key
const STORAGE_KEY = "recipes";

// Guarded, because an unparseable value here used to throw before a single
// handler was attached — bricking the app with no way back. Stash the raw
// string rather than discarding it, so bad data is never silently destroyed.
let storageBroken = false;
function loadRecipes() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("saved value is not an array");
    return parsed;
  } catch (err) {
    console.error("Could not read saved recipes:", err);
    localStorage.setItem(`${STORAGE_KEY}.corrupt.${Date.now()}`, raw);
    storageBroken = true;
    return [];
  }
}

// State
let recipes = loadRecipes();
let currentRecipeIndex = null;

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

// Stamped with the commit SHA at deploy time by the sed in netlify.toml. Left
// as the literal placeholder when served straight off disk, which is how a
// local checkout tells itself apart from a deploy.
const RAW_BUILD_ID = "__BUILD_ID__";
const BUILD_ID = RAW_BUILD_ID.startsWith("__BUILD") ? "dev" : RAW_BUILD_ID.slice(0, 7);

// Recipe count goes in the footer too: phones have no devtools, so this is the
// only way to tell "storage was wiped" apart from "this device never had them".
const buildStamp = document.getElementById("buildStamp");
if (buildStamp) {
  buildStamp.textContent = storageBroken
    ? `build ${BUILD_ID} · saved data unreadable, backed up`
    : `build ${BUILD_ID} · ${recipes.length} recipes on this device`;
}

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

// Save state to localStorage
function saveRecipes() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes));
  renderRecipeList();
}

// Render dropdown list (always shows all recipes)
function renderRecipeList() {
  recipeSelect.innerHTML = `<option value="">-- Select recipe --</option>`;
  
  recipes.forEach((r, i) => {
    const option = document.createElement("option");
    option.value = i;
    option.textContent = r.name;
    recipeSelect.appendChild(option);
  });
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
    const filteredRecipes = recipes.filter(recipe => 
      recipe.name.toLowerCase().includes(filterKeyword.toLowerCase())
    );
    
    searchResults.classList.remove("d-none");
    searchResultsList.innerHTML = "";
    
    if (filteredRecipes.length === 0) {
      searchResultsList.innerHTML = '<div class="list-group-item">No recipes found</div>';
    } else {
      filteredRecipes.forEach((r) => {
        const originalIndex = recipes.indexOf(r);
        const item = document.createElement("div");
        item.className = "list-group-item list-group-item-action";
        item.textContent = r.name;
        item.onclick = () => {
          showRecipe(originalIndex);
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
function showRecipe(index) {
  currentRecipeIndex = index;
  const r = recipes[index];
  recipeName.textContent = r.name;
  originalServings.textContent = r.servings;
  desiredServings.value = "";
  renderIngredients(r.ingredients);
  recipeDisplay.classList.remove("d-none");
}

// Scale recipe
scaleBtn.addEventListener("click", () => {
  const desired = parseFloat(desiredServings.value);
  if (!desired || desired <= 0 || currentRecipeIndex === null) return;
  const r = recipes[currentRecipeIndex];
  // Recipes saved before servings were validated can hold null, which would
  // divide to Infinity and render "Infinity g flour".
  if (!r.servings || r.servings <= 0) {
    alert(`"${r.name}" has no original serving count — edit it and set one first.`);
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

// Add recipe button
addRecipeBtn.addEventListener("click", () => {
  currentRecipeIndex = null;
  modalTitle.textContent = "Add Recipe";
  recipeNameInput.value = "";
  servingsInput.value = "";
  ingredientsFields.innerHTML = "";
  addIngredientField();
  modal("recipeModal").show();
});

// Edit recipe button
editRecipeBtn.addEventListener("click", () => {
  if (currentRecipeIndex === null) return;
  const r = recipes[currentRecipeIndex];
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
    alert("Give the recipe a name.");
    return;
  }
  if (!Number.isFinite(servings) || servings <= 0) {
    servingsInput.focus();
    alert("Set how many servings this recipe makes.");
    return;
  }

  const ingredientRows = ingredientsFields.querySelectorAll('.ingredient-row');
  const ingredients = Array.from(ingredientRows).map(row => {
    const name = row.querySelector('.ingredient-name').value.trim();
    const amount = parseFloat(row.querySelector('.ingredient-amount').value);
    const unit = row.querySelector('.ingredient-unit').value;
    // null, not 0: a blank amount means "to taste", and 0 would scale an
    // ingredient to nothing.
    return { name, amount: Number.isFinite(amount) ? amount : null, unit };
  }).filter(ing => ing.name);

  const recipe = { name, servings, ingredients };

  if (currentRecipeIndex === null) {
    recipes.push(recipe);
  } else {
    recipes[currentRecipeIndex] = recipe;
  }

  saveRecipes();
  modal("recipeModal").hide();
  
  // If we were editing an existing recipe, refresh the display
  if (currentRecipeIndex !== null) {
    showRecipe(currentRecipeIndex);
  }
});

addIngredientFieldBtn.addEventListener('click', () => addIngredientField());

// Delete recipe
deleteRecipeBtn.addEventListener("click", () => {
  if (currentRecipeIndex === null) return;

  const r = recipes[currentRecipeIndex];
  deleteRecipeName.textContent = r.name;
  modal("deleteModal").show();
});

// Confirm delete
confirmDeleteBtn.addEventListener("click", () => {
  if (currentRecipeIndex === null) return;

  // Remove recipe, persist, and reset UI
  recipes.splice(currentRecipeIndex, 1);
  saveRecipes();

  currentRecipeIndex = null;
  recipeSelect.value = "";
  // keep the current search filter; list already re-rendered in saveRecipes()
  recipeDisplay.classList.add("d-none");
  modal("deleteModal").hide();
});

// Handle dropdown select
recipeSelect.addEventListener("change", e => {
  if (e.target.value) {
    showRecipe(parseInt(e.target.value));
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
  if (currentRecipeIndex !== null && keyword) {
    const currentRecipe = recipes[currentRecipeIndex];
    if (!currentRecipe.name.toLowerCase().includes(keyword.toLowerCase())) {
      recipeDisplay.classList.add("d-none");
      currentRecipeIndex = null;
      recipeSelect.value = "";
    }
  }
});

// Init
renderRecipeList();