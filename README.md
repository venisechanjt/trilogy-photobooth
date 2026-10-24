# 📸 Photobooth

A self-service photobooth that runs on a laptop with a built-in or USB camera and a connected printer.

**Flow:** choose **3 Cuts / 4 Cuts / 4R** → (4R only: choose the frame first) → take **8 photos** → pick your favourites (3, 4, or however many the 4R frame needs) and one of your frames, with a live preview → choose the **number of prints**, optionally enter an **email** for a digital copy → **Print**.

## Quick start

```bash
npm install
cp .env.example .env      # then edit it (printer + email)
npm start                 # opens on http://localhost:3000
```

Open **http://localhost:3000** in Chrome or Edge. Browsers only allow the camera on `localhost` or HTTPS, so open the page on the laptop itself.

To try it without a printer, run `npm run dev`. PDFs are saved to `output/` and nothing is sent to a printer.

### On a Mac

1. Install **Node.js** (LTS) from https://nodejs.org.
2. Open **Terminal** and get the project (the first `git` command may offer to install Apple's developer tools; click *Install* and run it again afterwards):
   ```bash
   cd ~/Desktop
   git clone https://github.com/venisechanjt/trilogy-photobooth
   cd trilogy-photobooth
   npm install
   npm run set-pin
   npm run setup-email
   ```
3. Add the printer in **System Settings → Printers & Scanners**, then run `npm run printer-sizes` so the booth uses the printer's 4×6 paper.
4. Double-click **`start-booth.command`** (in the project folder in Finder) to start the booth full screen. Allow the camera when asked. If macOS says it can't be opened, right-click it → **Open**. If the camera stays black, allow Chrome in **System Settings → Privacy & Security → Camera**.
5. To finish: **Cmd + Q** in the booth window, then **Ctrl + C** in the Terminal window.

To update later: `cd ~/Desktop/trilogy-photobooth && git pull`.

### Kiosk mode (recommended at events)

Run the browser full screen so guests can't leave the app:

```bash
# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk http://localhost:3000
# macOS
open -a "Google Chrome" --args --kiosk http://localhost:3000
```

Press ⚙️ (top right) to set the event name (used in emails and the top bar), the printer, the maximum prints, and whether photos are mirrored.

**Lock the settings with a PIN:** run `npm run set-pin`, type the PIN (4–8 digits) and restart the booth. ⚙️ then asks for the PIN, and locks again whenever the settings close. After 5 wrong tries it waits a minute. The PIN is stored only in `.env` on the laptop. Run `npm run set-pin` again to change it, or leave it empty to remove it.

On the camera screen, guests choose:
* **Shooting mode:** **Auto** takes all 8 photos in a row. **Manual** takes one photo each time the guest taps *Take photo* (the space bar or a presentation clicker also works).
* **Timer:** 3s or 5s before each photo, plus 0s in Manual mode.

## Printing

The server saves every print as a **4×6" (4R) JPG** (1200×1800, 300 dpi) and sends it straight to the laptop's printer with the chosen number of copies. No print dialog appears.

| Laptop | How it prints |
|---|---|
| Windows | `pdf-to-printer` (bundled SumatraPDF), silent, with copies |
| macOS / Linux | CUPS `lp -n <copies> -o media=w288h432` |

* **Only `npm start` (or `start-booth.bat`) prints.** `npm run dev` is test mode: it saves the JPGs to `output/prints/` without printing, and shows a red "Test mode" note on the print screen.
* 3 Cuts and 4 Cuts are 2×6" strips, so each 4R sheet holds **2 strips** side by side, to be cut apart.
* If the printer doesn't respond within a minute (switched off, out of paper, stuck), the booth shows a message instead of freezing, and offers the browser print dialog as a fallback.

### Printing not working? Run the print check

```bash
npm run print-check
```

It checks the print mode, lists the printers with their status (offline, paused…), sends a 4×6 test page to the printer you pick, and looks at the print queue 10 seconds later. It ends with a list of what to fix. Copy the whole output if you need help.

### Set up the printer (Windows)

1. Connect the printer and install its driver. Print a Windows test page from *Settings → Bluetooth & devices → Printers & scanners* to confirm it works.
2. In the same place, open the printer → **Printing preferences** and set:
   * **Paper size: 4×6 in / 10×15 cm** (sometimes called *Postcard* or *4R*). This matters most: if it's left on A4 or Letter, the photo prints small in the middle of a big page.
   * **Borderless: on**, if your printer supports it.
   * **Quality: photo / high**, and the paper type that matches your photo paper.
3. Start the booth with `npm start`, open ⚙️ → PIN → pick the printer under **Printer**, then tap **🖨️ Print test page**. On the page, the green border should be about 3 mm from every edge. Then **Save**.
4. Do one full guest session and print it.

Avoid choosing *Microsoft Print to PDF* or *OneNote*: they open a save window instead of printing.

**Prefer to choose settings for each print?** ⚙️ → *Printer* → tick **Show the print settings window when printing**. Tapping Print then opens the print window, where you can pick the printer and paper size (choose 4×6 / 10×15 cm, and keep copies at 1: the booth already adds one page per print). Untick it to go back to printing straight away.

## Where photos are kept

| Folder | What's in it |
|---|---|
| `output/photostrips/` | The final photostrip of **every** session as a ready-to-print 4×6" (4R) image: strips appear twice side by side (`photostrip-<date>-<time>.jpg`) |
| `output/wall/` | Photostrips of guests who kept *Pin my photostrip on the booth wall* ticked |
| `output/wall-archive/` | Wall photos moved there by *Clear booth wall* |
| `output/prints/` | The 4×6 JPGs sent to the printer (`print-<date>-<time>.jpg`), and test pages (PDF) |

**Individual photos are never saved.** They only exist in the browser during the session, and are cleared when the guest finishes, leaves via the logo, or after 3 minutes without a touch. The print screen and thank-you screen tell guests this.

If the email template attaches the individual photos, copies of every guest email (with attachments) also stay in the sending Gmail account's **Sent** folder. Delete them after the event if you don't want to keep them.

## Going live (event day)

1. Plug in the printer and camera, load 4×6" paper, and connect to Wi-Fi (or a phone hotspot) for email.
2. Double-click **`start-booth.bat`** (Windows) or **`start-booth.command`** (Mac) in the project folder. It starts the booth in print mode and opens it full screen. The first time, allow the camera when asked.
3. Do one test session yourself (print + email) before guests arrive.
4. To finish: press **Alt + F4** to close the full-screen booth, then close the "trilogy photobooth server" window.

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

**Email template:** ⚙️ → *Email template*. Edit the subject and message; `{event}` becomes the event name and `{date}` today's date. Every guest email attaches the photostrip (`<event>-photostrip.jpg`). Tick *Also attach all 8 photos the guest took* to send every shot too. The template is saved in `email-template.json` on the laptop.

To check email at any time, use ⚙️ → *Email* → **Send test**. It sends exactly what guests receive, with a sample photostrip attached and "[Test]" in the subject.

Every finished print is also saved to `output/`.

## Adding your own frames

The booth has **no built-in frames**: it uses only your frame artwork. A layout (3 Cuts, 4 Cuts, 4R) appears on the booth once there's at least one frame for it.

### Permanent frames (recommended): the `public/frames` folder on GitHub

1. On GitHub, open the repo → `public` → `frames`.
2. **Add file → Upload files**, drag your frame images in, and click **Commit changes**.
3. On the booth laptop, run `git pull` and restart the booth.

Every image in that folder is loaded automatically. The file name becomes the frame name: numbers or a layout code at the start (`3C-`, `4C-`, `4R-`, `01-`) only set the order, so `3C-02-green.png` shows as "green". To remove a permanent frame, delete it from that folder on GitHub and `git pull`.

### Quick additions on one laptop: upload in ⚙️

⚙️ → *Your frames* → **Upload frames**. These are saved in `custom-frames/` on that laptop only, and can be removed there. Permanent frames are marked *Permanent* in the list.

### What frame images need

* **Shape:** a tall 2×6" strip (for example 600×1800 or 696×2000) with **3 or 4** photo windows, or a portrait 4×6" / 4R (for example 1200×1800) with **1 to 8** windows.
* **Photo windows:** any shape (rectangles, hearts…) in **one plain light colour** that differs from the frame around it (e.g. light grey windows on a white frame, or white windows on a coloured frame), or **see-through** areas in a PNG.
* **The frame is always the top layer:** photos go underneath and show through the windows, so stickers, doodles or edges that overlap a window stay on top of the photo.
* The booth finds the windows, works out the layout, and crops photos to fill each window. The camera screen shows a dashed guide of what will fit.
* If an image can't be used (wrong shape, wrong number of windows), ⚙️ → *Your frames* shows a ⚠ note saying why.

