import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  moveDayFocus,
  popUndo,
  pushUndo,
  startOfWeek,
  type ScheduleUndoEntry,
} from '../packages/dsh-muweave-schedule/src/interactions'

describe('schedule calendar math', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-11-18', 1)).toBe('2026-11-19')
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    // 2024 is a leap year: February keeps its 29th.
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
  })

  it('starts weeks on Monday', () => {
    // 2026-11-18 is a Wednesday, so its week starts on the 16th.
    expect(startOfWeek('2026-11-18')).toBe('2026-11-16')
    // A Monday stays put, a Sunday belongs to the week that started six days earlier.
    expect(startOfWeek('2026-11-16')).toBe('2026-11-16')
    expect(startOfWeek('2026-11-22')).toBe('2026-11-16')
  })

  it('clamps month shifts to the last valid day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2026-11-18', 2)).toBe('2027-01-18')
  })
})

describe('schedule keyboard navigation', () => {
  it('moves by day and by week', () => {
    expect(moveDayFocus('2026-11-18', 'ArrowLeft')).toBe('2026-11-17')
    expect(moveDayFocus('2026-11-18', 'ArrowRight')).toBe('2026-11-19')
    expect(moveDayFocus('2026-11-18', 'ArrowUp')).toBe('2026-11-11')
    expect(moveDayFocus('2026-11-18', 'ArrowDown')).toBe('2026-11-25')
  })

  it('jumps to the edges of the week with Home and End', () => {
    expect(moveDayFocus('2026-11-18', 'Home')).toBe('2026-11-16')
    expect(moveDayFocus('2026-11-18', 'End')).toBe('2026-11-22')
  })

  it('changes month with PageUp and PageDown', () => {
    expect(moveDayFocus('2026-11-18', 'PageUp')).toBe('2026-10-18')
    expect(moveDayFocus('2026-11-18', 'PageDown')).toBe('2026-12-18')
  })

  it('leaves the cursor untouched for unmapped keys', () => {
    expect(moveDayFocus('2026-11-18', 'a')).toBe('2026-11-18')
    expect(moveDayFocus('2026-11-18', 'Shift')).toBe('2026-11-18')
  })
})

describe('schedule undo stack', () => {
  const plan: ScheduleUndoEntry = { kind: 'plan', ref: 'scene:ep01:s01', date: '2026-11-20' }
  const clear: ScheduleUndoEntry = { kind: 'clear', ref: 'shot:ep01:s01:01', date: '2026-11-21' }

  it('pushes in order and pops the newest entry', () => {
    const one = pushUndo([], plan)
    const two = pushUndo(one, clear)
    expect(two).toEqual([plan, clear])
    const popped = popUndo(two)
    expect(popped.entry).toEqual(clear)
    expect(popped.stack).toEqual([plan])
  })

  it('keeps at most the limit, dropping the oldest', () => {
    let stack: ScheduleUndoEntry[] = []
    for (let i = 0; i < 5; i += 1) stack = pushUndo(stack, { kind: 'plan', ref: `r${i}`, date: '2026-11-20' }, 3)
    expect(stack.map((e) => e.ref)).toEqual(['r2', 'r3', 'r4'])
  })

  it('is empty-safe and does not mutate its input', () => {
    const source: ScheduleUndoEntry[] = [plan]
    const pushed = pushUndo(source, clear)
    expect(source).toEqual([plan])
    expect(pushed).not.toBe(source)
    expect(popUndo([])).toEqual({ entry: undefined, stack: [] })
  })

  it('treats a non-positive limit as an empty stack', () => {
    expect(pushUndo([plan], clear, 0)).toEqual([])
  })
})
