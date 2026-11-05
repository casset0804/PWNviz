import { defineConfig } from "vitest/config";

/**
 * Dedicated test config: unit tests are pure TypeScript and do not need the
 * Tailwind/Vite plugin graph. Keeping them separate means `npm test` works on
 * Windows and in WSL without loading a platform-specific native binding, while
 * `vite.config.ts` stays authoritative for the actual application build.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    pool: "threads",
  },
});
