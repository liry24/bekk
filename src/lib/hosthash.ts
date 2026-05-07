const hasher = new Bun.CryptoHasher('sha256')

/**
 * Compute a short hash of the current machine's hostname.
 */
export const getHostHash = () =>
    hasher
        .update(encodeURIComponent((Bun.env.COMPUTERNAME ?? 'unknown').trim().toLowerCase()))
        .digest('utf8')
        .slice(0, 10)

/**
 * Returns the config filename for this machine: bekk_config_<hosthash>.json
 */
export const getConfigFileName = () => `bekk_config_${getHostHash()}.json`
