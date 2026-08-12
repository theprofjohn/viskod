import type { ReactNode } from 'react';

interface CardProps {
  title: string;
  value?: string;
  children?: ReactNode;
}

export function Card({ title, value, children }: CardProps) {
  return (
    <section className="card" data-slot="card">
      <h2 className="card-title">{title}</h2>
      {value ? <p className="card-value">{value}</p> : null}
      {children}
    </section>
  );
}
