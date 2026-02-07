import * as SecureStore from "expo-secure-store";

const ACCESS_TOKEN_KEY = "access_token";
const REFRESH_TOKEN_KEY = "refresh_token";

let accessTokenCache: string | null | undefined;
let refreshTokenCache: string | null | undefined;

export async function getAccessToken() {
  if (accessTokenCache === undefined) {
    accessTokenCache = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  }
  return accessTokenCache;
}

export async function getRefreshToken() {
  if (refreshTokenCache === undefined) {
    refreshTokenCache = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  }
  return refreshTokenCache;
}

export async function setTokens(accessToken: string, refreshToken: string) {
  accessTokenCache = accessToken;
  refreshTokenCache = refreshToken;
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
}

export async function clearTokens() {
  accessTokenCache = null;
  refreshTokenCache = null;
  await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}
