import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // tools/* are standalone packages with their own dependencies and test runs;
    // .claude/ holds session worktrees (other copies of this repo), not tests of this checkout.
    exclude: [...configDefaults.exclude, "tools/**", ".claude/**"],
  },
});
