export interface TimezoneOption {
  value: string;
  /**
   * Display name only. Offsets are deliberately absent: a zone's offset depends
   * on the date (America/Denver is UTC−7 in January and UTC−6 in July), so it is
   * resolved at render time against the photo in hand. See `resolveZoneOffsets`.
   */
  name: string;
}

/**
 * Curated shortlist, ordered by standard-time offset. Typing in the inspector's
 * timezone field searches the full IANA set beyond these.
 *
 * Zones that don't observe DST are listed separately from their DST-observing
 * neighbours (Phoenix vs. Denver, Regina vs. Chicago, Brisbane vs. Sydney) —
 * picking the wrong one is exactly the bug this list used to cause.
 */
export const WORKING_TIMEZONES: TimezoneOption[] = [
  { value: "Pacific/Midway",        name: "Midway Island" },
  { value: "Pacific/Honolulu",      name: "Hawaii" },
  { value: "America/Anchorage",     name: "Alaska" },
  { value: "America/Los_Angeles",   name: "US Pacific" },
  { value: "America/Denver",        name: "US Mountain" },
  { value: "America/Phoenix",       name: "US Arizona" },
  { value: "America/Chicago",       name: "US Central" },
  { value: "America/Regina",        name: "Saskatchewan" },
  { value: "America/New_York",      name: "US Eastern" },
  { value: "America/Halifax",       name: "Atlantic" },
  { value: "America/Sao_Paulo",     name: "São Paulo" },
  { value: "Atlantic/Azores",       name: "Azores" },
  { value: "Europe/London",         name: "London" },
  { value: "Europe/Paris",          name: "Central Europe" },
  { value: "Europe/Helsinki",       name: "Eastern Europe" },
  { value: "Europe/Moscow",         name: "Moscow" },
  { value: "Asia/Dubai",            name: "Dubai" },
  { value: "Asia/Karachi",          name: "Karachi" },
  { value: "Asia/Kolkata",          name: "India" },
  { value: "Asia/Dhaka",            name: "Dhaka" },
  { value: "Asia/Bangkok",          name: "Bangkok" },
  { value: "Asia/Shanghai",         name: "China" },
  { value: "Asia/Tokyo",            name: "Tokyo" },
  { value: "Australia/Brisbane",    name: "Brisbane" },
  { value: "Australia/Sydney",      name: "Sydney" },
  { value: "Pacific/Guadalcanal",   name: "Solomon Islands" },
  { value: "Pacific/Auckland",      name: "Auckland" },
];
