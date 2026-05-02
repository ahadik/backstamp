import styles from "./DayBlockHeader.module.css";

interface Props {
  label: string;
  count: number;
}

export function DayBlockHeader({ label, count }: Props) {
  return (
    <div className={styles.dayBlockHeader}>
      <div className={styles.row}>
        <span className={styles.label}>{label}</span>
        <span className={styles.count}>
          {count} photo{count !== 1 ? "s" : ""}
        </span>
      </div>
      <div className={styles.divider} />
    </div>
  );
}
