import { useState } from 'react';

/** A number box that can be cleared while typing; the value is checked when you leave it. */
export function NumberInput({ value, onChange, min, fallback, ...rest }: { value: number; onChange: (n: number) => void; min?: number; fallback: number } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState<string>();
  const commit = (s: string) => {
    const n = Number(s);
    return s.trim() !== '' && Number.isFinite(n) ? Math.max(min ?? -Infinity, n) : fallback;
  };
  return (
    <input
      {...rest}
      type="number"
      min={min}
      value={draft ?? value}
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(Number(e.target.value))) onChange(commit(e.target.value));
      }}
      onBlur={(e) => {
        onChange(commit(e.target.value));
        setDraft(undefined);
      }}
    />
  );
}
