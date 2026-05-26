// supabase/functions/_shared/money.ts
//
// Helper compartido de formato monetario para presentación al usuario
// en facturas PDF y emails (armario, magazine, marketplace).
//
// Formato español: punto como separador de miles, coma decimal.
// Ej: 234567 céntimos → "2.345,67 €"
//
// IMPORTANTE: solo para PRESENTACIÓN. No usar en cálculos internos —
// siempre trabajar en céntimos enteros y aplicar fmtEur al final.

export function fmtEur(cents: number): string {
  const value = cents / 100;
  const fmt = new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
  return `${fmt} €`;
}
