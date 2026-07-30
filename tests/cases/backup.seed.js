// Two live recipes and one already-deleted one, so the export can be checked
// for carrying tombstones and the trash view for listing them.
const now = Date.now();
localStorage.setItem("recipes", JSON.stringify({
  schemaVersion: 3,
  recipes: [
    { id: "r-keep", name: "Keeper", servings: 2, updatedAt: now, deletedAt: null,
      visibility: "private", owner: null, publishedAs: null,
      ingredients: [{ id: "i-1", name: "rice", amount: 100, unit: "g" }] },
    { id: "r-edit", name: "Editable", servings: 4, updatedAt: now, deletedAt: null,
      visibility: "private", owner: null, publishedAs: null,
      ingredients: [{ id: "i-2", name: "beans", amount: 200, unit: "g" }] },
    { id: "r-gone", name: "Deleted One", servings: 1, updatedAt: now,
      deletedAt: now - 1000, visibility: "private", owner: null, publishedAs: null,
      ingredients: [{ id: "i-3", name: "kale", amount: 50, unit: "g" }] }
  ]
}));
