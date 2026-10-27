export const widgetActions = [
  {
    key: 'lock',
    icon: 'locked',
    command: 'lock',
    actionKey: 'lock',
    updatingText: 'Locking car...',
    successText: 'Car locked!',
    failureText: 'Failed to lock car.',
  },
  {
    key: 'refresh',
    icon: 'last-update',
    command: 'status',
    actionKey: 'status',
    updatingText: 'Updating status...',
    successText: 'Status updated!',
    failureText: 'Failed to update status.',
  },
  {
    key: 'unlock',
    icon: 'unlocked',
    command: 'unlock',
    actionKey: 'lock',
    updatingText: 'Unlocking car...',
    successText: 'Car unlocked!',
    failureText: 'Failed to unlock car.',
  },
] as const

export type WidgetAction = (typeof widgetActions)[number]

export function getWidgetAction(value: unknown): WidgetAction | undefined {
  return widgetActions.find((action) => action.key === value)
}

export function getWidgetActionUrl(action: WidgetAction): string {
  const url = URLScheme.forRunningScript()
  return `${url}${url.includes('?') ? '&' : '?'}action=${action.key}`
}
