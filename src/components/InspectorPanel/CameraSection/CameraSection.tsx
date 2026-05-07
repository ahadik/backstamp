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

interface CameraSectionProps {
  selectedPhotos: Photo[];
}

interface MultiValueConfirm {
  field: keyof Metadata;
  category: "camera_body" | "lens" | "film";
  value: string;
  count: number;
}

function sortedEntries(entries: CorpusEntry[]): CorpusEntry[] {
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

  const cameraBody = deriveFieldValue(selectedPhotos, (m) => m.cameraBody);
  const lens = deriveFieldValue(selectedPhotos, (m) => m.lens);
  const film = deriveFieldValue(selectedPhotos, (m) => m.film);

  function handleSelect(
    field: keyof Metadata,
    category: "camera_body" | "lens" | "film",
    currentValue: string | "multiple" | null,
    value: string
  ) {
    if (currentValue === "multiple") {
      const count = new Set(
        selectedPhotos.map((p) => (p.currentMetadata as unknown as Record<string, unknown>)[field])
      ).size;
      setMultiConfirm({ field, category, value, count });
      return;
    }
    doSelect(field, category, value);
  }

  function doSelect(
    field: keyof Metadata,
    category: "camera_body" | "lens" | "film",
    value: string
  ) {
    sessionDispatch({ type: "SET_PENDING", ids: selectedIds, changes: { [field]: value } });
    corpusDispatch({ type: "RECORD_USE", category: categoryToContext(category), value });
    tauriCommands.recordCorpusUse(category, value).catch(console.error);
  }

  function handleAdd(category: "camera_body" | "lens" | "film", value: string) {
    corpusDispatch({ type: "ADD_ENTRY", category: categoryToContext(category), value });
    tauriCommands.addCorpusEntry(category, value).catch(console.error);
  }

  function handleRemove(category: "camera_body" | "lens" | "film", value: string) {
    corpusDispatch({ type: "REMOVE_ENTRY", category: categoryToContext(category), value });
    tauriCommands.removeCorpusEntry(category, value).catch(console.error);
  }

  function categoryToContext(
    category: "camera_body" | "lens" | "film"
  ): "camera" | "lens" | "film" {
    if (category === "camera_body") return "camera";
    return category;
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
            <CorpusComboBox
              label="Camera Body"
              value={cameraBody}
              entries={sortedEntries(corpusState.cameraOptions)}
              onSelect={(v) => handleSelect("cameraBody", "camera_body", cameraBody, v)}
              onAddEntry={(v) => handleAdd("camera_body", v)}
              onRemoveEntry={(v) => handleRemove("camera_body", v)}
            />
            <CorpusComboBox
              label="Lens"
              value={lens}
              entries={sortedEntries(corpusState.lensOptions)}
              onSelect={(v) => handleSelect("lens", "lens", lens, v)}
              onAddEntry={(v) => handleAdd("lens", v)}
              onRemoveEntry={(v) => handleRemove("lens", v)}
            />
            <CorpusComboBox
              label="Film"
              value={film}
              entries={sortedEntries(corpusState.filmOptions)}
              onSelect={(v) => handleSelect("film", "film", film, v)}
              onAddEntry={(v) => handleAdd("film", v)}
              onRemoveEntry={(v) => handleRemove("film", v)}
            />
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
            doSelect(multiConfirm.field, multiConfirm.category, multiConfirm.value);
            setMultiConfirm(null);
          }}
          onCancel={() => setMultiConfirm(null)}
        />
      )}
    </div>
  );
}
