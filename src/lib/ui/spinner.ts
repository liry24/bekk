// ─── spinner.ts ─── Spinner frame definitions ────────────────────────────────

import cliSpinners, { type Spinner } from 'cli-spinners'

import { green, red } from './style'

export type SpinnerDef = Spinner

const DOTS_SPINNERS: SpinnerDef[] = [
    cliSpinners.dots,
    cliSpinners.dots2,
    cliSpinners.dots3,
    cliSpinners.dots4,
    cliSpinners.dots5,
    cliSpinners.dots6,
    cliSpinners.dots7,
    cliSpinners.dots8,
    cliSpinners.dots9,
    cliSpinners.dots10,
    cliSpinners.dots11,
    cliSpinners.dots12,
    cliSpinners.dots13,
    cliSpinners.dots14,
    cliSpinners.dots8Bit,
    cliSpinners.simpleDots,
    cliSpinners.simpleDotsScrolling,
]

let cachedSpinner: SpinnerDef | null = null

export const getRandomSpinner = (): SpinnerDef => {
    if (cachedSpinner) return cachedSpinner
    cachedSpinner = DOTS_SPINNERS[Math.floor(Math.random() * DOTS_SPINNERS.length)]!
    return cachedSpinner
}

export const getSuccessIcon = (): string => green('✔')
export const getErrorIcon = (): string => red('✖')
