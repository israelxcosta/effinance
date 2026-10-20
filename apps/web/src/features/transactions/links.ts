/** Payables (expense) or receivables (income) list filtered by category for a month ('YYYY-MM'). */
export function categoryListHref(type: 'income' | 'expense', categoryId: string, month: string): string {
  const base = type === 'expense' ? '/contas-a-pagar' : '/contas-a-receber';
  return `${base}?${new URLSearchParams({ categoria: categoryId, data: `${month}-01` })}`;
}
