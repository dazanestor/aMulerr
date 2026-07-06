import { skipFalsy } from "./array"

export const allowedCategories = process.env.ALLOWED_CATEGORIES

export function isCategoryAllowed(categoryTitle: string) {
  if (!allowedCategories) {
    return true
  }

  return allowedCategories
    .split(",")
    .map(c => c.trim())
    .filter(skipFalsy)
    .includes(categoryTitle)
}
