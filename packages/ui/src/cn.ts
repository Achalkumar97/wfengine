import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes safely for `@wfengine/ui` + consumer Tailwind builds. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
