# 📸 Photobooth

A self-service photobooth that runs on a laptop with a built-in or USB camera and a connected printer.

**Flow:** choose **3 Cuts / 4 Cuts / 4R** → (4R only: choose the frame first) → take **8 photos** → pick your favourites (3, 4, or however many the 4R frame needs) and a frame style with live preview → choose the **number of prints**, optionally enter an **email** for a digital copy → **Print**.

## Quick start

```bash
npm install
cp .env.example .env      # then edit it (printer + email)
npm start                 # opens on http://localhost:3000
```

Open **http://localhost:3000** in Chrome or Edge. Browsers only allow the camera on `localhost` or HTTPS, so open the page on the laptop itself.

To try it without a printer, run `npm run dev`. PDFs are saved to `output/` and nothing is sent to a printer.

### Kiosk mode (recommended at events)

Run the browser full screen so guests can't leave the app:

```bash
# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk http://localhost:3000
# macOS
open -a "Google Chrome" --args --kiosk http://localhost:3000
```

Press ⚙️ (top right) to set the event name printed on the frames, the printer, the countdown length, the maximum prints, and whether photos are mirrored.

## Printing

The server turns every print into a **4×6" (4R) PDF** and sends it to the laptop's printer with the chosen number of copies. No print dialog appears.

| Laptop | How it prints |
|---|---|
| Windows | `pdf-to-printer` (bundled SumatraPDF), silent, with copies |
| macOS / Linux | CUPS `lp -n <copies> -o media=w288h432` |

* 3 Cuts and 4 Cuts are 2×6" strips, so each 4R sheet holds **2 strips** side by side to be cut apart. This is the usual photobooth strip format.
* Load 4×6" paper and set it as the printer's default paper size. On macOS/Linux, if the printer rejects `w288h432`, set `PRINT_MEDIA` in `.env` to the name your printer uses (run `lpoptions -p <printer> -l` to list them).
* If the server can't print, the page offers the browser print dialog instead (one page per copy).

## Email (digital copy)

Fill in `SMTP_*` in `.env`. With Gmail, create an [App Password](https://myaccount.google.com/apppasswords) and use it as `SMTP_PASS`. The guest receives the framed photo plus their selected original shots.

Every finished print is also saved to `output/`.

## Adding your own templates

Frames are defined in `public/frames.js`:

* **`GEOMETRIES`** set where the photo windows go and how many photos a frame holds. 4R frames are listed in `LAYOUTS['4r'].geometries`.
* **`THEMES`** set the look: background, borders, decorations, caption colours.

To use artwork you designed in Canva or Photoshop:

1. Export a PNG at **600×1800** (strip) or **1200×1800** (4R). Leave the photo windows transparent and line them up with the slot positions in `GEOMETRIES`.
2. Save it in `public/frames/`.
3. Add a theme:

```js
{
  id: 'wedding',
  name: 'Our Wedding',
  swatch: '#f4e7d7',
  text: '#5a3e2b', accent: '#a07850',
  caption: false,                       // your artwork already has text
  background(ctx, W, H) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); },
  overlay: {
    strip3: 'frames/wedding-3cut.png',
    strip4: 'frames/wedding-4cut.png',
    '4r-quad': 'frames/wedding-4r-grid.png',
  },
},
```

Photos are cropped to fill each window, and the camera screen shows a dashed guide marking the part of the picture that will be used.
