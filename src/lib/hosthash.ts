import { hostname } from 'os'

/**
 * Compute a short hash of the current machine's hostname.
 */
export const getHostHash = () => {
    const hasher = new Bun.CryptoHasher('sha256')
    const host = (Bun.env.COMPUTERNAME ?? Bun.env.HOSTNAME ?? hostname() ?? 'unknown')
        .trim()
        .toLowerCase()
    return hasher.update(encodeURIComponent(host)).digest('hex').slice(0, 16)
}

/**
 * Returns the config filename for this machine: _bekk_config_<hosthash>.json
 *
 * The leading underscore ensures the file sorts before `apps_*.json`
 * alphabetically, so Gist displays it first (Gist uses the first filename
 * as the gist title).
 */
export const getConfigFileName = () => `_bekk_config_${getHostHash()}.json`
