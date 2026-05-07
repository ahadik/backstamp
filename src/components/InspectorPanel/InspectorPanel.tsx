import { useState } from "react";
import { useSession } from "../../state/SessionContext";
import { DateTimeSection } from "./DateTimeSection/DateTimeSection";
import { CameraSection } from "./CameraSection/CameraSection";
import { LocationSection } from "./LocationSection/LocationSection";
import { VibeTagSection } from "./VibeTagSection/VibeTagSection";
import { SettingsDrawer } from "../Settings/SettingsDrawer";
import styles from "./InspectorPanel.module.css";

export function InspectorPanel() {
  const { state } = useSession();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const selectedPhotos = state.photos.filter((p) =>
    state.selectedIds.has(p.id)
  );

  return (
    <aside
      id="inspector-panel"
      className={styles.panel}
      onKeyDown={(e) => { if (e.key === "Escape") e.stopPropagation(); }}
    >
      <div className={styles.sections}>
        <DateTimeSection selectedPhotos={selectedPhotos} />
        <CameraSection selectedPhotos={selectedPhotos} />
        <LocationSection
          selectedPhotos={selectedPhotos}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <VibeTagSection
          selectedPhotos={selectedPhotos}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </div>

      {settingsOpen && (
        <SettingsDrawer onClose={() => setSettingsOpen(false)} />
      )}
    </aside>
  );
}
