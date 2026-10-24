# Favourite-frame voting: setup

Pages (all in `public/`):

| Page | What it is |
|---|---|
| `vote.html` | The voting page for phones (via QR code). One vote per phone. |
| `vote.html?kiosk=1` | Booth tablet: no one-vote limit, resets 4 s after each vote. |
| `results.html` | Live results to project, refreshes every 5 s. |
| `results.html?hide=1` | Only "Votes so far: N", for the final reveal. |

Votes are anonymous: only the frame id and a server timestamp are stored. The "already voted" flag stays on the phone.

**Without a backend** (`API_URL` empty) votes are kept on that device only, and `results.html` on the **same device** shows them. That's fine for one kiosk tablet, but phones need the backend.

## 1. Deploy the Apps Script backend (about 5 minutes)

1. Go to https://sheets.new to create a new Google Sheet. Name it e.g. *Trilogy frame votes*.
2. In the Sheet: **Extensions → Apps Script**.
3. Delete everything in `Code.gs`, paste the contents of [`apps-script/Code.gs`](apps-script/Code.gs), and click **💾 Save**.
4. Click **Deploy → New deployment**. Click the ⚙️ next to *Select type* and choose **Web app**.
   * Description: `votes`
   * **Execute as: Me**
   * **Who has access: Anyone**
5. Click **Deploy**, then **Authorize access**, and pick your Google account. If you see *Google hasn't verified this app*, click **Advanced → Go to (project name) (unsafe)** → **Allow**. That's your own script.
6. Copy the **Web app URL** (it ends in `/exec`).
7. Check it: open the URL in a browser tab. You should see `{"3c-green":0,…,"total":0}`.

The "Votes" sheet tab is created on the first vote. To reset before the event, delete every row below the header.

If you change `Code.gs` later: **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL stays the same.

## 2. Paste the URL

On GitHub: open `public/vote.js` on the `voting-page` branch → ✏️ (Edit) → set the top line:

```js
const API_URL = 'https://script.google.com/macros/s/XXXX/exec';
```

→ **Commit changes**. `results.js` uses the same URL automatically (it has its own `API_URL` too, which you can leave empty).

Reload `vote.html`. The line at the bottom should say **"Votes are saved online."**

## 3. Turn on GitHub Pages

1. On GitHub: the repo → **Settings → Pages**.
2. **Source: Deploy from a branch**. **Branch: `voting-page`**, folder **`/ (root)`** → **Save**.
3. Wait 1–2 minutes (the **Actions** tab shows progress). The pages will be at:
   * https://venisechanjt.github.io/trilogy-photobooth/public/vote.html
   * https://venisechanjt.github.io/trilogy-photobooth/public/vote.html?kiosk=1
   * https://venisechanjt.github.io/trilogy-photobooth/public/results.html

The booth laptop also serves them while the booth is running: http://localhost:3000/vote.html and `/results.html`.

## 4. Make the QR code

Easiest, with nothing extra: in **desktop Chrome**, open the `vote.html` link above, click the **Share** icon at the right end of the address bar (or right-click the page) → **Create QR code** → **Download**. Print or show the PNG.

Scan it with your own phone and vote once to test, then clear that test vote from the Sheet.

## Editing the frames

The frame list is the `FRAMES` array at the top of `public/vote.js` (`id`, `name`, `cuts`, `thumb`). Previews are in `public/vote-thumbs/`. If you add or rename an id, add the same id to `FRAME_IDS` in `apps-script/Code.gs` and redeploy (new version). Otherwise the backend rejects the vote.
