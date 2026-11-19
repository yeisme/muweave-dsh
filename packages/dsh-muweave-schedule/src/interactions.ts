export type DayKey = string

export type ScheduleUndoKind = 'plan' | 'clear'

export interface ScheduleUndoEntry {
  kind: ScheduleUndoKind
  ref: string
  date?: string
  prevDate?: string
}

function parseDayKey(dayKey: DayKey): Date {
  const [year, month, day] = dayKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatDayKey(date: Date): DayKey {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function addDays(dayKey: DayKey, amount: number): DayKey {
  const date = parseDayKey(dayKey)
  date.setDate(date.getDate() + amount)
  return formatDayKey(date)
}

export function startOfWeek(dayKey: DayKey): DayKey {
  const date = parseDayKey(dayKey)
  const mondayOffset = (date.getDay() + 6) % 7
  return addDays(dayKey, -mondayOffset)
}

export function addMonths(dayKey: DayKey, amount: number): DayKey {
  const source = parseDayKey(dayKey)
  const day = source.getDate()
  const target = new Date(source.getFullYear(), source.getMonth() + amount, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(day, lastDay))
  return formatDayKey(target)
}

export function moveDayFocus(cursorDayKey: DayKey, key: string): DayKey {
  switch (key) {
    case 'ArrowLeft':
      return addDays(cursorDayKey, -1)
    case 'ArrowRight':
      return addDays(cursorDayKey, 1)
    case 'ArrowUp':
      return addDays(cursorDayKey, -7)
    case 'ArrowDown':
      return addDays(cursorDayKey, 7)
    case 'Home':
      return startOfWeek(cursorDayKey)
    case 'End':
      return addDays(startOfWeek(cursorDayKey), 6)
    case 'PageUp':
      return addMonths(cursorDayKey, -1)
    case 'PageDown':
      return addMonths(cursorDayKey, 1)
    default:
      return cursorDayKey
  }
}

export function pushUndo(
  stack: readonly ScheduleUndoEntry[],
  entry: ScheduleUndoEntry,
  limit = 20,
): ScheduleUndoEntry[] {
  if (limit <= 0) return []
  return [...stack, entry].slice(-limit)
}

export function popUndo(
  stack: readonly ScheduleUndoEntry[],
): { entry: ScheduleUndoEntry | undefined; stack: ScheduleUndoEntry[] } {
  if (stack.length === 0) return { entry: undefined, stack: [] }
  return { entry: stack[stack.length - 1], stack: stack.slice(0, -1) }
}
