/** Compute DST-correct UTC offset string (e.g. "-07:00") for an IANA timezone on a given date. */
export function getUtcOffset(ianaTimezone: string, date: Date): string {
  try {
    const fmt = new Intl.DateTimeFormat("en", {
      timeZone: ianaTimezone,
      timeZoneName: "shortOffset",
    });
    const parts = fmt.formatToParts(date);
    const offsetPart = parts.find((p) => p.type === "timeZoneName");
    if (!offsetPart) return "+00:00";
    const val = offsetPart.value;
    if (val === "GMT") return "+00:00";
    const match = val.match(/GMT([+-])(\d+)(?::(\d+))?/);
    if (!match) return "+00:00";
    const sign = match[1];
    const hours = match[2].padStart(2, "0");
    const mins = (match[3] ?? "00").padStart(2, "0");
    return `${sign}${hours}:${mins}`;
  } catch {
    return "+00:00";
  }
}
