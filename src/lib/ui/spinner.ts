import { green, red } from '@crustjs/style'
import spinners from 'cli-spinners'

const names = Object.keys(spinners).filter((name) => name.startsWith('dots'))

type CliSpinner = (typeof spinners)[keyof typeof spinners]

let cachedSpinner: CliSpinner | null = null

export const getRandomSpinner = (): CliSpinner => {
    if (cachedSpinner) return cachedSpinner
    const name = names[Math.floor(Math.random() * names.length)]!
    cachedSpinner = spinners[name as keyof typeof spinners]
    return cachedSpinner
}

export const getSuccessIcon = () => green('✔')
export const getErrorIcon = () => red('✖')
