import { groupPhotosByDay, flatOrderedIds } from "./selectors";
import type { Photo, Metadata } from "./SessionContext";

const nullMeta: Metadata = {
  captureDate: null, captureTime: null, utcOffset: null, timezone: null,
  gpsLat: null, gpsLng: null, cameraBody: null, lens: null, film: null,
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
