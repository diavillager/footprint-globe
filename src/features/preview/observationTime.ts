import type { Instant } from '../../domain/timeline';

export type DisplayTimezone = 'UTC' | 'Asia/Seoul';
const formatters = Object.fromEntries(['UTC', 'Asia/Seoul'].map(timeZone => [timeZone,
  new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }),
])) as Record<DisplayTimezone, Intl.DateTimeFormat>;

export function formatObservationTime(time: Instant, timezone: DisplayTimezone): string {
  // Keep source sub-millisecond precision without using rounded epochMs to sort.
  const fraction = time.sourceText.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1];
  return `${formatters[timezone].format(time.epochMs)}${fraction ? `.${fraction}` : ''} ${timezone === 'UTC' ? 'UTC' : '한국 시간 (UTC+09:00)'}`;
}
