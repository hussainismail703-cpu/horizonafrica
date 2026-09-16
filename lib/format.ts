/**
 * Shared date/time formatters pinned to en-ZA locale and the
 * Africa/Johannesburg timezone.
 *
 * Pinning both guarantees byte-identical output on the server (Node default
 * is en-US; Vercel runs UTC) and the client, which prevents React hydration
 * mismatches and always displays South African local time.
 */

const LOCALE = "en-ZA";
const TIME_ZONE = "Africa/Johannesburg";

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};

const TIME_OPTS: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
};

// dateStyle/timeStyle cannot be combined with component options
// (year/month/day/hour/...) — Intl throws. When a caller passes a style,
// drop the component defaults and use only the style + timezone.
function merge(
  defaults: Intl.DateTimeFormatOptions,
  opts: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormatOptions {
  const base = opts.dateStyle || opts.timeStyle ? {} : defaults;
  return { ...base, ...opts, timeZone: TIME_ZONE };
}

export function formatDate(
  d: string | Date | null | undefined,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(LOCALE, merge(DATE_OPTS, opts));
}

export function formatDateTime(
  d: string | Date | null | undefined,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  if (!d) return "—";
  return new Date(d).toLocaleString(
    LOCALE,
    merge({ ...DATE_OPTS, ...TIME_OPTS }, opts),
  );
}

export function formatTime(
  d: string | Date | null | undefined,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString(LOCALE, merge(TIME_OPTS, opts));
}
