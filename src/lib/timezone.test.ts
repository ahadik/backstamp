import { getUtcOffset } from "./timezone";

const summerDate = new Date("2024-07-15T12:00:00Z");
const winterDate = new Date("2024-01-15T12:00:00Z");

describe("getUtcOffset", () => {
  it("returns PDT offset in summer", () => {
    expect(getUtcOffset("America/Los_Angeles", summerDate)).toBe("-07:00");
  });

  it("returns PST offset in winter", () => {
    expect(getUtcOffset("America/Los_Angeles", winterDate)).toBe("-08:00");
  });

  it("returns +00:00 for UTC", () => {
    expect(getUtcOffset("UTC", summerDate)).toBe("+00:00");
  });

  it("returns positive offset for Asia/Tokyo", () => {
    expect(getUtcOffset("Asia/Tokyo", summerDate)).toBe("+09:00");
  });

  it("returns +00:00 for invalid timezone", () => {
    expect(getUtcOffset("Not/A/Timezone", summerDate)).toBe("+00:00");
  });
});
