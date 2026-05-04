import { z } from "zod";

export const UpstreamValidationFailedSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  missingFields: z.array(z.string()),
  message: z.string(),
});

export type UpstreamValidationFailed = z.infer<typeof UpstreamValidationFailedSchema>;

export type ValidateRequiredFieldsResult =
  | { success: true }
  | {
      success: false;
      error: string;
      missingFields: string[];
      message: string;
    };

function formatMissingList(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0] ?? "";
  const last = names[names.length - 1];
  const rest = names.slice(0, -1);
  return `${rest.join(", ")} and ${last}`;
}

export type ValidateRequiredFieldsOptions = {
  /** Default short error title (default: `Missing required fields`). */
  error?: string;
  /**
   * When true (default), `""` and whitespace-only strings count as missing.
   */
  treatEmptyStringAsMissing?: boolean;
  /**
   * When true, empty arrays `[]` count as missing.
   * Default false so optional empty lists remain valid.
   */
  treatEmptyArrayAsMissing?: boolean;
  /** Custom message; defaults to a sentence listing missing keys. */
  buildMessage?: (missingFields: string[]) => string;
};

/**
 * Validates that `input` is a plain object containing non-empty values for
 * every key in `requiredFields`. Nested dotted paths are not supported (flat keys only).
 */
export function validateRequiredFields(
  input: unknown,
  requiredFields: readonly string[],
  options?: ValidateRequiredFieldsOptions,
): ValidateRequiredFieldsResult {
  if (requiredFields.length === 0) {
    return { success: true };
  }

  const treatEmptyStringAsMissing = options?.treatEmptyStringAsMissing ?? true;
  const treatEmptyArrayAsMissing = options?.treatEmptyArrayAsMissing ?? false;
  const errorTitle = options?.error ?? "Missing required fields";

  const obj =
    input !== null && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : null;

  const missing: string[] = [];
  for (const key of requiredFields) {
    if (!key.trim()) continue;
    const v = obj?.[key];
    if (v === undefined || v === null) {
      missing.push(key);
      continue;
    }
    if (typeof v === "string" && treatEmptyStringAsMissing && v.trim() === "") {
      missing.push(key);
      continue;
    }
    if (
      treatEmptyArrayAsMissing &&
      Array.isArray(v) &&
      v.length === 0
    ) {
      missing.push(key);
    }
  }

  if (missing.length === 0) {
    return { success: true };
  }

  const message =
    options?.buildMessage?.(missing) ??
    `Please provide ${formatMissingList(missing)} in the initial payload (upstream input).`;

  return {
    success: false,
    error: errorTitle,
    missingFields: missing,
    message,
  };
}
