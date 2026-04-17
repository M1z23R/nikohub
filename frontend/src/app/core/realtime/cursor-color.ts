const palette = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16',
  '#10b981', '#06b6d4', '#3b82f6', '#6366f1',
  '#8b5cf6', '#d946ef', '#ec4899', '#14b8a6',
];

export function colorForUser(userId: string): string {
  const hex = userId.replace(/-/g, '').slice(0, 2);
  const n = parseInt(hex, 16);
  return palette[n % palette.length];
}
