# Admin routes

The `(admin)` group contains protected pages. `/login` and `/forbidden` are public information
pages, not authentication implementations. Admin role verification must complete server-side
before any operational data is fetched. Check the role inside every protected page, loader and
action too: Next layouts do not serialize nested renders or recheck every navigation.
