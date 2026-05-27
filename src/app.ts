import { Crust } from '@crustjs/core'
import {
    completionPlugin,
    didYouMeanPlugin,
    helpPlugin,
    noColorPlugin,
    updateNotifierPlugin,
    versionPlugin,
} from '@crustjs/plugins'

import pkg from '../package.json'
import { updateNotifierCacheAdapter } from './store'

export const app = new Crust('bekk')
    .meta({ description: 'Cross-platform backup CLI' })
    .use(versionPlugin(pkg.version))
    .use(noColorPlugin())
    .use(didYouMeanPlugin({ mode: 'help' }))
    .use(helpPlugin())
    .use(completionPlugin({ version: pkg.version }))
    .use(
        updateNotifierPlugin({
            packageName: pkg.name,
            currentVersion: pkg.version,
            packageManager: 'bun',
            installScope: 'global',
            cache: { adapter: updateNotifierCacheAdapter },
        }),
    )
