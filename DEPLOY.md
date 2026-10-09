# Firebase deployment

Production site: https://pet-race-wlchoi.web.app/

- Firebase project: `mulan-journey` (Teaching games).
- Login: Google; allowlist: existing Firestore `authorizedUsers/<lowercase verified email>` document existence.
- Allowlist records and Firestore security rules are managed in the existing Teaching games project. This repository never writes them.
- `node --test tests/auth.test.cjs` checks fail-closed login and revocation behavior.
- `node build.mjs` copies only runtime assets to `dist/`.
- `firebase deploy --project mulan-journey --only hosting:pet-race-wlchoi` deploys this site only.
- The deployment configuration has a single explicit Hosting site; it does not deploy Firestore rules or other games.
- GitHub Pages redirects to Firebase. Do not restore a separate unauthenticated HTML entry point.

## Scope of access control

The entry page starts the game only after a fresh server-side allowlist read succeeds. Logout and observed authorization revocation hide and pause the game. This follows the existing teaching-game entry gate. Firebase Hosting assets and this public source repository remain publicly downloadable; this is not server-side confidentiality for the game code or models. Protecting those files themselves would require a private distribution design.

## Deployment runner

The `pet-race-deploy` branch of `wlchoi-yyc/mulan-journey` contains a dedicated workflow using the existing Firebase deployment credential. It checks out an exact Pet_race commit and deploys only `pet-race-wlchoi`. To publish a later version, update that pinned commit in the dedicated workflow. Merely pushing Pet_race does not deploy Firebase automatically.
