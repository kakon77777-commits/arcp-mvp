import { TemporalEvidenceError } from '@arcp/temporal-evidence';
import type { ParsedLocalDateTime } from './types.js';

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{3}))?)?$/;

function invalidInput(message: string, cause?: unknown): TemporalEvidenceError {
  return new TemporalEvidenceError(
    'invalid_input',
    message,
    false,
    cause === undefined ? undefined : { cause },
  );
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

export function parseLocalDateTime(value: string): ParsedLocalDateTime {
  const match = LOCAL_DATE_TIME.exec(value);
  if (match === null) {
    throw invalidInput(
      'local datetime must be YYYY-MM-DDTHH:mm, YYYY-MM-DDTHH:mm:ss, or YYYY-MM-DDTHH:mm:ss.SSS without an offset',
    );
  }

  const parsed: ParsedLocalDateTime = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: match[6] === undefined ? 0 : Number(match[6]),
    millisecond: match[7] === undefined ? 0 : Number(match[7]),
  };

  if (parsed.month < 1 || parsed.month > 12) throw invalidInput('local datetime month is out of range');
  if (parsed.day < 1 || parsed.day > daysInMonth(parsed.year, parsed.month)) {
    throw invalidInput('local datetime day is out of range');
  }
  if (parsed.hour < 0 || parsed.hour > 23) throw invalidInput('local datetime hour is out of range');
  if (parsed.minute < 0 || parsed.minute > 59) throw invalidInput('local datetime minute is out of range');
  if (parsed.second < 0 || parsed.second > 59) throw invalidInput('local datetime second is out of range');
  if (parsed.millisecond < 0 || parsed.millisecond > 999) {
    throw invalidInput('local datetime millisecond is out of range');
  }

  return parsed;
}

function naiveUtcMs(fields: ParsedLocalDateTime): number {
  const date = new Date(0);
  date.setUTCFullYear(fields.year, fields.month - 1, fields.day);
  date.setUTCHours(fields.hour, fields.minute, fields.second, fields.millisecond);
  return date.getTime();
}

function formatterFor(timezone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
      hourCycle: 'h23',
    });
  } catch (error) {
    throw invalidInput(`invalid IANA timezone: ${timezone}`, error);
  }
}

function formattedFields(formatter: Intl.DateTimeFormat, unixMs: number): ParsedLocalDateTime {
  const values = new Map<string, string>(
    formatter.formatToParts(new Date(unixMs)).map((part): [string, string] => [part.type, part.value]),
  );
  const required = (name: string): number => {
    const value = values.get(name);
    if (value === undefined) throw invalidInput(`timezone formatter omitted ${name}`);
    return Number(value);
  };

  return {
    year: required('year'),
    month: required('month'),
    day: required('day'),
    hour: required('hour'),
    minute: required('minute'),
    second: required('second'),
    millisecond: required('fractionalSecond'),
  };
}

function sameFields(left: ParsedLocalDateTime, right: ParsedLocalDateTime): boolean {
  return left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second &&
    left.millisecond === right.millisecond;
}

export function resolveIanaLocalDateTime(input: {
  localValue: string;
  timezone: string;
  foldResolution?: 'earlier' | 'later';
}): number {
  const target = parseLocalDateTime(input.localValue);
  const formatter = formatterFor(input.timezone);
  const targetNaiveMs = naiveUtcMs(target);
  let candidate = targetNaiveMs;

  for (let round = 0; round < 4; round += 1) {
    const observed = formattedFields(formatter, candidate);
    const delta = targetNaiveMs - naiveUtcMs(observed);
    if (delta === 0) break;
    candidate += delta;
  }

  const matches: number[] = [];
  const scanStart = candidate - 4 * 60 * 60 * 1_000;
  const scanEnd = candidate + 4 * 60 * 60 * 1_000;
  for (let instant = scanStart; instant <= scanEnd; instant += 60_000) {
    if (sameFields(formattedFields(formatter, instant), target)) matches.push(instant);
  }

  const unique = [...new Set(matches)].sort((a, b) => a - b);
  if (unique.length === 0) {
    throw invalidInput(`local datetime does not map to an exact instant in ${input.timezone}`);
  }
  if (unique.length > 1 && input.foldResolution === undefined) {
    throw invalidInput('ambiguous local datetime requires foldResolution');
  }

  const chosen = input.foldResolution === 'later' ? unique.at(-1) : unique[0];
  if (chosen === undefined) throw invalidInput('local datetime could not be resolved');
  return chosen;
}
