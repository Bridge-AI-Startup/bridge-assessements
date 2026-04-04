/**
 * Normalise LLM JSON so schema parsing never fails with "Expected object, received array".
 * When the schema expects an object, the model sometimes returns an array (e.g. [{ "valid": true }]
 * or multiple items). We unwrap to the first object so Zod receives an object.
 */
export function unwrapObject(parsed: unknown): unknown {
  if (
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    parsed[0] !== null &&
    typeof parsed[0] === "object" &&
    !Array.isArray(parsed[0])
  ) {
    return parsed[0];
  }
  return parsed;
}
