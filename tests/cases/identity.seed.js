// Exactly the v1 shape: a bare array, no ids, no updatedAt, no deletedAt. This
// is what a browser that used the app before the schema change holds, so the
// migration path gets exercised for real on every test run.
localStorage.setItem("recipes", JSON.stringify([
  { name: "Alpha", servings: 4, ingredients: [
      { name: "flour", amount: 200, unit: "g" },
      { name: "salt", amount: null, unit: "" }] },
  { name: "Beta",  servings: 2, ingredients: [{ name: "milk", amount: 100, unit: "ml" }] },
  { name: "Gamma", servings: 8, ingredients: [{ name: "sugar", amount: 50, unit: "g" }] }
]));
