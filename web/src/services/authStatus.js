// Only an explicit rejection of the token should send a returning user to login.
export async function resolveAuthStatus(api) {
  const { configured } = await api.getAuthStatus();
  if (!configured) return "app";
  if (!api.getToken()) return "login";
  try {
    await api.checkSession();
    return "app";
  } catch (error) {
    if (error.status === 401) {
      api.setToken("");
      return "login";
    }
    throw error;
  }
}
