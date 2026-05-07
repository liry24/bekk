import { hostname } from 'os'

/**
 * Compute a short hash of the current machine's hostname.
 */
export const getHostHash = () => {
    const hasher = new Bun.CryptoHasher('sha256')
    const host = (Bun.env.COMPUTERNAME ?? Bun.env.HOSTNAME ?? hostname() ?? 'unknown')
        .trim()
        .toLowerCase()
    return hasher.update(encodeURIComponent(host)).digest('hex').slice(0, 10)
}

/**
 * Returns the config filename for this machine: bekk_config_<hosthash>.json
 */
export const getConfigFileName = () => `bekk_config_${getHostHash()}.json`
