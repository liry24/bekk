// ─── index.ts ─── UI component layer exports ─────────────────────────────────

export { drawPanel, type PanelOptions } from './panel'
export { gradientText, gradientBar, defaultGradient } from './gradient'
export { createRichProgress, type RichProgress } from './progress'
export { createTaskList, type TaskListInstance, type TaskState } from './task-list'
export { padStart, stripAnsi, wrapLines } from './layout'
export { getRandomSpinner, getSuccessIcon, getErrorIcon } from './spinner'
export { bold, dim, italic, green, red, yellow, cyan, blue, table, orderedList } from './style'
export { getRenderer, clearFooter, destroyRenderer, writeScrollback, writeString } from './renderer'
export {
    CancelledError,
    input,
    password,
    confirm,
    select,
    multiselect,
    spinner,
    type InputOptions,
    type PasswordOptions,
    type ConfirmOptions,
    type SelectOptions,
    type SelectChoice,
    type MultiselectOptions,
    type SpinnerOptions,
} from './prompts'
