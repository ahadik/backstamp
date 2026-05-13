import { useState } from "react";
import { useSession } from "../../../state/SessionContext";
import { useCorpus } from "../../../state/CorpusContext";
import { deriveFieldValue } from "../../../lib/inspectorUtils";
import { CorpusComboBox } from "../../common/CorpusComboBox/CorpusComboBox";
import { ConfirmDialog } from "../../common/ConfirmDialog/ConfirmDialog";
import { tauriCommands } from "../../../lib/tauri";
import type { Photo, Metadata } from "../../../state/SessionContext";
import type { CorpusEntry } from "../../../state/CorpusContext";
import styles from "./CameraSection.module.css";

function persistPending(ids: string[], changes: Partial<Metadata>) {
  const fields = Object.entries(changes).map(([field, value]) => ({
    field,
    value: value == null ? null : String(value),
  }));
  tauriCommands.setPendingChanges(ids, fields).catch(console.error);
}

interface CameraSectionProps {
  selectedPhotos: Photo[];
}

interface MultiValueConfirm {
  changes: Partial<Metadata>;
  count: number;
}

export function sortedEntries(entries: CorpusEntry[]): CorpusEntry[] {
  return [...entries].sort((a, b) => {
    if (a.lastUsed && b.lastUsed) return b.lastUsed - a.lastUsed;
    if (a.lastUsed) return -1;
    if (b.lastUsed) return 1;
    return a.value.localeCompare(b.value);
  });
}

