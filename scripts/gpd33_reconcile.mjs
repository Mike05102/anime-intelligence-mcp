import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const hashPattern = /^[0-9a-f]{64}$/;
const environments = new Set(['test', 'live']);
const reference = value => typeof value === 'string' && /^[A-Za-z0-9:_./#-]{1,200}$/.test(value);
const uuid = value => typeof value === 'string' && uuidPattern.test(value);
const hash = value => typeof value === 'string' && hashPattern.test(value);
const amount = value => typeof value === 'string' && /^[1-9][0-9]{0,29}$/.test(value);
const group = (environment, id) => environment + ':' + id;

function index(rows, fields, keyFor, affectedFor, isValid) {
  const all = new Map();
  const conflicts = new Set();
  if (!Array.isArray(rows) || rows.length > 20000) throw new Error('Invalid or oversized evidence collection');
  for (const row of rows) {
    if (!row || typeof row !== 'object' || !environments.has(row.environment) || !isValid(row)) {
      throw new Error('Invalid evidence record');
    }
    const key = keyFor(row);
    const prior = all.get(key);
    const fingerprint = JSON.stringify(fields.map(field => row[field]));
    if (!prior) all.set(key, {row, fingerprint});
    else if (prior.fingerprint !== fingerprint) {
      conflicts.add(affectedFor(prior.row));
      conflicts.add(affectedFor(row));
    }
  }
  return {rows:[...all.values()].map(entry => entry.row), conflicts};
}

function groupBy(rows, keyFor) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

const byHandoff = row => group(row.environment, row.handoff_id);

export function reconcileGpd33Evidence(input) {
  if (!input || input.schema_version !== 1 || !environments.has(input.environment)) {
    throw new Error('Invalid evidence baseline');
  }
  // No API or database access. Verification is a precondition of the trusted input boundary.
  const handoffs = index(input.handoffs, ['merchant_id','order_reference_hash','state'], byHandoff, byHandoff,
    row => uuid(row.handoff_id) && uuid(row.merchant_id) && hash(row.order_reference_hash)
      && ['order_reported','cancelled'].includes(row.state));
  const orders = index(input.orders, ['handoff_id','merchant_id','order_reference_hash','state','verification'],
    row => group(row.environment, row.source + '|' + row.record_id), byHandoff,
    row => uuid(row.handoff_id) && uuid(row.merchant_id) && hash(row.order_reference_hash)
      && reference(row.source) && reference(row.record_id) && ['confirmed','cancelled'].includes(row.state)
      && ['authoritative_ledger','unverified'].includes(row.verification));
  const fees = index(input.fees, ['handoff_id','merchant_id','agreement_id','network','asset','amount_atomic','payer','payee','approval'],
    row => group(row.environment, row.invoice_id), byHandoff,
    row => uuid(row.handoff_id) && uuid(row.merchant_id) && reference(row.invoice_id)
      && reference(row.agreement_id) && reference(row.network) && reference(row.asset) && amount(row.amount_atomic)
      && reference(row.payer) && reference(row.payee) && row.payer !== row.payee
      && ['contract_verified','unverified'].includes(row.approval));
  const receipts = index(input.receipts, ['invoice_id','handoff_id','asset','amount_atomic','payer','payee','category','direction','verification'],
    row => group(row.environment, row.network + '|' + row.transfer_id), byHandoff,
    row => uuid(row.handoff_id) && reference(row.invoice_id) && reference(row.transfer_id)
      && reference(row.network) && reference(row.asset) && amount(row.amount_atomic)
      && reference(row.payer) && reference(row.payee) && row.payer !== row.payee
      && ['brokerage_fee','x402_information','goods_payment'].includes(row.category)
      && ['credit','refund'].includes(row.direction)
      && ['finalized_ledger','unverified'].includes(row.verification));
  const conflicts = new Set([handoffs, orders, fees, receipts].flatMap(entries => [...entries.conflicts]));
  const inScope = row => row.environment === input.environment;
  // A merchant order must map to only one GPD handoff, even if exported under multiple ledger IDs.
  const claimsByOrder = groupBy([...handoffs.rows, ...orders.rows.filter(row =>
    row.verification === 'authoritative_ledger')].filter(inScope),
    row => row.merchant_id + '|' + row.order_reference_hash);
  for (const claims of claimsByOrder.values()) {
    const claimed = new Set(claims.map(byHandoff));
    if (claimed.size > 1) for (const key of claimed) conflicts.add(key);
  }
  const ordersByHandoff = groupBy(orders.rows.filter(inScope), byHandoff);
  const feesByHandoff = groupBy(fees.rows.filter(inScope), byHandoff);
  const receiptsByInvoice = groupBy(receipts.rows.filter(inScope), row => row.invoice_id);
  const totals = new Map();
  const results = [];
  for (const handoff of handoffs.rows.filter(inScope)) {
    const key = byHandoff(handoff);
    const result = {handoff_id:handoff.handoff_id,order:'unverified',brokerage_fee:'pending_order_evidence'};
    results.push(result);
    if (conflicts.has(key)) {
      result.brokerage_fee = 'conflicting_evidence';
      continue;
    }
    const matchedOrders = (ordersByHandoff.get(key) || []).filter(order =>
      order.verification === 'authoritative_ledger' && order.merchant_id === handoff.merchant_id
        && order.order_reference_hash === handoff.order_reference_hash);
    if (matchedOrders.length !== 1) {
      if (matchedOrders.length) result.brokerage_fee = 'ambiguous_order';
      continue;
    }
    const [order] = matchedOrders;
    if ((order.state === 'cancelled') !== (handoff.state === 'cancelled')) {
      result.brokerage_fee = 'conflicting_order_state';
      continue;
    }
    result.order = order.state;
    const contracts = (feesByHandoff.get(key) || []).filter(fee => fee.approval === 'contract_verified'
      && fee.merchant_id === handoff.merchant_id);
    if (contracts.length !== 1) {
      result.brokerage_fee = contracts.length ? 'ambiguous_agreement' : 'missing_agreement';
      continue;
    }
    const [fee] = contracts;
    const transfers = (receiptsByInvoice.get(fee.invoice_id) || []).filter(receipt =>
      receipt.category === 'brokerage_fee' && receipt.verification === 'finalized_ledger');
    if (transfers.some(receipt => receipt.handoff_id !== handoff.handoff_id || receipt.network !== fee.network
      || receipt.asset !== fee.asset || (receipt.direction === 'credit'
        ? receipt.payer !== fee.payer || receipt.payee !== fee.payee
        : receipt.payer !== fee.payee || receipt.payee !== fee.payer))) {
      result.brokerage_fee = 'receipt_mismatch';
      continue;
    }
    let credited = 0n, refunded = 0n;
    for (const transfer of transfers) {
      if (transfer.direction === 'credit') credited += BigInt(transfer.amount_atomic);
      else refunded += BigInt(transfer.amount_atomic);
    }
    const expected = BigInt(fee.amount_atomic);
    if (credited > expected || refunded > credited) {
      result.brokerage_fee = 'receipt_mismatch';
      continue;
    }
    const net = credited - refunded;
    if (order.state === 'cancelled') result.brokerage_fee = !credited ? 'cancelled_unpaid' : net === 0n ? 'refunded' : 'refund_pending';
    else if (credited === expected && refunded === 0n) {
      result.brokerage_fee = 'matched';
      const asset = fee.network + '|' + fee.asset;
      totals.set(asset, (totals.get(asset) || 0n) + net);
    } else if (refunded) result.brokerage_fee = 'refund_requires_review';
    else result.brokerage_fee = credited ? 'underpaid' : 'unpaid';
  }
  return {
    scope: input.environment === 'test' ? 'test_only' : 'supplied_live_evidence_only',
    confirmed_orders: results.filter(result => result.order === 'confirmed').length,
    cancelled_orders: results.filter(result => result.order === 'cancelled').length,
    matched_brokerage_fee_atomic: Object.fromEntries([...totals].sort().map(([asset, total]) => [asset, total.toString()])),
    results: results.sort((a,b) => a.handoff_id.localeCompare(b.handoff_id))
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    // A local file is preferred to avoid accidentally echoing private ledger exports through a terminal.
    const source = process.argv[2];
    if (!source || process.argv.length !== 3) throw new Error('Expected one evidence file');
    const report = reconcileGpd33Evidence(JSON.parse(await readFile(source, 'utf8')));
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } catch {
    process.stderr.write('Reconciliation failed. Check local evidence schema and sources.\n');
    process.exitCode = 1;
  }
}
