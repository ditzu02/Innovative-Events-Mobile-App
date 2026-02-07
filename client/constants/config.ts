const envApiBaseUrl = process.env.EXPO_PUBLIC_API_URL?.trim() ?? "";

if (!envApiBaseUrl) {
  console.warn(
    "EXPO_PUBLIC_API_URL is not set. Set it to your backend base URL (e.g., http://localhost:5000). Falling back to empty string will break network calls."
  );
}

export const API_BASE_URL = envApiBaseUrl;
