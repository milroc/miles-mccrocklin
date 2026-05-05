import type { ReactNode } from 'react';
import { SectionHead } from './SectionHead';
import s from './Section.module.css';

interface SectionProps {
  title: string;
  show?: boolean;
  children: ReactNode;
}

export function Section({ title, show, children }: SectionProps) {
  if (show === false) return null;
  return (
    <section className={s.section}>
      <SectionHead title={title} />
      {children}
    </section>
  );
}
