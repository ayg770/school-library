# Integration with the student-management system

Nothing here is built yet. This file records the boundary the rest of the
system is being designed around, so that connecting to the school's existing
student application later is an addition rather than a rewrite.

`PRODUCT_SPEC.md` §8, §9, §31 and §32 are the source; this is the working
summary.

## Who owns what

The rule that everything else follows: **there are never two authoritative
copies of the same data.**

| The student system owns | The library owns |
|---|---|
| A student's permanent identity | Books and physical copies |
| Current name | Checkouts and returns |
| Class | Overdue state |
| Active/inactive school status | Library history |
| School profile information | Lost and damaged library items |

The library holds a **copy** of the first column, for display and for
circulation. It does not edit it, and it does not write it back unless that is
deliberately designed later.

## Identity

**A name is never an identifier.** Names change, students share them, and
spelling varies between systems. Matching on a name produces silent, wrong
links to real children's records.

Every student therefore carries a permanent external identifier, stored in
`external_student_links` (§7) rather than as a column on `students`:

- one local student may map to more than one external system;
- `UNIQUE(system_key, external_student_id)` prevents two students claiming the
  same external record;
- `is_primary` marks the authoritative link.

**Before the API exists.** Students are imported from CSV/XLSX. If the export
carries a stable student ID, it is stored in `external_student_links`
immediately. If it carries only names, they are imported as-is and reconciled
**once** when identifiers become available — after which the external ID is
persisted permanently and never matched by name again.

## Which direction data flows

```
  Student system  ──── roster (one-way) ───▶  Library
                                              students, classes,
                                              active status

  Library  ──── loan activity (outbox) ───▶  Student system
             checked out, returned, renewed,
             due date changed, lost, found
```

No direct database-to-database coupling in either direction.

## Getting library status onto a student's card

Two approaches, both supported by the design. Which one applies depends on
answers this project does not have yet.

**A — live API.** The student application asks the library service directly:

```
GET /api/v1/integrations/students/{externalStudentId}/library-summary
```

Always current, no duplicated loan data. Requires the student application to be
able to reach the library computer.

**B — offline-safe event sync.** Every circulation change writes an
`integration_outbox` row **in the same transaction as the loan itself**. A sync
worker delivers pending events when a connection is available, retrying on
failure, using each event's stable `event_id` as an idempotency key so a
redelivery cannot double-count.

This is what makes offline-first survive integration: a checkout succeeds
locally and completely, and the fact that the outside world has not heard about
it yet is not the librarian's problem.

The likely long-term shape is both: roster in via A or a scheduled pull, loan
activity out via B.

## Connector abstraction

The real student system is never referenced throughout the library code —
only through interfaces (§31):

```
StudentDirectoryConnector   testConnection, fetchStudents, fetchClasses, getStudent
LibraryEventConnector       testConnection, sendEvent, sendBatch, pushSnapshot?
```

First implementations are `NoOpConnector` and `CsvStudentImporter`. A real
connector is written only once the target contract is known (§34).

## API rules

All integration endpoints are versioned under `/api/v1`. Every request is
validated; identifiers in payloads are `public_id`s, never internal row ids;
errors carry structured codes; SQL is never exposed; breaking changes get a new
version. Any access beyond loopback requires authentication (§9, §20).

## What must be collected before a real connector is written

Not blocking for Phases 0–8, but all of it is needed before Phase 9 (§32):

1. Application name
2. Web, desktop, or local database
3. Where it is hosted
4. Whether an API exists
5. Whether it can be written to, or only read
6. **The stable, immutable student identifier** — the single most important item
7. Whether a Library section can be added to the student profile
8. Plugin or extension support
9. Database technology
10. How integration authenticates
11. Whether library status must stay visible while the library computer is offline
12. How much history to show
13. Which fields to display: active count, titles, due dates, overdue, lost, full history
14. Which system is authoritative for class and status
15. Desired sync frequency
