import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('docker compose image worker settings', () => {
  it('pins image worker concurrency to 1 for app service', () => {
    const composeText = readFileSync(resolve(process.cwd(), 'docker-compose.yml'), 'utf8')

    const imageConcurrencyMatch = composeText.match(/QUEUE_CONCURRENCY_IMAGE:\s*"?(\d+)"?/)

    expect(imageConcurrencyMatch?.[1]).toBe('1')
  })
})
