const envApiBaseUrl = process.env.EXPO_PUBLIC_API_URL?.trim() ?? "";
const envAdminEmails = process.env.EXPO_PUBLIC_ADMIN_EMAILS ?? "";

if (!envApiBaseUrl) {
  console.warn(
    "EXPO_PUBLIC_API_URL is not set. Set it to your backend base URL (e.g., http://localhost:5000). Falling back to empty string will break network calls."
  );
}

export const API_BASE_URL = envApiBaseUrl;

export const ADMIN_EMAIL_ALLOWLIST = envAdminEmails
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

export function isAdminEmail(email: string | null | undefined) {
  if (!email) return false;
  return ADMIN_EMAIL_ALLOWLIST.includes(email.trim().toLowerCase());
}
