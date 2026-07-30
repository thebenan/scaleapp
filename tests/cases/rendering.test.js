// Rendering, scaling, escaping and input validation.

check("dropdown lists both recipes", recipeSelect.options.length === 3,
      "options=" + recipeSelect.options.length);
check("footer shows recipe count", /2 recipes/.test(buildStamp.textContent),
      buildStamp.textContent);

// Unscaled render, including "to taste" for a null amount.
showRecipe(store.recipes[0].id);
const rows = [...ingredientsList.children].map(li => li.textContent);
check("renders unscaled amounts", rows[0] === "200 g flour", rows[0]);
check("null amount omits the number", rows[2] === "salt", JSON.stringify(rows[2]));

// Scaling 4 -> 6 servings.
desiredServings.value = "6";
scaleBtn.click();
const scaled = [...ingredientsList.children].map(li => li.textContent);
check("scales by servings ratio", scaled[0] === "300 g flour", scaled[0]);
check("strips trailing zeros", scaled[1] === "450 ml milk", scaled[1]);
check("null amount still omits number", scaled[2] === "salt", JSON.stringify(scaled[2]));

// Scaling must not compound when clicked repeatedly.
scaleBtn.click();
scaleBtn.click();
check("scaling is not cumulative",
      [...ingredientsList.children][0].textContent === "300 g flour",
      [...ingredientsList.children][0].textContent);

// A recipe name is user input and must never become markup.
showRecipe(store.recipes[1].id);
check("recipe name not executed", window.__XSS === undefined);
check("recipe name rendered as text", recipeName.textContent.includes("<img"),
      recipeName.textContent);
check("no injected img element",
      document.querySelectorAll("#recipeDisplay img").length === 0);

// A double quote used to break out of the value="" attribute in the edit form.
editRecipeBtn.click();
const firstName = ingredientsFields.querySelector(".ingredient-name").value;
check("quote in name survives edit form", firstName === 'quote"name', firstName);

// Validation: blank name and blank servings must each block the save, and say
// so in the banner rather than in a blocking alert().
const before = store.recipes.length;
recipeNameInput.value = "";
servingsInput.value = "";
saveRecipeBtn.click();
check("blank name blocks save",
      store.recipes.length === before && /name/i.test(bannerText.textContent),
      bannerText.textContent);
check("warning banner is visible", !banner.classList.contains("d-none"),
      banner.className);
recipeNameInput.value = "Soup";
saveRecipeBtn.click();
check("blank servings blocks save",
      store.recipes.length === before && /servings/i.test(bannerText.textContent),
      bannerText.textContent);

// A warning must not disappear on its own the way a confirmation does.
dismissBanner();
check("banner dismisses", banner.classList.contains("d-none"));

// A recipe stored before servings were validated must warn, not divide by zero.
store.recipes.push({ id: "legacy-id", name: "Legacy", servings: null, deletedAt: null,
               updatedAt: Date.now(),
               ingredients: [{ id: "legacy-ing", name: "x", amount: 1, unit: "g" }] });
showRecipe("legacy-id");
desiredServings.value = "2";
scaleBtn.click();
check("no-servings recipe warns instead of Infinity",
      /serving count/i.test(bannerText.textContent)
        && !ingredientsList.textContent.includes("Infinity"),
      bannerText.textContent + " | " + ingredientsList.textContent);
