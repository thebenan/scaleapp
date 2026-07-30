// Two local recipes and no server data, which is the state every existing user
// is in the first time they sign in.
const now = Date.now();
localStorage.setItem("recipes", JSON.stringify({
  schemaVersion: 3,
  recipes: [
    { id: "local-1", name: "Local One", servings: 2, updatedAt: now, deletedAt: null,
      visibility: "private", owner: null, publishedAs: null,
      ingredients: [{ id: "i-1", name: "rice", amount: 100, unit: "g" }] },
    { id: "local-2", name: "Local Two", servings: 4, updatedAt: now, deletedAt: null,
      visibility: "private", owner: null, publishedAs: null,
      ingredients: [{ id: "i-2", name: "beans", amount: 200, unit: "g" }] }
  ]
}));
