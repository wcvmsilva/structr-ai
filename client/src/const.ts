export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// DEV-only flag to disable OAuth redirects and allow full local access
const DEV_DISABLE_OAUTH = true;

// Generate login URL at runtime so redirect URI reflects the current origin.
export const getLoginUrl = () => {
  // In dev mode, return a no-op hash to prevent redirects
  if (DEV_DISABLE_OAUTH) {
    return "#";
  }

  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};
