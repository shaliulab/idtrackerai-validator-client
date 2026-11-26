// Phones: some tables are shown one card per row (index.css, `.stack-narrow` and the Data collector's tables),
// each cell preceded by its column's name. The names come from the table's header: copied here into each cell's
// data-label, kept up to date as React renders rows (one pass per animation frame after DOM changes).
// Nothing changes on wider screens (the attribute is only read by the phone CSS).
export const STACK_SELECTOR = '.sc-tab table.ov-table, table.stack-narrow';

function labelTable(table) {
  const head = table.tHead?.rows[0];
  if (!head) return;
  const names = [];
  for (const th of head.cells) {
    for (let k = 0; k < (th.colSpan || 1); k += 1) names.push(th.textContent.trim());
  }
  for (const body of table.tBodies) {
    for (const tr of body.rows) {
      let col = 0;
      for (const td of tr.cells) {
        const name = td.colSpan > 1 ? '' : (names[col] || '');
        if (td.dataset.label !== name) td.dataset.label = name;
        col += td.colSpan || 1;
      }
    }
  }
}

export function installResponsiveTables() {
  if (typeof window === 'undefined' || !window.MutationObserver) return;
  // only on phones (the same width as index.css's phone layout): no work at all on a desktop
  const phone = window.matchMedia('(max-width: 760px)');
  let queued = false;
  const run = () => {
    queued = false;
    if (phone.matches) document.querySelectorAll(STACK_SELECTOR).forEach(labelTable);
  };
  phone.addEventListener?.('change', run);
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(run);
  }).observe(document.body, { childList: true, subtree: true });
  run();
}
