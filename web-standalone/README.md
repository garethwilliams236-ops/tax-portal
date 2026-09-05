# Tax Portal — standalone browser build

A single self-contained HTML file. No server, no build step, no dependencies.
Data is stored in the browser's `localStorage` on the machine you open it on.

## Open it locally

Double-click `index.html`, or:

```bash
# macOS / WSL
xdg-open index.html   ||  explorer.exe index.html
```

It works from `file://` — nothing is fetched over the network.

## Serve it on your own machine

```bash
npx serve .          # http://localhost:3000
# or
python3 -m http.server 8080
```

## Deploy it to a URL you control

```bash
npx vercel deploy --prod
```

Vercel serves it as a static site. Add password protection in the project's
settings (Deployment Protection) — the portal has no authentication of its own,
so anyone with the URL can read the data stored in *their* browser, but not
yours: `localStorage` is per-browser, per-device, and never leaves the machine.

## Where the data lives, and its limits

- **Per browser, per device.** Opening the portal on your laptop and your iPad
  gives you two independent copies. Nothing syncs between them.
- **Cleared if you clear site data** for the origin.
- **Not backed up.** Use Export before anything you cannot repeat.

This is deliberate for a single-user tool: no account, no server, no data
leaving your machine. When you want it on more than one device, that is the
point at which the Supabase build in the parent directory earns its keep — the
schema and RLS are already written for it.
