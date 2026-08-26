# Meter the platform's own API traffic

MeteringCo bills its customers for what they measure. It does not bill itself. Every
call a tenant makes to this API is a unit of the platform's own product, and
finance wants those calls to reach an invoice the way any other usage does.

Build that path.

**Register a call.** Serving a request for a tenant, and accepting a measurement
from one, each count as one API call. Record the call against the platform's own
customer for that tenant — the one `TokenConsumerService.getMeteringCoCustomerId`
resolves — in the aggregate bucket the token consumer processor names. A call
arrives with an amount, a moment and identifying metadata. There are a great
many of them, so recording one must not add a round trip to the request it
describes.

**Close a period.** A scheduled job runs every six hours. Given a window it
totals one platform customer's registered traffic across that window; given
none, it closes the six hours behind it. `InfluxService.aggregateMeteringCoToken`
reads a window already.

**Bill the period.** The total becomes a single token for that period, and that
token becomes billable usage against the platform's own account — the production
account and its dimension when the platform customer belongs to production, the
sandbox pair otherwise. `TokenConsumerService.create` is where a token is turned
into billable usage.

Two things about the traffic. Delivery is at-least-once, so the same call can be
handed over twice, with a flush or an entire period between the two arrivals.
Delivery is also unordered, so a call can arrive behind one that happened later
than it, or after the period it belongs to has been closed and billed.

A call belongs to the period its own moment falls in, and that is where it is
recorded however late it turns up. When a call reached you is not part of the
record, and a late arrival is never re-dated forward into a period it did not
happen in. So neither kind of arrival may move an invoice that has already been
issued, and neither may be dropped on the floor: a call whose period has already
been closed is still recorded, at its own moment, and the closed period is not
re-opened to bill it.

The store the box talks to holds a recorded stretch of the platform metering
itself: the buckets, the tags, the accounts, the dimensions and the amounts are
all readable there.
