import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Mask a 10-digit mobile for display/storage: 9876543221 -> 98xxxxxx21 */
export function maskMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, "").slice(-10);
  if (digits.length < 4) return "xxxxxxxxxx";
  return `${digits.slice(0, 2)}${"x".repeat(digits.length - 4)}${digits.slice(-2)}`;
}
