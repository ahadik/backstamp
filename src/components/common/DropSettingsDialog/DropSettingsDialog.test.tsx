import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { DropSettingsDialog, type PendingDrop } from "./DropSettingsDialog";
import { DEFAULT_DROP_SETTINGS } from "../../../hooks/useMetadataInheritance";
import type { Photo, Metadata } from "../../../state/SessionContext";

const nullMeta: Metadata = {
  captureDate: null, captureTime: null, utcOffset: null, timezone: null,
  gpsLat: null, gpsLng: null, cameraMake: null, cameraModel: null, lens: null, filmVendor: null, filmType: null,
};

function makePhoto(id: string, meta: Partial<Metadata> = {}): Photo {
  return {
    id,
    filePath: `/photos/${id}.jpg`,
    fileStatus: "ok",
    thumbnail: { small: "", large: "" },
    originalMetadata: { ...nullMeta, ...meta },
    currentMetadata: { ...nullMeta, ...meta },
    pendingChanges: null,
  };
}

function cloneDrop(): PendingDrop {
  const targetPhoto = makePhoto("t", {
    captureDate: "2024-03-15",
    captureTime: "10:30:00",
    gpsLat: 37.7,
    gpsLng: -122.4,
    cameraMake: "Canon",
    cameraModel: "EOS R5",
  });
  return {
    draggingIds: ["a"],
    draggingPhotos: [makePhoto("a")],
    target: { kind: "photo", photoId: "t" },
    targetPhoto,
    neighborBefore: null,
    neighborAfter: null,
  };
}

function gapDrop(overrides: Partial<PendingDrop> = {}): PendingDrop {
  const before = makePhoto("b", {
    captureDate: "2024-03-15", captureTime: "10:00:00", cameraMake: "Nikon", gpsLat: 10, gpsLng: 20,
  });
  const after = makePhoto("f", {
    captureDate: "2024-03-15", captureTime: "12:00:00", cameraMake: "Canon", gpsLat: 30, gpsLng: 40,
  });
  return {
    draggingIds: ["x"],
    draggingPhotos: [makePhoto("x")],
    target: { kind: "gap", gap: { beforeId: "b", afterId: "f", dayKey: "2024-03-15" } },
    targetPhoto: null,
    neighborBefore: before,
    neighborAfter: after,
    ...overrides,
  };
}

describe("DropSettingsDialog — clone mode", () => {
  it("shows checkboxes for the three groups with previews of the target values", () => {
    render(
      <DropSettingsDialog drop={cloneDrop()} initialSettings={DEFAULT_DROP_SETTINGS} onResolve={vi.fn()} />,
    );
    expect(screen.getByText("Clone settings from photo")).toBeInTheDocument();
    expect(screen.getByText("Date & time")).toBeInTheDocument();
    expect(screen.getByText("Location")).toBeInTheDocument();
    expect(screen.getByText("Camera & film")).toBeInTheDocument();
    expect(screen.getByText("2024-03-15 10:30:00")).toBeInTheDocument();
    expect(screen.getByText("37.70000, -122.40000")).toBeInTheDocument();
    expect(screen.getByText("Canon EOS R5")).toBeInTheDocument();
    // Clone mode has no Left/Interpolate/Right controls
    expect(screen.queryByText("Interpolate Between")).not.toBeInTheDocument();
  });

  it("resolves with the chosen settings on Accept, respecting unchecked groups", () => {
    const onResolve = vi.fn();
    render(
      <DropSettingsDialog drop={cloneDrop()} initialSettings={DEFAULT_DROP_SETTINGS} onResolve={onResolve} />,
    );
    fireEvent.click(screen.getAllByRole("checkbox")[2]); // uncheck camera
    fireEvent.click(screen.getByText("Accept"));
    expect(onResolve).toHaveBeenCalledTimes(1);
    const settings = onResolve.mock.calls[0][0];
    expect(settings.timestamp.enabled).toBe(true);
    expect(settings.camera.enabled).toBe(false);
  });

  it("resolves with null on Cancel", () => {
    const onResolve = vi.fn();
    render(
      <DropSettingsDialog drop={cloneDrop()} initialSettings={DEFAULT_DROP_SETTINGS} onResolve={onResolve} />,
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onResolve).toHaveBeenCalledWith(null);
  });

  it("accepts on Enter", () => {
    const onResolve = vi.fn();
    render(
      <DropSettingsDialog drop={cloneDrop()} initialSettings={DEFAULT_DROP_SETTINGS} onResolve={onResolve} />,
    );
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve.mock.calls[0][0]).not.toBeNull();
  });

  it("shows the ⌘ hint", () => {
    render(
      <DropSettingsDialog drop={cloneDrop()} initialSettings={DEFAULT_DROP_SETTINGS} onResolve={vi.fn()} />,
    );
    expect(
      screen.getByText("In the future, hold ⌘ while dropping to adopt these settings automatically."),
    ).toBeInTheDocument();
  });
});

