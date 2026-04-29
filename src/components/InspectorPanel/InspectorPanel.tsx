import styles from "./InspectorPanel.module.css";

const SECTIONS = [
  { key: "datetime", label: "Date & Time" },
  { key: "location", label: "Location" },
  { key: "camera", label: "Camera Details" },
  { key: "vibe", label: "Vibe Tag" },
];

export function InspectorPanel() {
  return (
    <aside className={styles.panel}>
      <div className={styles.sections}>
        {SECTIONS.map((s) => (
          <div key={s.key} className="inspector-card">
            <div className={styles.sectionHeader}>
              <span className="section-label">{s.label}</span>
            </div>
            <div className={styles.sectionBody} />
          </div>
        ))}
      </div>
      <button className={styles.fab} disabled aria-label="Add">+</button>
    </aside>
  );
}
