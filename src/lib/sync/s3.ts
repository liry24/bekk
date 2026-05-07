import { destr } from 'destr'

import type { S3Destination, SyncBackend, SyncData } from './types'

/** Object key used inside the bucket for a given config file name. */
const CONFIG_KEY = 'bekk-sync.json'

export class S3Backend implements SyncBackend {
    readonly label: string
    private readonly client: InstanceType<typeof Bun.S3Client>

    constructor(dest: S3Destination, secretAccessKey: string) {
        this.label = dest.name
        this.client = new Bun.S3Client({
            bucket: dest.bucket,
            region: dest.region || 'us-east-1',
            endpoint: dest.endpoint || undefined,
            accessKeyId: dest.accessKeyId,
            secretAccessKey,
        })
    }

    async push(data: SyncData): Promise<string> {
        const body = JSON.stringify(data, null, 2)
        await this.client.write(CONFIG_KEY, body, { type: 'application/json' })
        // Return a human-readable reference
        return `s3://${this.label}/${CONFIG_KEY}`
    }

    async pull(_identifier?: string): Promise<SyncData> {
        const key = _identifier ?? CONFIG_KEY
        const text = await this.client.file(key).text()
        const parsed = destr<SyncData>(text)
        if (!parsed || typeof parsed !== 'object' || !parsed.config)
            throw new Error(`Invalid sync data in S3 bucket (${this.label}): ${key}`)

        return parsed
    }
}
