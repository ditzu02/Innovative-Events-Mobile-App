const envApiBaseUrl = process.env.EXPO_PUBLIC_API_URL?.trim() ?? "";
const envUserId = process.env.EXPO_PUBLIC_USER_ID?.trim() ?? "";

if (!envApiBaseUrl) {
  console.warn(
    "EXPO_PUBLIC_API_URL is not set. Set it to your backend base URL (e.g., http://localhost:5000). Falling back to empty string will break network calls."
  );
}

if (!envUserId) {
  console.warn(
    "EXPO_PUBLIC_USER_ID is not set. Saved events will be disabled until you set a user id."
  );
}

export const API_BASE_URL = envApiBaseUrl;
export const USER_ID = envUserId;
