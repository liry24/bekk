import { dataDir } from '@crustjs/store'
import { join } from 'pathe'

export const getAppListsDir = () => join(dataDir('bekk'), 'app-lists')
