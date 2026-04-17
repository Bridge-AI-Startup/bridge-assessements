/**
 * Default competition slug when the URL has no ?slug= (Framer landing links here with the same slug).
 * Must match the `slug` on your Competition document in MongoDB.
 *
 * Current challenge: link to assessment "Basic Python Program for Restaurant Order Processing" (Saaz).
 * Seed: npx tsx src/scripts/seedCompetition.ts <assessmentId> saaz-restaurant-python
 */
export const SINGLE_COMPETITION_SLUG = "saaz-restaurant-python";
