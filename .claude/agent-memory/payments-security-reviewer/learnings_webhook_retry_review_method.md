---
name: learnings-webhook-retry-review-method
description: Questions to ask when auditing a webhook handler that answers 500 to get a redelivery and reads the provider's current state before writing - permanent vs transient error codes, constraints on written columns, what a concurrent final event does, and which test proves each rule
metadata:
  type: reference
---

A method for reviewing a webhook that (a) answers 500 so the provider sends the event again and
(b) writes the object's current state, read from the provider, instead of the event's copy.

- **Sort every 500 path into transient or permanent.** A connection error, a timeout or a rate
  limit goes away; a constraint error does not (Postgres class 23: 23503 foreign key, 23505
  unique, 23514 check; 22P02 for a value of the wrong type). A permanent error answered 500 is
  retried for the whole redelivery window. For each one, ask who can cause it and whether the
  event can ever be recorded.
- **List the constraints on every column the handler writes** (foreign keys, unique columns,
  CHECK lists, the primary key when an upsert conflicts on another column) and compare each with
  every value the provider can send. A unique column that the handler writes on a second table
  is easy to miss.
- **A value from provider metadata that is used as a key should be validated the same way on
  every path** (shape, and that the row it names exists). Compare the paths side by side.
- **Reading current state makes sequential handling order-independent; ask separately about
  concurrent handling.** Two deliveries can run at once, so check what happens when a final
  event is handled between another handler's read and its write.
- **A guard on one event type should be checked against every other event type that writes the
  same row**, including the ones documented as exempt.
- **For each rule, name the test that fails when the rule is removed.** A test that asserts
  only "the write happened" does not prove what was written; look for the status and tier in the
  assertion.
- `.maybeSingle()` returns an error for more than one row, so it is only a clean miss/hit lookup
  on a unique or primary-key column: confirm the column is unique in the migrations.
