import { destr } from 'destr'

import type { S3Destination, SyncBackend, SyncData } from '#lib/types'

/** Object key used inside the bucket for a given config file name. */
const CONFIG_KEY = 'bekk-sync.json'

export const createS3Backend = (dest: S3Destination, secretAccessKey: string): SyncBackend => {
    const client = new Bun.S3Client({
        bucket: dest.bucket,
        region: dest.region || 'us-east-1',
        endpoint: dest.endpoint || undefined,
        accessKeyId: dest.accessKeyId,
        secretAccessKey,
    })

    return {
        label: dest.name,

        async push(data: SyncData): Promise<string> {
            const body = JSON.stringify(data, null, 2)
            await client.write(CONFIG_KEY, body, { type: 'application/json' })
            return `s3://${dest.name}/${CONFIG_KEY}`
        },

        async pull(_identifier?: string): Promise<SyncData> {
            const key = _identifier ?? CONFIG_KEY
            const text = await client.file(key).text()
            const parsed = destr<SyncData>(text)
            if (!parsed || typeof parsed !== 'object' || !parsed.config)
                throw new Error(`Invalid sync data in S3 bucket (${dest.name}): ${key}`)

            return parsed
        },
    }
}
