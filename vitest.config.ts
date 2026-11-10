import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // tools/* are standalone packages with their own dependencies and test runs.
    exclude: [...configDefaults.exclude, "tools/**"],
  },
});
