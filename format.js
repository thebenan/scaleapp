// Turning scaled numbers back into something a cook would write down.
//
// "0.33 tsp" and "2.00 cups" are technically correct and useless in a kitchen.
// Nobody owns a 0.33 teaspoon.

const FRACTIONS = [
  [1 / 8, "⅛"], [1 / 4, "¼"], [1 / 3, "⅓"], [3 / 8, "⅜"], [1 / 2, "½"],
  [5 / 8, "⅝"], [2 / 3, "⅔"], [3 / 4, "¾"], [7 / 8, "⅞"]
];

// Units measured with spoons, cups and counting, where fractions are how people
// actually think. Weights and metric volumes are left as decimals — "133⅓ g" is
// worse than "133 g", and a scale can't measure a third of a gram anyway.
const FRACTIONAL_UNITS = new Set([
  "", "tsp", "tbsp", "cup", "pcs", "whole", "dozen", "pint", "quart", "gallon",
  "slice", "clove", "can", "bottle", "package", "bag", "pinch", "dash", "inch"
]);

// How close a value must be to a fraction before it is shown as one. Absolute,
// so it is at most a 2% slip of a single unit — invisible in cooking, while
// still keeping 0.31 from silently becoming a third.
const SNAP = 0.02;

function formatDecimal(value) {
  // More precision for small amounts than large ones: 0.25 g matters, 0.25 g in
  // 350 g does not.
  const magnitude = Math.abs(value);
  const decimals = magnitude >= 100 ? 0 : magnitude >= 10 ? 1 : 2;
  // Unary + drops trailing zeros, so 2.00 reads as 2 but 0.33 survives.
  return String(+value.toFixed(decimals));
}

export function formatAmount(value, unit = "") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  if (value === 0) return "0";
  if (value < 0) return formatDecimal(value);

  if (!FRACTIONAL_UNITS.has(unit)) return formatDecimal(value);

  const whole = Math.floor(value);
  const remainder = value - whole;

  const match = FRACTIONS.find(([size]) => Math.abs(remainder - size) < SNAP);
  if (match) return whole > 0 ? `${whole}${match[1]}` : match[1];

  // Close enough to a whole number that a fraction would be noise.
  if (remainder < SNAP) return String(whole);
  if (remainder > 1 - SNAP) return String(whole + 1);

  return formatDecimal(value);
}

// "300 g flour", or "flour" when the amount is null, meaning "to taste".
export function formatIngredient(ingredient, factor = 1) {
  const hasAmount = ingredient.amount !== null && ingredient.amount !== undefined;
  const amount = hasAmount ? `${formatAmount(ingredient.amount * factor, ingredient.unit)} ` : "";
  const unit = ingredient.unit ? `${ingredient.unit} ` : "";
  return `${amount}${unit}${ingredient.name}`;
}
