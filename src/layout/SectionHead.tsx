// Eyebrow label + horizontal rule that opens each top-level resume section.
import s from './SectionHead.module.css';

interface SectionHeadProps {
  title: string;
}

export function SectionHead({ title }: SectionHeadProps) {
  return (
    <div className={s.sectionHead}>
      <h2>{title}</h2>
      <div className={s.rule} />
    </div>
  );
}
