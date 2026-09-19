import type { SVGProps } from 'react';

/** Logo de Ícaro (versión React del Wing.astro): un ala de trazo simple. Hereda el color del texto. */
export default function Wing(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M3 27C7 13 17 5 29 5" />
      <path d="M29 5c-4 5-9 9-16 12" />
      <path d="M24 11c-4 5-9 8-15 10" />
      <path d="M18 17c-4 4-8 7-15 10" />
    </svg>
  );
}
