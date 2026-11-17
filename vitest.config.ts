import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // tools/* are standalone packages with their own dependencies and test runs;
    // .claude/ holds session worktrees (other copies of this repo), not tests of this checkout.
    exclude: [...configDefaults.exclude, "tools/**", ".claude/**"],
    // The API's dev fallback (no session → the dev user) for tests that don't sign in; tests of
    // sign-in pass `auth: { mode: 'required' }` to createApp. See server/auth.ts.
    env: { AUTH_MODE: "dev" },
  },
});
