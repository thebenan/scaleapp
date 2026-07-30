// One recipe carries an XSS payload in its name, a double quote in an
// ingredient name, and a null amount ("to taste") — the three inputs that used
// to break rendering or the edit form.
localStorage.setItem("recipes", JSON.stringify([
  { name: "Pancakes", servings: 4, ingredients: [
      { name: "flour", amount: 200, unit: "g" },
      { name: "milk", amount: 300, unit: "ml" },
      { name: "salt", amount: null, unit: "" }
  ]},
  { name: "<img src=x onerror=window.__XSS=1>", servings: 2, ingredients: [
      { name: 'quote"name', amount: 1, unit: "cup" }
  ]}
]));
