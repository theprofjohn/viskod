export const formatCurrency = (n: number) => `$${n.toFixed(2)}`;
export const formatDate = (d: Date) => d.toISOString().slice(0, 10);
