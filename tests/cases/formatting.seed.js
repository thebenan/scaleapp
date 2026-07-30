localStorage.setItem("recipes", JSON.stringify({
  schemaVersion: 3,
  recipes: [
    { id: "f-1", name: "Pancakes", servings: 4, updatedAt: Date.now(), deletedAt: null,
      visibility: "private", owner: null, publishedAs: null,
      ingredients: [
        { id: "fi-1", name: "flour", amount: 200, unit: "g" },
        { id: "fi-2", name: "baking powder", amount: 1, unit: "tsp" },
        { id: "fi-3", name: "milk", amount: 1, unit: "cup" },
        { id: "fi-4", name: "salt", amount: null, unit: "" }
      ] }
  ]
}));
