# Products list request ownership

The previous unfiltered request could finish after a newer search and replace
its results. The committed filter/marketplace change now invalidates ownership
in a layout-effect cleanup, before the new debounce starts. Every result, error
and loading update checks the same monotonically increasing request ID.

Manual refresh uses the latest committed scope, including after an asynchronous
drawer save. Unmount invalidates ownership and aborts the fetch. AbortController
reduces wasted work; ownership remains necessary when an aborted transport/cache
still resolves. No periodic refresh was introduced. Filtering, pagination,
marketplace parameters, pricing and mapping APIs retain their semantics.

Validation:10 deterministic race tests, including the old1521/new51 response
ordering and the debounce gap; full frontend94/94; ESLint and production build
passed. The focused15 includes5 existing Products tests and overlaps the94.
No migration or backend behavior change. No live requests are made by these tests.
