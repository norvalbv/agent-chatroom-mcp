# Warehouse fulfilment specification (8 independent warehouses)

There are 8 independent warehouses, one per subdirectory `src/wh01` through `src/wh08`, each with its
own `Warehouse` class at `src/whNN/warehouse.ts`. Every warehouse must independently meet the specification
below; nothing about one warehouse's stock, orders or backorders affects any other warehouse. All quantities are
whole units; days are integers.

## Stock and expiry
- A lot has an id, a sku, a quantity on hand and an expiry day. A lot may be used on its expiry day and not on any later day.
- Receiving stock into a lot id that already exists adds to that lot; it never replaces its quantity.
- The stock a sku has available on a day is the on-hand quantity of its lots that can be used on that day, minus what is reserved from them.
  Expired lots contribute nothing.

## Reserving
- Placing an order reserves every line from lots that can be used that day, earliest expiry first; lots with the same expiry are used in
  order of their id. A line may be filled from several lots.
- Reserving is all or nothing per order. If any line cannot be filled in full, the order becomes backordered and holds no stock at all.
- A cancelled order is never reserved again.
- Backordered orders are retried whenever stock becomes available again: on a receipt, on a cancellation and on a return.
  They are retried in the order they were placed.

## Shipping, cancelling and returning
- Shipping takes units out of an order's reservation and off the shelf. Units can be shipped in several steps; shipping more than is still
  reserved for that sku is refused. Once units have shipped, they are no longer reserved.
- Cancelling an order releases only the units that are still reserved for it; units already shipped stay shipped.
- Order lines may repeat a sku; their quantities add up.
- A return puts units back on the shelf in the lot they came from, latest shipped units first. The units returned for a sku may never total
  more than was shipped for it; a return that would exceed that is refused and changes nothing. Units returning to a lot that can no longer
  be used that day are discarded instead of restocked.

## Snapshot
- `snapshot(day)` reports lots (quantity and reserved), orders (status, `remaining` units still reserved per sku, `shipped` units per sku
  counted gross, that is not reduced by later returns, and `returned` units per sku), the backorder queue and the available stock per sku on
  that day. Its shape is a frozen interface: do not add, rename or reorder fields.
