import type { TranslationKey } from "./i18n";

const recoveryConflictError = "local document recovery conflict";
const invalidRecoveryManifestError = "local document recovery manifest is invalid";

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }
  return "";
}

export function localRecoveryErrorTranslationKey(error: unknown): TranslationKey | null {
  const message = errorMessage(error);
  if (message.includes(recoveryConflictError)) return "error.localRecoveryConflict";
  if (message.includes(invalidRecoveryManifestError)) {
    return "error.localRecoveryManifestInvalid";
  }
  return null;
}
