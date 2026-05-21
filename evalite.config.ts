import { defineConfig } from "evalite/config";
import config from "./vitest.config";

export default defineConfig({
  viteConfig: config,
  // Memory extraction with xhigh reasoning can exceed Vitest's 30s default.
  testTimeout: 320_000,
});