describe("DropSettingsDialog — gap mode", () => {
  it("splits groups into interpolatable and copy-only sections with source controls", () => {
    render(
      <DropSettingsDialog drop={gapDrop()} initialSettings={DEFAULT_DROP_SETTINGS} onResolve={vi.fn()} />,
    );
    expect(screen.getByText("Inherit settings from neighbors")).toBeInTheDocument();
    expect(screen.getByText("Interpolate")).toBeInTheDocument();
    expect(screen.getByText("Copy")).toBeInTheDocument();
    // timestamp + location get Interpolate; camera only Left/Right
    expect(screen.getAllByText("Interpolate Between")).toHaveLength(2);
    expect(screen.getAllByText("Copy Left")).toHaveLength(3);
    expect(screen.getAllByText("Copy Right")).toHaveLength(3);
  });

  it("previews the interpolated timestamp", () => {
    render(
      <DropSettingsDialog drop={gapDrop()} initialSettings={DEFAULT_DROP_SETTINGS} onResolve={vi.fn()} />,
    );
    expect(screen.getByText("2024-03-15 11:00:00")).toBeInTheDocument();
  });

  it("previews interpolation bounds for multiple photos", () => {
    const drop = gapDrop({
      draggingIds: ["x", "y", "z"],
      draggingPhotos: [makePhoto("x"), makePhoto("y"), makePhoto("z")],
    });
    render(
      <DropSettingsDialog drop={drop} initialSettings={DEFAULT_DROP_SETTINGS} onResolve={vi.fn()} />,
    );
    expect(screen.getByText("2024-03-15 10:30:00 → 2024-03-15 11:30:00")).toBeInTheDocument();
  });

  it("updates the preview when a source choice changes", () => {
    render(
      <DropSettingsDialog drop={gapDrop()} initialSettings={DEFAULT_DROP_SETTINGS} onResolve={vi.fn()} />,
    );
    expect(screen.getByText("Nikon")).toBeInTheDocument(); // camera defaults to Left
    const cameraRight = screen.getAllByText("Copy Right")[2];
    fireEvent.click(cameraRight);
    expect(screen.getByText("Canon")).toBeInTheDocument();
  });

  it("disables the missing side at an edge-of-block gap and snaps the selection away from it", () => {
    const onResolve = vi.fn();
    const drop = gapDrop({
      target: { kind: "gap", gap: { beforeId: null, afterId: "f", dayKey: "2024-03-15" } },
      neighborBefore: null,
    });
    render(
      <DropSettingsDialog
        drop={drop}
        initialSettings={{
          ...DEFAULT_DROP_SETTINGS,
          camera: { enabled: true, gapMode: "before" },
        }}
        onResolve={onResolve}
      />,
    );
    for (const left of screen.getAllByText("Copy Left")) {
      expect(left).toBeDisabled();
    }
    fireEvent.click(screen.getByText("Accept"));
    // camera "before" is impossible here — snapped to "after"
    expect(onResolve.mock.calls[0][0].camera.gapMode).toBe("after");
  });

  it("notes the 1-minute offset behavior when interpolating at an edge gap", () => {
    const drop = gapDrop({
      target: { kind: "gap", gap: { beforeId: "b", afterId: null, dayKey: "2024-03-15" } },
      neighborAfter: null,
    });
    render(
      <DropSettingsDialog drop={drop} initialSettings={DEFAULT_DROP_SETTINGS} onResolve={vi.fn()} />,
    );
    expect(
      screen.getByText("One neighbor is missing — times are offset from the neighbor by 1 minute per photo."),
    ).toBeInTheDocument();
  });

  it("disables a group with a message when no source has data for it", () => {
    // gapDrop neighbors carry no lens/film but DO carry cameraMake — strip camera
    const before = makePhoto("b", { captureDate: "2024-03-15", captureTime: "10:00:00" });
    const after = makePhoto("f", { captureDate: "2024-03-15", captureTime: "12:00:00" });
    render(
      <DropSettingsDialog
        drop={gapDrop({ neighborBefore: before, neighborAfter: after })}
        initialSettings={DEFAULT_DROP_SETTINGS}
        onResolve={vi.fn()}
      />,
    );
    // location and camera rows are disabled — no data on either neighbor
    expect(screen.getAllByText("Nothing to inherit")).toHaveLength(2);
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[1]).toBeDisabled();
    expect(checkboxes[2]).toBeDisabled();
    // and their source selectors are gone
    expect(screen.queryAllByText("Copy Left")).toHaveLength(1); // timestamp only
  });

  it("does not rewrite the remembered preference for an unavailable group", () => {
    const before = makePhoto("b", { captureDate: "2024-03-15", captureTime: "10:00:00" });
    const after = makePhoto("f", { captureDate: "2024-03-15", captureTime: "12:00:00" });
    const onResolve = vi.fn();
    render(
      <DropSettingsDialog
        drop={gapDrop({ neighborBefore: before, neighborAfter: after })}
        initialSettings={DEFAULT_DROP_SETTINGS}
        onResolve={onResolve}
      />,
    );
    fireEvent.click(screen.getByText("Accept"));
    // camera row was shown disabled, but the stored setting stays enabled
    expect(onResolve.mock.calls[0][0].camera.enabled).toBe(true);
  });

  it("hides the source selector when both neighbors hold identical values", () => {
    const shared = {
      captureDate: "2024-03-15", captureTime: "10:00:00",
      cameraMake: "Nikon", cameraModel: "Z9", gpsLat: 10, gpsLng: 20,
    };
    render(
      <DropSettingsDialog
        drop={gapDrop({
          neighborBefore: makePhoto("b", shared),
          neighborAfter: makePhoto("f", shared),
        })}
        initialSettings={DEFAULT_DROP_SETTINGS}
        onResolve={vi.fn()}
      />,
    );
    // No choice to make anywhere — just the values
    expect(screen.queryByText("Copy Left")).not.toBeInTheDocument();
    expect(screen.queryByText("Copy Right")).not.toBeInTheDocument();
    expect(screen.queryByText("Interpolate Between")).not.toBeInTheDocument();
    expect(screen.getByText("2024-03-15 10:00:00")).toBeInTheDocument();
    expect(screen.getByText("10.00000, 20.00000")).toBeInTheDocument();
    expect(screen.getByText("Nikon Z9")).toBeInTheDocument();
  });

  it("keeps the timestamp selector at an edge gap but hides camera/location selectors with one-sided data", () => {
    const drop = gapDrop({
      target: { kind: "gap", gap: { beforeId: "b", afterId: null, dayKey: "2024-03-15" } },
      neighborAfter: null,
    });
    render(
      <DropSettingsDialog drop={drop} initialSettings={DEFAULT_DROP_SETTINGS} onResolve={vi.fn()} />,
    );
    // Adopting vs interpolating still differ for timestamp (1-min stagger)
    expect(screen.getByText("Interpolate Between")).toBeInTheDocument();
    // Camera and location can only come from the left — no selector
    expect(screen.getAllByText("Copy Left")).toHaveLength(1);
    expect(screen.getByText("Nikon")).toBeInTheDocument();
    expect(screen.getByText("10.00000, 20.00000")).toBeInTheDocument();
  });

  it("shows 'Don't inherit' for an unchecked group", () => {
    render(
      <DropSettingsDialog
        drop={gapDrop()}
        initialSettings={{
          ...DEFAULT_DROP_SETTINGS,
          location: { enabled: false, gapMode: "interpolate" },
        }}
        onResolve={vi.fn()}
      />,
    );
    expect(screen.getByText("Don't inherit")).toBeInTheDocument();
  });
});
