export const stripMd = (s: string | undefined | null): string => {
  if (!s) return '';
  return s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
};

export const urlFromMd = (s: string | undefined | null): string | null => {
  if (!s) return null;
  const m = s.match(/\[([^\]]+)\]\(([^)]+)\)/);
  return m ? m[2]! : null;
};
