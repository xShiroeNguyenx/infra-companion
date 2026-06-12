import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // argon2id pure-JS (19 MiB, t=2) chạy chậm trên CI yếu — nới timeout
    testTimeout: 30_000
  }
})
