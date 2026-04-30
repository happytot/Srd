/**
 * Cash Reconciliation Utilities
 * 
 * Core math for the Sales Report dashboard:
 * Cash on Hand = Total Sales − Digital Payments − Total Expenses
 * 
 * Used by SalesReport.jsx for real-time cash-flow summary cards and reconciliation.
 * All functions are pure (no side effects) and work with both raw Firestore data and filtered arrays.
 */

export function isDigitalPayment(paymentMethod) {
  const method = String(paymentMethod ?? 'Cash').trim().toLowerCase();
  return method !== 'cash';
}

export function orderLineAmount(row) {
  if (!row) return 0;
  return Number(row.amount ?? row.totalAmount ?? 0) || 0;
}

/**
 * Summarizes cash vs digital payments from an array of order rows.
 * @param {Array<{ paymentMethod?: string, amount?: number, totalAmount?: number }>} rows
 * @returns {{ totalSales: number, digitalPayments: number, cashSales: number, digitalCount: number, cashCount: number }}
 */
export function summarizeCashFromOrderRows(rows = []) {
  if (!Array.isArray(rows)) return { totalSales: 0, digitalPayments: 0, cashSales: 0, digitalCount: 0, cashCount: 0 };

  let totalSales = 0;
  let digitalPayments = 0;
  let cashSales = 0;
  let digitalCount = 0;
  let cashCount = 0;

  for (const row of rows) {
    const amt = orderLineAmount(row);
    totalSales += amt;

    if (isDigitalPayment(row?.paymentMethod)) {
      digitalPayments += amt;
      digitalCount += 1;
    } else {
      cashSales += amt;
      cashCount += 1;
    }
  }

  return { totalSales, digitalPayments, cashSales, digitalCount, cashCount };
}

/**
 * Final cash-on-hand calculation.
 * Formula: Cash on Hand = Total Sales − Digital Payments − Total Expenses
 */
export function computeCashOnHand(totalSales, digitalPayments, totalExpenses) {
  return (Number(totalSales) || 0) - (Number(digitalPayments) || 0) - (Number(totalExpenses) || 0);
}

/**
 * Simple sum of expense amounts (used in SalesReport expense table).
 * @param {Array<{ amount?: number }>} expenseRows
 * @returns {number}
 */
export function sumExpensesAmount(expenseRows = []) {
  if (!Array.isArray(expenseRows)) return 0;
  return expenseRows.reduce((sum, e) => sum + (Number(e?.amount) || 0), 0);
}