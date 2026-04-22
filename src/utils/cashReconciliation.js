/**
 * Cash reconciliation: physical cash expected vs digital and expenses.
 * Formula: Cash on Hand = Total Sales − Digital (non-cash) payments − Expenses
 */

export function isDigitalPayment(paymentMethod) {
  const m = String(paymentMethod ?? 'Cash').trim().toLowerCase();
  return m !== 'cash';
}

export function orderLineAmount(row) {
  return Number(row.amount ?? row.totalAmount ?? 0) || 0;
}

/**
 * @param {Array<{ paymentMethod?: string, amount?: number, totalAmount?: number }>} rows
 * @returns {{ totalSales: number, digitalPayments: number, cashSales: number, digitalCount: number, cashCount: number }}
 */
export function summarizeCashFromOrderRows(rows) {
  let totalSales = 0;
  let digitalPayments = 0;
  let cashSales = 0;
  let digitalCount = 0;
  let cashCount = 0;

  for (const row of rows) {
    const amt = orderLineAmount(row);
    totalSales += amt;
    if (isDigitalPayment(row.paymentMethod)) {
      digitalPayments += amt;
      digitalCount += 1;
    } else {
      cashSales += amt;
      cashCount += 1;
    }
  }

  return { totalSales, digitalPayments, cashSales, digitalCount, cashCount };
}

export function computeCashOnHand(totalSales, digitalPayments, totalExpenses) {
  return totalSales - digitalPayments - totalExpenses;
}

export function sumExpensesAmount(expenseRows) {
  return expenseRows.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
}
