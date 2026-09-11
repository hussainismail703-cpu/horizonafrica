/**
 * Normalize a phone number to a canonical format.
 *
 * 1. Strips all non-digit characters.
 * 2. Converts South African local format (leading "0" with 10 digits)
 *    to international format (leading "27").
 *
 * Examples:
 *   "0832763116"  → "27832763116"
 *   "+27 83 276 3116" → "27832763116"
 *   "27832763116" → "27832763116"
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  // South African local format: 10 digits starting with 0 (e.g. 0832763116)
  if (digits.length === 10 && digits.startsWith("0")) {
    return "27" + digits.slice(1);
  }
  return digits;
}
