localStorage.setItem("recipes", JSON.stringify({
  schemaVersion: 3,
  recipes: [
    { id: "mine-1", name: "My Cake", servings: 8, updatedAt: Date.now(), deletedAt: null,
      visibility: "private", owner: null, publishedAs: null,
      ingredients: [{ id: "i-1", name: "flour", amount: 300, unit: "g" }] }
  ]
}));
