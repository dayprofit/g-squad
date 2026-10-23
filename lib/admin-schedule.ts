export interface WorkShift {
  weekday: number;
  start: string;
  end: string;
}

export interface StaffSchedule {
  timezone: string;
  shifts: WorkShift[];
  roleStartsOn: string | null;
  roleEndsOn: string | null;
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function parseStaffSchedule(input: unknown): StaffSchedule | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (typeof value.timezone !== 'string' || !isValidTimezone(value.timezone)) return null;
  if (!Array.isArray(value.shifts) || value.shifts.length > 7) return null;
  const shifts: WorkShift[] = [];
  const weekdays = new Set<number>();
  for (const item of value.shifts) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const shift = item as Record<string, unknown>;
    if (
      !Number.isInteger(shift.weekday) ||
      Number(shift.weekday) < 0 ||
      Number(shift.weekday) > 6 ||
      weekdays.has(Number(shift.weekday)) ||
      typeof shift.start !== 'string' ||
      typeof shift.end !== 'string' ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(shift.start) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(shift.end) ||
      shift.start >= shift.end
    ) return null;
    weekdays.add(Number(shift.weekday));
    shifts.push({ weekday: Number(shift.weekday), start: shift.start, end: shift.end });
  }
  const roleStartsOn = value.roleStartsOn === null ? null : typeof value.roleStartsOn === 'string' && isValidDate(value.roleStartsOn) ? value.roleStartsOn : undefined;
  const roleEndsOn = value.roleEndsOn === null ? null : typeof value.roleEndsOn === 'string' && isValidDate(value.roleEndsOn) ? value.roleEndsOn : undefined;
  if (roleStartsOn === undefined || roleEndsOn === undefined) return null;
  if (roleStartsOn && roleEndsOn && roleStartsOn > roleEndsOn) return null;
  return { timezone: value.timezone, shifts, roleStartsOn, roleEndsOn };
}

export function isStaffScheduledNow(
  schedule: StaffSchedule,
  now: Date = new Date(),
): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: schedule.timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localDate = `${values.year}-${values.month}-${values.day}`;
  if (schedule.roleStartsOn && localDate < schedule.roleStartsOn) return false;
  if (schedule.roleEndsOn && localDate > schedule.roleEndsOn) return false;
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday);
  const currentTime = `${values.hour}:${values.minute}`;
  return schedule.shifts.some((shift) =>
    shift.weekday === weekday && shift.start <= currentTime && currentTime < shift.end
  );
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
