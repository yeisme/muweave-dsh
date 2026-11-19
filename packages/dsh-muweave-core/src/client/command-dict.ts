/**
 * Shell strings: command palette, filter drawer, composer chips and the tool catalog
 * (docs/design/desk-v3.md, desk-v6.md, desk-v7.md). Kept in one module so the shell dictionaries
 * only need one spread each.
 */

import { COMPOSER_DICT_ZH, COMPOSER_DICT_EN } from './composer-chips'
import { TOOL_DICT_ZH, TOOL_DICT_EN } from './tool-catalog'

export const COMMAND_ZH = {
  commandPalette: '命令面板',
  commandPlaceholder: '搜索房间、视图与操作…',
  commandEmpty: '没有匹配的命令',
  commandGroupRooms: '房间',
  commandGroupViews: '视图',
  commandGroupActions: '操作',
  commandGroupRecent: '最近',
  commandActionHint: '> 仅搜索操作',
  commandFooter: '↑↓ 选择 · Tab 补全 · Enter 执行 · Esc 关闭',
  commandOpenHint: '{mod}K 命令面板',
  filterPane: '筛选',
  filterPaneLabel: '原件筛选',
  paletteSync: '同步 .muweave/',
  paletteGenerate: '打开生成台',
  paletteAgent: '打开幕织助手',
  paletteFilter: '筛选原件',
  paletteView: '布局与分屏',
  paletteFocusRoom: '切换到房间',
  paletteFocusView: '切换到视图',
  agentPanelHint: '@ 引用元件 · / 技能与模板 · Enter 发送',
  ...COMPOSER_DICT_ZH,
  ...TOOL_DICT_ZH,
} as const

export const COMMAND_EN = {
  commandPalette: 'Command palette',
  commandPlaceholder: 'Search rooms, views and actions…',
  commandEmpty: 'No matching command',
  commandGroupRooms: 'Rooms',
  commandGroupViews: 'Views',
  commandGroupActions: 'Actions',
  commandGroupRecent: 'Recent',
  commandActionHint: '> Search actions only',
  commandFooter: '↑↓ move · Tab complete · Enter run · Esc close',
  commandOpenHint: '{mod}K commands',
  filterPane: 'Filter',
  filterPaneLabel: 'Element filter',
  paletteSync: 'Sync .muweave/',
  paletteGenerate: 'Open generate desk',
  paletteAgent: 'Open creator assistant',
  paletteFilter: 'Filter elements',
  paletteView: 'Layout & split',
  paletteFocusRoom: 'Switch room',
  paletteFocusView: 'Switch view',
  agentPanelHint: '@ for elements · / for skills & templates · Enter to send',
  ...COMPOSER_DICT_EN,
  ...TOOL_DICT_EN,
} as const
