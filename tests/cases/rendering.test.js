// Rendering, scaling, escaping and input validation.

check("the list shows both recipes", recipeList.children.length === 2,
      "items=" + recipeList.children.length);
check("empty state is hidden when there are recipes",
      emptyState.classList.contains("d-none"));
check("the list says how many recipes there are", listMeta.textContent === "2 recipes",
      listMeta.textContent);
check("footer shows recipe count", /2 recipes/.test(buildStamp.textContent),
      buildStamp.textContent);

// Unscaled render, including "to taste" for a null amount.
showRecipe(store.recipes[0].id);
const rows = [...ingredientsList.children].map(li => li.querySelector('.ingredient-text').textContent);
check("renders unscaled amounts", rows[0] === "200 g flour", rows[0]);
check("null amount omits the number", rows[2] === "salt", JSON.stringify(rows[2]));

// Scaling 4 -> 6 servings.
desiredServings.value = "6";
desiredServings.dispatchEvent(new Event("input"));
const scaled = [...ingredientsList.children].map(li => li.querySelector('.ingredient-text').textContent);
check("scales by servings ratio", scaled[0] === "300 g flour", scaled[0]);
check("strips trailing zeros", scaled[1] === "450 ml milk", scaled[1]);
check("null amount still omits number", scaled[2] === "salt", JSON.stringify(scaled[2]));

// Scaling must not compound when clicked repeatedly.
desiredServings.dispatchEvent(new Event("input"));
desiredServings.dispatchEvent(new Event("input"));
check("scaling is not cumulative",
      [...ingredientsList.children][0].querySelector('.ingredient-text').textContent === "300 g flour",
      [...ingredientsList.children][0].querySelector('.ingredient-text').textContent);

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
// so inside the dialog. The page-level banner sits behind the modal backdrop,
// where the message can be neither read nor dismissed.
dismissBanner();
const before = store.recipes.length;
recipeNameInput.value = "";
servingsInput.value = "";
saveRecipeBtn.click();
check("blank name blocks save",
      store.recipes.length === before && /name/i.test(recipeError.textContent),
      recipeError.textContent);
check("the complaint is visible", !recipeError.classList.contains("d-none"),
      recipeError.className);
check("the complaint lives inside the dialog",
      recipeError.closest("#recipeModal") !== null);
check("the offending field is marked", recipeNameInput.classList.contains("is-invalid"));
check("validation never touches the page banner",
      banner.classList.contains("d-none"), banner.className);

// Typing is the fix, so typing clears the complaint. It used to sit there
// accusing you of a blank field you had already filled in.
recipeNameInput.value = "Soup";
recipeNameInput.dispatchEvent(new Event("input"));
check("typing clears the complaint", recipeError.classList.contains("d-none"));
check("typing unmarks the field", !recipeNameInput.classList.contains("is-invalid"));

saveRecipeBtn.click();
check("blank servings blocks save",
      store.recipes.length === before && /servings/i.test(recipeError.textContent),
      recipeError.textContent);
check("the servings field is marked", servingsInput.classList.contains("is-invalid"));

servingsInput.value = "4";
servingsInput.dispatchEvent(new Event("input"));
saveRecipeBtn.click();
check("a corrected form saves", recipeName.textContent === "Soup", recipeName.textContent);
check("editing does not add a recipe", store.recipes.length === before,
      store.recipes.length + " vs " + before);
check("no complaint left over after a save", recipeError.classList.contains("d-none"));

// The page banner keeps its own rule: a warning must not disappear on its own
// the way a confirmation does, and must go when dismissed.
notify("something needs your attention", "warning");
check("a warning banner stays up", !banner.classList.contains("d-none"), banner.className);
dismissBanner();
check("banner dismisses", banner.classList.contains("d-none"));

// A recipe stored before servings were validated must warn, not divide by zero.
store.recipes.push({ id: "legacy-id", name: "Legacy", servings: null, deletedAt: null,
               updatedAt: Date.now(),
               ingredients: [{ id: "legacy-ing", name: "x", amount: 1, unit: "g" }] });
