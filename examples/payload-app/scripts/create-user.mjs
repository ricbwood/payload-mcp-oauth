import { getPayload } from 'payload'
import config from '../src/payload.config.ts'

const email = process.env.SEED_EMAIL
const password = process.env.SEED_PASSWORD

if (!email || !password) {
  console.error('SEED_EMAIL and SEED_PASSWORD env vars are required')
  process.exit(1)
}

const payload = await getPayload({ config })

try {
  const existing = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
  })

  if (existing.docs.length > 0) {
    await payload.update({
      collection: 'users',
      id: existing.docs[0].id,
      data: { password },
    })
    console.log(`Updated password for ${email}`)
  } else {
    await payload.create({
      collection: 'users',
      data: { email, password },
    })
    console.log(`Created user ${email}`)
  }
} finally {
  process.exit(0)
}
