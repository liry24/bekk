// ─── index.ts ─── UI コンポーネント層のエクスポート ────────────────────────

export { renderPanel, drawPanel, type PanelOptions } from './panel'
export {
    gradientText,
    gradientBar,
    defaultGradient,
    color256,
    colorReset,
    bold,
    dim,
} from './gradient'
export { createRichProgress, type RichProgress } from './progress'
export { createTaskList, TaskList, type TaskListInstance, type TaskState } from './task-list'
export { termWidth, padEnd, padStart, truncate, stripAnsi, wrapLines, center } from './layout'
