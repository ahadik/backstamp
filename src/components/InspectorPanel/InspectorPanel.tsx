import { useSession } from "../../state/SessionContext";
import { useUI } from "../../state/UIContext";
import { DateTimeSection } from "./DateTimeSection/DateTimeSection";
import { CameraSection } from "./CameraSection/CameraSection";
import { LocationSection } from "./LocationSection/LocationSection";
import { VibeTagSection } from "./VibeTagSection/VibeTagSection";
import styles from "./InspectorPanel.module.css";

interface InspectorPanelProps {
  onOpenSettings: () => void;
}

export function InspectorPanel({ onOpenSettings }: InspectorPanelProps) {
  const { state } = useSession();
  const { state: uiState } = useUI();

  const selectedPhotos = state.photos.filter((p) =>
    state.selectedIds.has(p.id)
  );

  const singlePhoto = selectedPhotos.length === 1 ? selectedPhotos[0] : null;
  const fileName = singlePhoto
    ? singlePhoto.filePath.split("/").pop() ?? singlePhoto.filePath
    : null;
  const dirPath = singlePhoto && fileName
    ? singlePhoto.filePath.slice(0, -(fileName.length + 1))
    : null;

  return (
    <aside
      id="inspector-panel"
      className={styles.panel}
      onKeyDown={(e) => { if (e.key === "Escape") e.stopPropagation(); }}
    >
      {singlePhoto && (
        <div className={styles.fileInfo}>
          <span className={styles.fileName}>{fileName}</span>
          <span className={styles.dirPath}>{dirPath}</span>
        </div>
      )}
      <div className={styles.sections}>
        <DateTimeSection selectedPhotos={selectedPhotos} />
        <CameraSection selectedPhotos={selectedPhotos} />
        <LocationSection
          selectedPhotos={selectedPhotos}
          onOpenSettings={onOpenSettings}
        />
        <VibeTagSection
          selectedPhotos={selectedPhotos}
          onOpenSettings={onOpenSettings}
        />
      </div>
      {uiState.mapboxToken && uiState.claudeApiKey && (
        <div className={styles.footer}>
          <button className={styles.manageKeysButton} onClick={onOpenSettings}>
            Manage API Keys
          </button>
        </div>
      )}
    </aside>
  );
}
