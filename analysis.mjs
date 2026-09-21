// Provisional interchange format only; no new database or retention policy.
export const ESTIMATE_NOTE = "写真からの概算です。実際の量・材料・調理法で変わります。";

function text(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function calories(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 10000
    ? Math.round(value) : null;
}

export function normalizeMealReport(result) {
  const min = calories(result.estimated_calories_min);
  const max = calories(result.estimated_calories_max);
  const validRange = min !== null && max !== null && min <= max;
  return {
    meal_name: text(result.meal_name, 120) || "食事",
    estimated_calories_min: validRange ? min : null,
    estimated_calories_max: validRange ? max : null,
    ingredients: Array.isArray(result.ingredients)
      ? [...new Set(result.ingredients.map(x => text(x, 60)).filter(Boolean))].slice(0, 8) : [],
    nutrition_balance: text(result.nutrition_balance, 300),
    comment: text(result.comment, 200),
    disclaimer: ESTIMATE_NOTE,
    image_scope: "first_saved_photo",
    is_estimate: true
  };
}

export function profileEntry(record, report = null) {
  const fields = {
    category_major: ["food", "life", "scene"],
    category_minor: ["ramen", "meat", "cafe", "work_site", "driving", "hobby", "other"],
    location_type: ["eatery", "work_site", "vehicle", "outdoor", "home"],
    companion_type: ["solo", "pair", "group"],
    price_range: ["under_1k", "1k_to_3k", "over_3k"],
    interest_tag: ["noodle_craft", "car_maintenance", "heavy_work", "sports_gear"]
  };
  return {
    schema_version: "profile-entry.v0",
    source: { record_id: record.record_id, recorded_at: record.created_at || null },
    // Existing AI classifications are observations, not verified personal traits.
    observations: Object.entries(fields).flatMap(([field, values]) =>
      values.includes(record[field]) ? [{ field, value: record[field], origin: "stored_ai_classification", verified: false }] : []),
    meal: record.category_major === "food" && report ? {
      origin: "on_demand_photo_analysis",
      image_scope: "first_saved_photo",
      is_estimate: true,
      ...normalizeMealReport(report)
    } : null
  };
}

// Count visible characters so emoji sequences are not cut in the middle.
export function normalizeXDraft(value) {
  const draft = typeof value === "string" ? value.trim() : "";
  const characters = [...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(draft)].map(x => x.segment);
  if (characters.length <= 130) return draft;
  return characters.slice(0, 129).join("").trimEnd() + "…";
}

// Both AI output and client-returned review metadata are unverified input.
export function normalizeDepositAnalysis(value) {
  const result = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const oneOf = (key, values, fallback) => values.includes(result[key]) ? result[key] : fallback;
  return {
    post_text: typeof result.post_text === "string" ? result.post_text.slice(0, 2000) : "記録しました。",
    category_major: oneOf("category_major", ["food", "life", "scene"], "life"),
    category_minor: oneOf("category_minor", ["ramen", "meat", "cafe", "work_site", "driving", "hobby", "other"], "other"),
    location_type: oneOf("location_type", ["eatery", "work_site", "vehicle", "outdoor", "home", "unknown"], "unknown"),
    companion_type: oneOf("companion_type", ["solo", "pair", "group", "unknown"], "unknown"),
    price_range: oneOf("price_range", ["under_1k", "1k_to_3k", "over_3k", "none"], "none"),
    interest_tag: oneOf("interest_tag", ["noodle_craft", "car_maintenance", "heavy_work", "sports_gear", "none"], "none")
  };
}
