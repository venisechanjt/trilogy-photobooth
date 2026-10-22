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

Press ⚙️ (top right) to set the event name printed on the frames, the printer, the maximum prints, and whether photos are mirrored.

On the camera screen, guests choose:
* **Shooting mode:** **Auto** takes all 8 photos in a row. **Manual** takes one photo each time the guest taps *Take photo* (the space bar or a presentation clicker also works).
* **Timer:** 3s or 5s before each photo, plus 0s in Manual mode.

## Printing

The server turns every print into a **4×6" (4R) PDF** and sends it to the laptop's printer with the chosen number of copies. No print dialog appears.

| Laptop | How it prints |
|---|---|
| Windows | `pdf-to-printer` (bundled SumatraPDF), silent, with copies |
| macOS / Linux | CUPS `lp -n <copies> -o media=w288h432` |

* 3 Cuts and 4 Cuts are 2×6" strips, so each 4R sheet holds **2 strips** side by side to be cut apart. This is the usual photobooth strip format.
* Load 4×6" paper and set it as the printer's default paper size. On macOS/Linux, if the printer rejects `w288h432`, set `PRINT_MEDIA` in `.env` to the name your printer uses (run `lpoptions -p <printer> -l` to list them).
* If the server can't print, the page offers the browser print dialog instead (one page per copy).

## Home page and booth wall

The booth opens on a home page with the welcome and **Start** button on the left and the **booth wall** hanging beside it on the right (stacked on phones): every finished photo whose guest kept *Pin my photos on the booth wall* ticked on the print screen. New photos pop onto the wall within about 15 seconds.

Wall photos are saved in `output/wall/`.

* **Clear the whole wall:** ⚙️ → *Clear booth wall*, then tap it again within 4 seconds to confirm. The photos aren't deleted: they're moved to `output/wall-archive/<date-time>/`. To put them back, move the files from that folder into `output/wall/`.
* **Remove one photo:** delete its two files in `output/wall/` (`<id>.jpg` and `<id>-thumb.jpg`).

## Email (digital copy)

Run this once in the project folder and follow the prompts:

```bash
npm run setup-email
```

It asks for the Gmail address the photos are sent from and a Gmail **App Password**, sends you a test email, and saves the settings to `.env`. Restart the booth afterwards. To get an App Password: turn on [2-Step Verification](https://myaccount.google.com/signinoptions/twosv), then create one at [App Passwords](https://myaccount.google.com/apppasswords).

To check email at any time, use ⚙️ → *Email* → **Send test**. Guests receive the framed photo plus their selected original shots.

Every finished print is also saved to `output/`.

## Adding your own frames

**Upload them from the booth:** ⚙️ → *Your frames* → **Upload frames**. You can pick several files at once.

* **Shape:** a tall 2×6" strip (for example 600×1800 or 696×2000) with **3 or 4** photo windows, or a portrait 4×6" / 4R (for example 1200×1800) with **1, 2, 3, 4, 6 or 8** windows.
* **Photo windows:** plain **white boxes** on a coloured frame (like the Trilogy template), or **see-through** areas in a PNG. In a see-through PNG, anything drawn over the windows (stickers, doodles) stays on top of the photos.
* **What the booth does:** it finds the windows, works out whether the frame is 3 cuts, 4 cuts or 4R, and lists it first among the frame styles for that layout. The first uploaded frame for a layout is preselected. Uploaded frames keep their own text, so the booth doesn't add the event name.
* **Removing a frame:** tap *Remove* next to it, then tap again to confirm.
* **Where they're kept:** `custom-frames/` in the project folder. Copy that folder to back them up or to move them to another laptop.

### Frames made in code

The built-in styles are in `public/frames.js`:

* **`GEOMETRIES`** set where the photo windows go and how many photos a frame holds. 4R frames are listed in `LAYOUTS['4r'].geometries`.
* **`THEMES`** set the look: background, borders, decorations and caption.

**3 Cuts and 4 Cuts follow the standard Trilogy strip template** (`STRIP_TEMPLATE` in `public/frames.js`, measured on the 696×2000 template artwork): photo windows 80px from the left and 542px wide, starting 84px from the top, 55px apart, with the last window ending 1608px down. Photos are cropped at the sides to fill the windows, and the camera screen shows a dashed guide of what will be kept.

4R photo windows take the shape of the camera's pictures, so 4R photos are never cropped.
