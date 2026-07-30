// Signed-out recipes, i.e. someone who used the app before ever signing in.
localStorage.setItem("recipes", JSON.stringify({
  schemaVersion: 3,
  recipes: [
    { id: "anon-1", name: "Built While Signed Out", servings: 2, updatedAt: Date.now(),
      deletedAt: null, visibility: "private", owner: null, publishedAs: null,
      ingredients: [{ id: "ai-1", name: "salt", amount: 5, unit: "g" }] }
  ]
}));
