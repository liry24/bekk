import { Crust } from '@crustjs/core'
import {
    autoCompletePlugin,
    helpPlugin,
    noColorPlugin,
    updateNotifierPlugin,
    versionPlugin,
} from '@crustjs/plugins'

import pkg from '../package.json'
import { updateNotifierCacheAdapter } from './store'

export const app = new Crust('bekk')
    .meta({ description: 'Windows backup CLI' })
    .use(versionPlugin(pkg.version))
    .use(noColorPlugin())
    .use(autoCompletePlugin({ mode: 'help' }))
    .use(helpPlugin())
    .use(
        updateNotifierPlugin({
            packageName: pkg.name,
            currentVersion: pkg.version,
            packageManager: 'bun',
            installScope: 'global',
            cache: { adapter: updateNotifierCacheAdapter },
        }),
    )
