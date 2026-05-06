import { hash } from 'ohash'

/**
 * Compute a short hash of the current machine's hostname.
 * Uses COMPUTERNAME (Windows) env var, lowercased, SHA-256 hashed → first 10 chars.
 */
export const getHostHash = async () =>
    hash(encodeURIComponent((process.env.COMPUTERNAME ?? 'unknown').trim().toLowerCase()))

/**
 * Returns the config filename for this machine: bekk_config_<hosthash>.json
 */
export const getConfigFileName = async () => `bekk_config_${await getHostHash()}.json`
