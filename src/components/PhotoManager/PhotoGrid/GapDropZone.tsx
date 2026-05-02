import styles from "./GapDropZone.module.css";

interface Props {
  side: "left" | "right";
}

export function GapDropZone({ side }: Props) {
  return <div className={`${styles.line} ${styles[side]}`} />;
}
