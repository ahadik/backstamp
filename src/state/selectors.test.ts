import { groupPhotosByDay, flatOrderedIds, getDateKey, formatLabel } from "./selectors";
import type { Photo, Metadata } from "./SessionContext";

const nullMeta: Metadata = {
  captureDate: null, captureTime: null, utcOffset: null, timezone: null,
  gpsLat: null, gpsLng: null, cameraMake: null, cameraModel: null, lens: null, filmVendor: null, filmType: null,
};

function makePhoto(id: string, overrides: Partial<Metadata> = {}): Photo {
  return {
    id,
    filePath: `/photos/${id}.jpg`,
    fileStatus: "ok",
    thumbnail: { small: "", large: "" },
    originalMetadata: { ...nullMeta, ...overrides },
    currentMetadata: { ...nullMeta, ...overrides },
    pendingChanges: null,
  };
}

const TZ = "America/New_York";

describe("groupPhotosByDay", () => {
  it("returns an empty array for no photos", () => {
    expect(groupPhotosByDay([], TZ)).toEqual([]);
  });

  it("puts photos without a captureDate into the no-date block", () => {
    const photo = makePhoto("a");
    const blocks = groupPhotosByDay([photo], TZ);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].dateKey).toBe("no-date");
    expect(blocks[0].label).toBe("No Date");
    expect(blocks[0].photos[0].id).toBe("a");
  });

  it("groups photos by captureDate", () => {
    const photos = [
      makePhoto("a", { captureDate: "2024-03-15" }),
      makePhoto("b", { captureDate: "2024-03-16" }),
      makePhoto("c", { captureDate: "2024-03-15" }),
    ];
    const blocks = groupPhotosByDay(photos, TZ);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].dateKey).toBe("2024-03-15");
    expect(blocks[0].photos.map((p) => p.id)).toContain("a");
    expect(blocks[0].photos.map((p) => p.id)).toContain("c");
    expect(blocks[1].dateKey).toBe("2024-03-16");
  });

  it("puts the no-date block first", () => {
    const photos = [
      makePhoto("a", { captureDate: "2024-01-01" }),
      makePhoto("b"),
    ];
    const blocks = groupPhotosByDay(photos, TZ);
    expect(blocks[0].dateKey).toBe("no-date");
    expect(blocks[1].dateKey).toBe("2024-01-01");
  });

  it("sorts day blocks ascending by date", () => {
    const photos = [
      makePhoto("c", { captureDate: "2024-03-20" }),
      makePhoto("a", { captureDate: "2024-03-10" }),
      makePhoto("b", { captureDate: "2024-03-15" }),
    ];
    const keys = groupPhotosByDay(photos, TZ).map((b) => b.dateKey);
    expect(keys).toEqual(["2024-03-10", "2024-03-15", "2024-03-20"]);
  });

  it("sorts photos within a block ascending by captureTime", () => {
    const photos = [
      makePhoto("late", { captureDate: "2024-03-15", captureTime: "14:00:00" }),
      makePhoto("early", { captureDate: "2024-03-15", captureTime: "08:00:00" }),
    ];
    const block = groupPhotosByDay(photos, TZ)[0];
    expect(block.photos[0].id).toBe("early");
    expect(block.photos[1].id).toBe("late");
  });

  it("puts null captureTime after photos with a time", () => {
    const photos = [
      makePhoto("notime", { captureDate: "2024-03-15" }),
      makePhoto("hastime", { captureDate: "2024-03-15", captureTime: "10:00:00" }),
    ];
    const block = groupPhotosByDay(photos, TZ)[0];
    expect(block.photos[0].id).toBe("hastime");
    expect(block.photos[1].id).toBe("notime");
  });

  it("uses filePath as tiebreak within same captureTime", () => {
    const photos = [
      makePhoto("z_photo", { captureDate: "2024-03-15", captureTime: "10:00:00" }),
      makePhoto("a_photo", { captureDate: "2024-03-15", captureTime: "10:00:00" }),
    ];
    const block = groupPhotosByDay(photos, TZ)[0];
    expect(block.photos[0].id).toBe("a_photo");
    expect(block.photos[1].id).toBe("z_photo");
  });

  it("formats a day label correctly", () => {
    const photos = [makePhoto("a", { captureDate: "2024-03-15" })];
    const block = groupPhotosByDay(photos, TZ)[0];
    expect(block.label).toMatch(/Friday/);
    expect(block.label).toMatch(/March/);
    expect(block.label).toMatch(/15/);
    expect(block.label).toMatch(/2024/);
  });

  it("sorts by UTC moment when photos from different timezones share a bucket", () => {
    // Both photos land in 2024-03-15 in America/New_York (UTC-4):
    //   "first":  2024-03-15T20:00-05:00 → UTC 2024-03-16T01:00 → NY 21:00
    //   "second": 2024-03-16T02:00+00:00 → UTC 2024-03-16T02:00 → NY 22:00
    // Without UTC comparison, captureTime "02:00" < "20:00" reverses the order.
    const photos = [
      makePhoto("second", { captureDate: "2024-03-16", captureTime: "02:00:00", utcOffset: "+00:00" }),
      makePhoto("first",  { captureDate: "2024-03-15", captureTime: "20:00:00", utcOffset: "-05:00" }),
    ];
    const block = groupPhotosByDay(photos, "America/New_York")[0];
    expect(block.photos[0].id).toBe("first");
    expect(block.photos[1].id).toBe("second");
  });

  it("adjusts date when utcOffset shifts the calendar day into the working timezone", () => {
    // Photo taken at 2024-03-15T23:00:00+00:00 is 2024-03-15 in UTC
    // but 2024-03-15 19:00:00 in America/New_York (UTC-4 in March) — still same day
    // Photo taken at 2024-03-16T02:00:00+00:00 is 2024-03-16 in UTC
    // but 2024-03-15 22:00:00 in America/New_York — shifts back one day
    const photos = [
      makePhoto("shifted", {
        captureDate: "2024-03-16",
        captureTime: "02:00:00",
        utcOffset: "+00:00",
      }),
    ];
    const blocks = groupPhotosByDay(photos, "America/New_York");
    expect(blocks[0].dateKey).toBe("2024-03-15");
  });
});

