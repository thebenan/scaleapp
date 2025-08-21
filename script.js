// Local storage key
const STORAGE_KEY = "recipes";

// State
let recipes = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
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

const recipeModal = new bootstrap.Modal(document.getElementById("recipeModal"));
const deleteModal = new bootstrap.Modal(document.getElementById("deleteModal"));
const modalTitle = document.getElementById("modalTitle");
const recipeNameInput = document.getElementById("recipeNameInput");
const servingsInput = document.getElementById("servingsInput");
const ingredientsFields = document.getElementById("ingredientsFields");
const addIngredientFieldBtn = document.getElementById("addIngredientFieldBtn");
const saveRecipeBtn = document.getElementById("saveRecipeBtn");
const deleteRecipeName = document.getElementById("deleteRecipeName");
const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");

// Register Service Worker only if protocol is http(s) or localhost
if (
  "serviceWorker" in navigator &&
  (location.protocol === "https:" ||
    location.protocol === "http:" ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1")
) {
  navigator.serviceWorker.register("/sw.js")
    .then(() => console.log("Service Worker registered"));
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

// Display selected recipe
function showRecipe(index) {
  currentRecipeIndex = index;
  const r = recipes[index];
  recipeName.textContent = r.name;
  originalServings.textContent = r.servings;
  desiredServings.value = "";
  ingredientsList.innerHTML = r.ingredients.map(ing =>
    `<li class="list-group-item">${ing.amount} ${ing.unit} ${ing.name}</li>`
  ).join("");
  recipeDisplay.classList.remove("d-none");
}

// Scale recipe
scaleBtn.addEventListener("click", () => {
  const desired = parseFloat(desiredServings.value);
  if (!desired || currentRecipeIndex === null) return;
  const r = recipes[currentRecipeIndex];
  ingredientsList.innerHTML = r.ingredients.map(ing => {
    const scaled = (ing.amount * desired / r.servings).toFixed(2);
    return `<li class="list-group-item">${scaled} ${ing.unit} ${ing.name}</li>`;
  }).join("");
});


// Predefined measurement units
const measurementUnits = [
  { value: '', text: 'Select unit' },
  // Weight units
  { value: 'g', text: 'g (grams)' },
  { value: 'kg', text: 'kg (kilograms)' },
  { value: 'oz', text: 'oz (ounces)' },
  { value: 'lb', text: 'lb (pounds)' },
  { value: 'lbs', text: 'lbs (pounds)' },
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
  
  // Create the unit dropdown options
  const unitOptions = measurementUnits.map(unit => 
    `<option value="${unit.value}" ${unit.value === (ingredient.unit || '') ? 'selected' : ''}>${unit.text}</option>`
  ).join('');
  
  div.innerHTML = `
    <input type="text" class="form-control ingredient-name" placeholder="Name" value="${ingredient.name || ''}">
    <input type="number" class="form-control ingredient-amount" placeholder="Amount" value="${ingredient.amount || ''}" min="0" step="any">
    <select class="form-select ingredient-unit" style="max-width: 150px;">
      ${unitOptions}
    </select>
    <button type="button" class="btn btn-outline-danger remove-ingredient-btn">&times;</button>
  `;
  div.querySelector('.remove-ingredient-btn').onclick = () => div.remove();
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
  recipeModal.show();
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
  recipeModal.show();
});

// Save recipe
saveRecipeBtn.addEventListener("click", () => {
  const name = recipeNameInput.value.trim();
  const servings = parseFloat(servingsInput.value);
  const ingredientRows = ingredientsFields.querySelectorAll('.ingredient-row');
  const ingredients = Array.from(ingredientRows).map(row => {
    const name = row.querySelector('.ingredient-name').value.trim();
    const amount = parseFloat(row.querySelector('.ingredient-amount').value);
    const unit = row.querySelector('.ingredient-unit').value; // This now gets value from select element
    return { name, amount: isNaN(amount) ? 0 : amount, unit };
  }).filter(ing => ing.name);

  const recipe = { name, servings, ingredients };

  if (currentRecipeIndex === null) {
    recipes.push(recipe);
  } else {
    recipes[currentRecipeIndex] = recipe;
  }

  saveRecipes();
  recipeModal.hide();
  
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
  deleteModal.show();
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
  deleteModal.hide();
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