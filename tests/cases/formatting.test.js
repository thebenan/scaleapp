// Amount formatting, live scaling, empty states and theming.

// --- fractions, for units people measure with spoons and cups ---
check("a third of a teaspoon is a fraction", formatAmount(1 / 3, "tsp") === "⅓",
      formatAmount(1 / 3, "tsp"));
check("a half cup", formatAmount(0.5, "cup") === "½", formatAmount(0.5, "cup"));
check("mixed number keeps the whole part", formatAmount(2.25, "cup") === "2¼",
      formatAmount(2.25, "cup"));
check("two thirds", formatAmount(2 / 3, "tbsp") === "⅔", formatAmount(2 / 3, "tbsp"));
check("three quarters", formatAmount(0.75, "cup") === "¾", formatAmount(0.75, "cup"));
check("an eighth", formatAmount(0.125, "tsp") === "⅛", formatAmount(0.125, "tsp"));
check("whole numbers stay plain", formatAmount(2, "cup") === "2", formatAmount(2, "cup"));
check("no trailing .00", formatAmount(2.0, "cup") === "2", formatAmount(2.0, "cup"));

// Near-misses snap; genuine in-betweens do not, or the number would be a lie.
check("just under a whole rounds up", formatAmount(1.995, "cup") === "2",
      formatAmount(1.995, "cup"));
check("just over a whole rounds down", formatAmount(2.005, "cup") === "2",
      formatAmount(2.005, "cup"));
check("0.31 does not become a third", formatAmount(0.31, "cup") === "0.31",
      formatAmount(0.31, "cup"));

// --- weights stay decimal ---
// "133⅓ g" is worse than "133 g", and no scale measures a third of a gram.
check("grams are not fractionalised", formatAmount(133.333, "g") === "133",
      formatAmount(133.333, "g"));
check("millilitres are not fractionalised", formatAmount(0.5, "ml") === "0.5",
      formatAmount(0.5, "ml"));
check("large weights round to whole numbers", formatAmount(350.4, "g") === "350",
      formatAmount(350.4, "g"));
check("mid-range weights keep one decimal", formatAmount(12.34, "g") === "12.3",
      formatAmount(12.34, "g"));
check("small weights keep two decimals", formatAmount(1.239, "g") === "1.24",
      formatAmount(1.239, "g"));

// --- edge cases ---
check("null renders as nothing", formatAmount(null) === "", JSON.stringify(formatAmount(null)));
check("undefined renders as nothing", formatAmount(undefined) === "");
check("NaN renders as nothing", formatAmount(NaN) === "");
check("zero stays zero", formatAmount(0, "cup") === "0", formatAmount(0, "cup"));

check("an ingredient with no amount is just its name",
      formatIngredient({ name: "salt", amount: null, unit: "" }) === "salt",
      formatIngredient({ name: "salt", amount: null, unit: "" }));
check("an ingredient with no unit omits the gap",
      formatIngredient({ name: "eggs", amount: 2, unit: "" }) === "2 eggs",
      formatIngredient({ name: "eggs", amount: 2, unit: "" }));

// --- live, non-destructive scaling ---
showRecipe("f-1");
const textOf = () => [...ingredientsList.children]
  .map(li => li.querySelector(".ingredient-text").textContent);

check("unscaled by default", textOf()[0] === "200 g flour", textOf()[0]);
check("no reset button before scaling", resetScaleBtn.classList.contains("d-none"));
check("no scale note before scaling", scaleNote.classList.contains("d-none"));

// 4 -> 6 servings is ×1.5, which turns 1 tsp into 1½ tsp.
desiredServings.value = "6";
desiredServings.dispatchEvent(new Event("input"));
check("scaling happens on input, with no button press", textOf()[0] === "300 g flour",
      textOf()[0]);
check("spoons scale into fractions", textOf()[1] === "1½ tsp baking powder", textOf()[1]);
check("cups scale into fractions", textOf()[2] === "1½ cup milk", textOf()[2]);
check("to-taste ingredients are left alone", textOf()[3] === "salt", textOf()[3]);

// The original must stay visible: scaling used to be a one-way door.
const originals = [...ingredientsList.querySelectorAll(".original-amount")]
  .map(el => el.textContent);
