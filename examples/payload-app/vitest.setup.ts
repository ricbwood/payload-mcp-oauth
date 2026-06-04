// Load .env files first (local dev), then fall back to test defaults so the
// integration test can boot Payload in CI without any external secrets.
import 'dotenv/config'

process.env.PAYLOAD_SECRET ||= 'integration-test-secret-32-chars-minimum'
// In-memory SQLite: fast, isolated per run, and leaves no .db file behind. The
// shared-cache form keeps a single in-memory DB across any connections Payload
// opens within the process.
process.env.DATABASE_URL ||= 'file::memory:?cache=shared'