export function CameraSection({ selectedPhotos }: CameraSectionProps) {
  const { dispatch: sessionDispatch } = useSession();
  const { state: corpusState, dispatch: corpusDispatch } = useCorpus();
  const [multiConfirm, setMultiConfirm] = useState<MultiValueConfirm | null>(null);

  const selectedIds = selectedPhotos.map((p) => p.id);

  const cameraMake = deriveFieldValue(selectedPhotos, (m) => m.cameraMake);
  const cameraModel = deriveFieldValue(selectedPhotos, (m) => m.cameraModel);
  const lens = deriveFieldValue(selectedPhotos, (m) => m.lens);
  const filmVendor = deriveFieldValue(selectedPhotos, (m) => m.filmVendor);
  const filmType = deriveFieldValue(selectedPhotos, (m) => m.filmType);

  // Model is enabled only when a single, known make is selected.
  const activeMake = cameraMake !== null && cameraMake !== "multiple" ? cameraMake : null;
  const filteredModelOptions = sortedEntries(
    activeMake
      ? corpusState.cameraModelOptions.filter(
          (m) => m.vendor == null || m.vendor.toLowerCase() === activeMake.toLowerCase()
        )
      : []
  );

  // Film type dropdown is enabled only when there is a single, known vendor selected.
  const activeVendor = filmVendor !== null && filmVendor !== "multiple" ? filmVendor : null;
  const filteredFilmTypes = sortedEntries(
    activeVendor
      ? corpusState.filmTypes.filter((t) => (t.vendor ?? "").toLowerCase() === activeVendor.toLowerCase())
      : []
  );

  function maybeConfirmChanges(
    changes: Partial<Metadata>,
    currentValue: string | "multiple" | null,
    getField: (m: Metadata) => unknown
  ) {
    if (currentValue === "multiple") {
      const count = new Set(selectedPhotos.map((p) => getField(p.currentMetadata))).size;
      setMultiConfirm({ changes, count });
    } else {
      applyChanges(changes);
    }
  }

  function applyChanges(changes: Partial<Metadata>) {
    sessionDispatch({ type: "SET_PENDING", ids: selectedIds, changes });
    persistPending(selectedIds, changes);
  }

  function handleMakeSelect(value: string) {
    // Clearing/changing make also clears model since model depends on make.
    maybeConfirmChanges({ cameraMake: value || null, cameraModel: null }, cameraMake, (m) => m.cameraMake);
    corpusDispatch({ type: "RECORD_USE", category: "camera_make", value });
    tauriCommands.recordCorpusUse("camera_make", value).catch(console.error);
  }

  function handleModelSelect(value: string) {
    maybeConfirmChanges({ cameraModel: value || null }, cameraModel, (m) => m.cameraModel);
    if (activeMake) {
      corpusDispatch({ type: "RECORD_USE", category: "camera_model", value, vendor: activeMake });
      tauriCommands.recordCorpusUse("camera_model", value, activeMake).catch(console.error);
    }
  }

  function handleLensSelect(value: string) {
    maybeConfirmChanges({ lens: value }, lens, (m) => m.lens);
    corpusDispatch({ type: "RECORD_USE", category: "lens", value });
    tauriCommands.recordCorpusUse("lens", value).catch(console.error);
  }

  function handleFilmVendorSelect(value: string) {
    // Clearing vendor also clears type since type depends on vendor.
    maybeConfirmChanges({ filmVendor: value || null, filmType: null }, filmVendor, (m) => m.filmVendor);
    corpusDispatch({ type: "RECORD_USE", category: "film_vendor", value });
    tauriCommands.recordCorpusUse("film_vendor", value).catch(console.error);
  }

  function handleFilmTypeSelect(value: string) {
    // Always include current vendor in the change so the write layer has both fields.
    maybeConfirmChanges(
      { filmVendor: activeVendor, filmType: value || null },
      filmType,
      (m) => m.filmType
    );
    if (activeVendor) {
      corpusDispatch({ type: "RECORD_USE", category: "film_type", value, vendor: activeVendor });
      tauriCommands.recordCorpusUse("film_type", value, activeVendor).catch(console.error);
    }
  }

  function handleAdd(category: "camera_make" | "lens", value: string) {
    corpusDispatch({ type: "ADD_ENTRY", category, value });
    tauriCommands.addCorpusEntry(category, value).catch(console.error);
  }

  function handleRemove(category: "camera_make" | "lens", value: string) {
    corpusDispatch({ type: "REMOVE_ENTRY", category, value });
    tauriCommands.removeCorpusEntry(category, value).catch(console.error);
  }

  function handleAddModel(value: string) {
    if (!activeMake) return;
    corpusDispatch({ type: "ADD_ENTRY", category: "camera_model", value, vendor: activeMake });
    tauriCommands.addCorpusEntry("camera_model", value, activeMake).catch(console.error);
  }

  function handleRemoveModel(value: string) {
    if (!activeMake) return;
    corpusDispatch({ type: "REMOVE_ENTRY", category: "camera_model", value, vendor: activeMake });
    tauriCommands.removeCorpusEntry("camera_model", value, activeMake).catch(console.error);
  }

  function handleAddVendor(value: string) {
    corpusDispatch({ type: "ADD_ENTRY", category: "film_vendor", value });
    tauriCommands.addCorpusEntry("film_vendor", value).catch(console.error);
  }

  function handleRemoveVendor(value: string) {
    // Cascade: remove all types for this vendor, then remove the vendor.
    corpusState.filmTypes
      .filter((t) => (t.vendor ?? "").toLowerCase() === value.toLowerCase())
      .forEach((t) => {
        corpusDispatch({ type: "REMOVE_ENTRY", category: "film_type", value: t.value, vendor: value });
        tauriCommands.removeCorpusEntry("film_type", t.value, value).catch(console.error);
      });
    corpusDispatch({ type: "REMOVE_ENTRY", category: "film_vendor", value });
    tauriCommands.removeCorpusEntry("film_vendor", value).catch(console.error);
  }

  function handleAddType(value: string) {
    if (!activeVendor) return;
    corpusDispatch({ type: "ADD_ENTRY", category: "film_type", value, vendor: activeVendor });
    tauriCommands.addCorpusEntry("film_type", value, activeVendor).catch(console.error);
  }

  function handleRemoveType(value: string) {
    if (!activeVendor) return;
    corpusDispatch({ type: "REMOVE_ENTRY", category: "film_type", value, vendor: activeVendor });
    tauriCommands.removeCorpusEntry("film_type", value, activeVendor).catch(console.error);
  }

  const isEmpty = selectedPhotos.length === 0;

  return (
    <div className={styles.section}>
      <div className="section-label">Camera Details</div>
      <div className={`inspector-card ${styles.card}`}>
        {isEmpty ? (
          <p className={styles.empty}>No photos selected</p>
        ) : (
          <div className={styles.fields}>
            <div className={styles.cameraRow}>
              <div className={styles.makeField}>
                <span className={styles.subLabel}>Make</span>
                <CorpusComboBox
                  label=""
                  value={cameraMake}
                  entries={sortedEntries(corpusState.cameraMakeOptions)}
                  onSelect={handleMakeSelect}
                  onAddEntry={(v) => handleAdd("camera_make", v)}
                  onRemoveEntry={(v) => handleRemove("camera_make", v)}
                  placeholder={cameraMake === "multiple" ? "Multiple Values" : "Make"}
                />
              </div>
              <div className={styles.modelField}>
                <span className={styles.subLabel}>Model</span>
                <CorpusComboBox
                  label=""
                  value={activeMake ? cameraModel : null}
                  entries={filteredModelOptions}
                  onSelect={handleModelSelect}
                  onAddEntry={handleAddModel}
                  onRemoveEntry={handleRemoveModel}
                  placeholder={
                    !activeMake
                      ? "Select make first"
                      : cameraModel === "multiple"
                      ? "Multiple Values"
                      : "Model"
                  }
                  disabled={!activeMake}
                />
              </div>
            </div>
            <CorpusComboBox
              label="Lens"
              value={lens}
              entries={sortedEntries(corpusState.lensOptions)}
              onSelect={handleLensSelect}
              onAddEntry={(v) => handleAdd("lens", v)}
              onRemoveEntry={(v) => handleRemove("lens", v)}
            />
            <div className={styles.filmRow}>
              <div className={styles.filmVendorField}>
                <span className={styles.subLabel}>Film Vendor</span>
                <CorpusComboBox
                  label=""
                  value={filmVendor}
                  entries={sortedEntries(corpusState.filmVendors)}
                  onSelect={handleFilmVendorSelect}
                  onAddEntry={handleAddVendor}
                  onRemoveEntry={handleRemoveVendor}
                  placeholder={filmVendor === "multiple" ? "Multiple Values" : "Vendor"}
                />
              </div>
              <div className={styles.filmTypeField}>
                <span className={styles.subLabel}>Film Type</span>
                <CorpusComboBox
                  label=""
                  value={activeVendor ? filmType : null}
                  entries={filteredFilmTypes}
                  onSelect={handleFilmTypeSelect}
                  onAddEntry={handleAddType}
                  onRemoveEntry={handleRemoveType}
                  placeholder={
                    !activeVendor
                      ? "Select vendor first"
                      : filmType === "multiple"
                      ? "Multiple Values"
                      : "Type"
                  }
                  disabled={!activeVendor}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {multiConfirm && (
        <ConfirmDialog
          title="Overwrite Multiple Values?"
          message={
            <>
              You are about to overwrite <strong>{multiConfirm.count}</strong> different values
              with a single value. Continue?
            </>
          }
          confirmLabel="Overwrite"
          onConfirm={() => {
            applyChanges(multiConfirm.changes);
            setMultiConfirm(null);
          }}
          onCancel={() => setMultiConfirm(null)}
        />
      )}
    </div>
  );
}
