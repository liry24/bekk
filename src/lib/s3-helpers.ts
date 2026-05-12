import { setS3SecretAccessKey } from '#lib/secrets'
import type { S3Destination } from '#lib/types'
import { cyan, dim, green, bold, input, password, writeString } from '#lib/ui'

export const validateUrl = (value: string): true | string => {
    const trimmed = value.trim()
    if (!trimmed) return true
    try {
        const url = new URL(trimmed)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return 'Endpoint must use http:// or https://'
        }
        return true
    } catch {
        return 'Invalid URL format'
    }
}

export const promptS3Destination = async (
    existingNames: string[],
): Promise<{ destination: S3Destination; secretAccessKey: string }> => {
    const defaultName = 's3'
    const name = await input({
        message: `  Name  ${dim('(used to identify this destination)')}`,
        placeholder: defaultName,
        validate: (v) => {
            if (!v.trim()) return 'Name is required'
            if (existingNames.some((n) => n === v.trim()))
                return 'A destination with this name already exists'
            return true
        },
    })

    const bucket = await input({
        message: `  Bucket  ${dim('(S3 bucket name)')}`,
        placeholder: name.trim(),
        validate: (v) => (v.trim() ? true : 'Bucket is required'),
    })

    const endpoint = await input({
        message: `  Endpoint  ${dim('(leave blank for AWS standard)')}`,
        placeholder: 'e.g. https://accountid.r2.cloudflarestorage.com',
        validate: validateUrl,
    })

    const region = await input({
        message: `  Region`,
        placeholder: 'us-east-1',
    })

    const accessKeyId = await input({
        message: `  Access Key ID`,
        validate: (v) => (v.trim() ? true : 'Access Key ID is required'),
    })

    const secretAccessKey = await password({
        message: `  Secret Access Key`,
        validate: (v) => (v.trim() ? true : 'Secret Access Key is required'),
    })

    const destination: S3Destination = {
        name: name.trim(),
        bucket: bucket.trim(),
        region: region.trim() || 'us-east-1',
        endpoint: endpoint.trim(),
        accessKeyId: accessKeyId.trim(),
    }

    writeString(green(`S3 destination ${cyan(bold(destination.name))} configured.`))

    return { destination, secretAccessKey }
}

export const storeS3Secret = async (name: string, secretAccessKey: string) => {
    await setS3SecretAccessKey(name, secretAccessKey)
}
