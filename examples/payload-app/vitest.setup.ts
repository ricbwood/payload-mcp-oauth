// Load .env files first (local dev), then fall back to test defaults so the
// integration test can boot Payload in CI without any external secrets.
import 'dotenv/config'

process.env.PAYLOAD_SECRET ||= 'integration-test-secret-32-chars-minimum'
process.env.DATABASE_URL ||= 'file:./int-test.db'
