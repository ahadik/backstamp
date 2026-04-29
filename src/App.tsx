import styles from "./App.module.css";
import { PhotoManager } from "./components/PhotoManager/PhotoManager";
import { ControlBar } from "./components/ControlBar/ControlBar";
import { InspectorPanel } from "./components/InspectorPanel/InspectorPanel";
import { MapPanel } from "./components/MapPanel/MapPanel";

function App() {
  return (
    <div className="app-shell">
      <PhotoManager />
      <div className={styles.rightColumn}>
        <ControlBar />
        <InspectorPanel />
      </div>
      <MapPanel />
    </div>
  );
}

export default App;
