export interface TimezoneOption {
  value: string;
  label: string;
}

export const WORKING_TIMEZONES: TimezoneOption[] = [
  { value: "Pacific/Midway",        label: "UTC-11 Midway Island" },
  { value: "Pacific/Honolulu",      label: "UTC-10 Hawaii" },
  { value: "America/Anchorage",     label: "UTC-9  Alaska" },
  { value: "America/Los_Angeles",   label: "UTC-8  US Pacific" },
  { value: "America/Denver",        label: "UTC-7  US Mountain" },
  { value: "America/Chicago",       label: "UTC-6  US Central" },
  { value: "America/New_York",      label: "UTC-5  US Eastern" },
  { value: "America/Halifax",       label: "UTC-4  Atlantic" },
  { value: "America/Sao_Paulo",     label: "UTC-3  São Paulo" },
  { value: "Atlantic/Azores",       label: "UTC-1  Azores" },
  { value: "Europe/London",         label: "UTC+0  London / UTC" },
  { value: "Europe/Paris",          label: "UTC+1  Central Europe" },
  { value: "Europe/Helsinki",       label: "UTC+2  Eastern Europe" },
  { value: "Europe/Moscow",         label: "UTC+3  Moscow" },
  { value: "Asia/Dubai",            label: "UTC+4  Dubai" },
  { value: "Asia/Karachi",          label: "UTC+5  Karachi" },
  { value: "Asia/Kolkata",          label: "UTC+5:30 India" },
  { value: "Asia/Dhaka",            label: "UTC+6  Dhaka" },
  { value: "Asia/Bangkok",          label: "UTC+7  Bangkok" },
  { value: "Asia/Shanghai",         label: "UTC+8  China" },
  { value: "Asia/Tokyo",            label: "UTC+9  Tokyo" },
  { value: "Australia/Sydney",      label: "UTC+10 Sydney" },
  { value: "Pacific/Guadalcanal",   label: "UTC+11 Solomon Islands" },
  { value: "Pacific/Auckland",      label: "UTC+12 Auckland" },
];