check("the original amount is still shown", originals[0] === "(was 200 g)", originals[0]);
check("to-taste rows have no 'was'", originals.length === 3, String(originals.length));
check("reset button appears while scaled", !resetScaleBtn.classList.contains("d-none"));
// The multiplier is formatted the same way as the amounts, so it reads ×1½.
check("the note names both serving counts and the factor",
      /from 4 to 6/.test(scaleNote.textContent) && /×1½/.test(scaleNote.textContent),
      scaleNote.textContent);

resetScaleBtn.click();
check("reset restores the original amounts", textOf()[0] === "200 g flour", textOf()[0]);
check("reset hides the originals",
      ingredientsList.querySelectorAll(".original-amount").length === 0);
check("reset hides its own button", resetScaleBtn.classList.contains("d-none"));

// A third of a recipe is the classic case for fractions.
desiredServings.value = "1";
desiredServings.dispatchEvent(new Event("input"));
check("scaling down gives cooking fractions", textOf()[1] === "¼ tsp baking powder",
      textOf()[1]);
check("grams scale down as decimals", textOf()[0] === "50 g flour", textOf()[0]);

// --- empty states ---
searchInput.value = "definitely-not-a-recipe";
searchInput.dispatchEvent(new Event("input"));
check("no matches shows the empty state", !emptyState.classList.contains("d-none"));
check("the empty state quotes the search term",
      emptyStateTitle.textContent.includes("definitely-not-a-recipe"),
      emptyStateTitle.textContent);
check("the no-match hint suggests clearing", /clear/i.test(emptyStateHint.textContent),
      emptyStateHint.textContent);

clearSearch();
check("clearing brings the list back", !recipeList.classList.contains("d-none"));

// With no recipes at all the message must be different — the useful next action
// is "add one", not "search for something else".
store.recipes.forEach(r => store.remove(r.id));
store.save();
check("no recipes at all shows a different message",
      /no recipes yet/i.test(emptyStateTitle.textContent), emptyStateTitle.textContent);
check("the first-run hint points at the add button", /\+/.test(emptyStateHint.textContent),
      emptyStateHint.textContent);

// --- theme ---
applyTheme("dark");
check("dark theme is applied to the document",
      document.documentElement.getAttribute("data-bs-theme") === "dark");
check("the toggle offers the other direction", themeBtn.textContent === "☀️",
      themeBtn.textContent);
check("theme-color meta follows the theme",
      document.querySelector('meta[name="theme-color"]').getAttribute("content") === "#212529",
      document.querySelector('meta[name="theme-color"]').getAttribute("content"));

// With no stored choice the theme follows the system, which differs between
// machines and CI runners. Stub matchMedia so this asserts our logic rather than
// whatever the environment happens to prefer.
const realMatchMedia = window.matchMedia;
const stubScheme = dark => {
  window.matchMedia = query => ({
    matches: dark && query.includes("dark"),
    media: query,
    addEventListener() {}, removeEventListener() {}
  });
};

localStorage.removeItem("theme");
stubScheme(true);
check("with no stored choice, a dark system gives a dark theme", activeTheme() === "dark",
      activeTheme());
stubScheme(false);
check("with no stored choice, a light system gives a light theme", activeTheme() === "light",
      activeTheme());

// An explicit choice must win over the system setting, even a contradicting one.
localStorage.setItem("theme", "dark");
stubScheme(false);
check("a stored choice overrides the system setting", activeTheme() === "dark", activeTheme());

// Toggling from a known stored state, so the result does not depend on the host.
applyTheme("dark");
themeBtn.click();
check("clicking toggles to light",
      document.documentElement.getAttribute("data-bs-theme") === "light",
      document.documentElement.getAttribute("data-bs-theme"));
check("the choice is remembered", localStorage.getItem("theme") === "light",
      String(localStorage.getItem("theme")));
check("activeTheme reports the stored choice", activeTheme() === "light", activeTheme());

themeBtn.click();
check("clicking again toggles back to dark",
      document.documentElement.getAttribute("data-bs-theme") === "dark",
      document.documentElement.getAttribute("data-bs-theme"));

window.matchMedia = realMatchMedia;
