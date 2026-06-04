// Load .env files first (local dev), then fall back to test defaults so the
// integration test can boot Payload in CI without any external secrets.
import 'dotenv/config'

process.env.PAYLOAD_SECRET ||= 'integration-test-secret-32-chars-minimum'
// In-memory SQLite: fast, isolated per run, leaves no file. ':memory:' is the
// canonical identifier — it works with both the libSQL client (used here) and
// better-sqlite3 without needing URI parsing, and avoids ':'/'?' which are
// invalid in Windows paths. Payload uses one connection, so no shared cache.
process.env.DATABASE_URL ||= ':memory:'