showRecipe("legacy-id");
desiredServings.value = "2";
desiredServings.dispatchEvent(new Event("input"));
check("no-servings recipe warns instead of Infinity",
      /serving count/i.test(scaleNote.textContent)
        && !scaleNote.classList.contains("d-none")
        && !ingredientsList.textContent.includes("Infinity"),
      scaleNote.textContent + " | " + ingredientsList.textContent);

// --- a collection that outgrows the screen ---
// The list used to grow without bound, so with 20+ recipes the open recipe was
// pushed a screenful down the page.
const wasHigh = recipeList.offsetHeight;
for (let i = 0; i < 30; i++) {
  store.create({ name: `Filler ${String(i).padStart(2, "0")}`, servings: 2, ingredients: [] });
}
store.save();
check("every recipe is still in the list", recipeList.children.length === 33,
      String(recipeList.children.length));
check("the list is capped rather than endless",
      recipeList.offsetHeight <= window.innerHeight * 0.5,
      recipeList.offsetHeight + "px vs viewport " + window.innerHeight + "px");
check("the capped list scrolls its overflow",
      recipeList.scrollHeight > recipeList.clientHeight,
      recipeList.scrollHeight + " > " + recipeList.clientHeight);
check("thirty more recipes did not lengthen the page much",
      recipeList.offsetHeight - wasHigh < window.innerHeight * 0.5,
      wasHigh + "px -> " + recipeList.offsetHeight + "px");
check("the count reflects the whole collection", /33 recipes/.test(listMeta.textContent),
      listMeta.textContent);

searchInput.value = "Filler 0";
searchInput.dispatchEvent(new Event("input"));
check("the count reports the filtered subset", listMeta.textContent === "10 of 33 recipes",
      listMeta.textContent);
clearSearch();

// --- the header must stay on one row ---
// The controls used to wrap underneath the title as soon as a signed-in name
// made the row too wide. The viewport cannot be resized from in here, so the
// navbar is squeezed directly — on the navbar rather than on <body>, because
// Bootstrap leaves a scrollbar-compensating padding on <body> after a modal and
// that would silently eat 15px of the width under test.
const brandEl = document.querySelector(".navbar-brand");
const navbar = document.querySelector(".navbar");
const onOneRow = () => headerActions.offsetTop < brandEl.offsetTop + brandEl.offsetHeight;
const geometry = () => "brand " + brandEl.offsetTop + "+" + brandEl.offsetHeight
      + " vs actions " + headerActions.offsetTop
      + ", nav " + navbar.scrollWidth + "/" + navbar.clientWidth;

authBtn.textContent = "Sign out (benan)";
// Media queries key off the viewport, which stays at the headless default, so
// the two things the <576px rules change are applied by hand: the smaller brand
// and the hidden sync wording.
syncLabel.textContent = "";
brandEl.style.fontSize = "1rem";
navbar.style.width = "360px";
check("a signed-in header fits on one row at phone width", onOneRow(), geometry());
check("nothing has to be truncated in the ordinary case",
      authBtn.scrollWidth <= authBtn.clientWidth + 1 && brandEl.scrollWidth <= brandEl.clientWidth + 1,
      "auth " + authBtn.scrollWidth + "/" + authBtn.clientWidth
        + ", brand " + brandEl.scrollWidth + "/" + brandEl.clientWidth);

// A long name on a narrow phone must truncate the title, never wrap the row and
// never push the bar wider than the screen.
authBtn.textContent = "Sign out (christopher)";
navbar.style.width = "320px";
check("a long name still does not wrap the header", onOneRow(), geometry());
check("and does not overflow it sideways",
      navbar.scrollWidth <= navbar.clientWidth + 1, geometry());
check("the title is what gave up the space",
      brandEl.scrollWidth > brandEl.clientWidth,
      brandEl.scrollWidth + " vs " + brandEl.clientWidth);
check("the 🍳 survives the squeeze", brandEl.clientWidth >= 16,
      String(brandEl.clientWidth));

navbar.style.width = "";
brandEl.style.fontSize = "";
renderAuthState();