describe("flatOrderedIds", () => {
  it("returns an empty array for no blocks", () => {
    expect(flatOrderedIds([])).toEqual([]);
  });

  it("flattens photo ids across blocks in order", () => {
    const blocks = groupPhotosByDay(
      [
        makePhoto("a", { captureDate: "2024-03-15", captureTime: "08:00:00" }),
        makePhoto("b", { captureDate: "2024-03-15", captureTime: "10:00:00" }),
        makePhoto("c", { captureDate: "2024-03-16" }),
      ],
      TZ,
    );
    expect(flatOrderedIds(blocks)).toEqual(["a", "b", "c"]);
  });

  it("places no-date block ids first", () => {
    const blocks = groupPhotosByDay(
      [makePhoto("dated", { captureDate: "2024-01-01" }), makePhoto("nodated")],
      TZ,
    );
    expect(flatOrderedIds(blocks)[0]).toBe("nodated");
  });
});

// ── getDateKey ────────────────────────────────────────────────────────────────

describe("getDateKey", () => {
  function makePhoto(meta: Partial<Metadata> = {}): Photo {
    return {
      id: "p",
      filePath: "/p.jpg",
      fileStatus: "ok",
      thumbnail: { small: "", large: "" },
      originalMetadata: { ...nullMeta, ...meta },
      currentMetadata: { ...nullMeta, ...meta },
      pendingChanges: null,
    };
  }

  it("returns 'no-date' when captureDate is null", () => {
    expect(getDateKey(makePhoto(), "UTC")).toBe("no-date");
  });

  it("returns captureDate as-is when utcOffset is missing", () => {
    const photo = makePhoto({ captureDate: "2024-03-15", captureTime: "10:00:00" });
    expect(getDateKey(photo, "America/New_York")).toBe("2024-03-15");
  });

  it("returns captureDate as-is when captureTime is missing", () => {
    const photo = makePhoto({ captureDate: "2024-03-15", utcOffset: "+09:00" });
    expect(getDateKey(photo, "America/New_York")).toBe("2024-03-15");
  });

  it("returns captureDate unchanged when it already matches the working timezone", () => {
    // Noon UTC stays March 15 in UTC
    const photo = makePhoto({ captureDate: "2024-03-15", captureTime: "12:00:00", utcOffset: "+00:00" });
    expect(getDateKey(photo, "UTC")).toBe("2024-03-15");
  });

  it("shifts the date forward when the UTC instant falls on the next day in the working timezone", () => {
    // 22:00 local time at UTC-5 = 03:00 UTC the following day.
    // Viewed in Asia/Tokyo (UTC+9) that 03:00 UTC becomes 12:00 the next day.
    const photo = makePhoto({ captureDate: "2024-03-14", captureTime: "22:00:00", utcOffset: "-05:00" });
    expect(getDateKey(photo, "Asia/Tokyo")).toBe("2024-03-15");
  });

  it("shifts the date back when the UTC instant falls on the previous day in the working timezone", () => {
    // 01:00 local time at UTC+9 = 16:00 UTC the previous day.
    // Viewed in America/New_York (UTC-4 in March 2024, after DST) that is still March 14.
    const photo = makePhoto({ captureDate: "2024-03-15", captureTime: "01:00:00", utcOffset: "+09:00" });
    expect(getDateKey(photo, "America/New_York")).toBe("2024-03-14");
  });

  it("returns captureDate when the constructed date string is invalid (NaN)", () => {
    const photo = makePhoto({ captureDate: "2024-03-15", captureTime: "not-a-time", utcOffset: "+00:00" });
    expect(getDateKey(photo, "UTC")).toBe("2024-03-15");
  });

  it("returns captureDate when the working timezone is invalid (exception path)", () => {
    const photo = makePhoto({ captureDate: "2024-03-15", captureTime: "12:00:00", utcOffset: "+00:00" });
    expect(getDateKey(photo, "Not/A/Timezone")).toBe("2024-03-15");
  });
});

// ── formatLabel ───────────────────────────────────────────────────────────────

describe("formatLabel", () => {
  it("returns 'No Date' for the no-date sentinel", () => {
    expect(formatLabel("no-date")).toBe("No Date");
  });

  it("formats a known Monday correctly", () => {
    // 2024-01-01 is a Monday
    expect(formatLabel("2024-01-01")).toBe("Monday, January 1, 2024");
  });

  it("formats a known Friday correctly", () => {
    // 2024-03-15 is a Friday
    expect(formatLabel("2024-03-15")).toBe("Friday, March 15, 2024");
  });

  it("formats a known Tuesday correctly", () => {
    // 2024-12-31 is a Tuesday
    expect(formatLabel("2024-12-31")).toBe("Tuesday, December 31, 2024");
  });

  it("includes the full month name", () => {
    expect(formatLabel("2024-06-15")).toMatch(/June/);
  });
});
