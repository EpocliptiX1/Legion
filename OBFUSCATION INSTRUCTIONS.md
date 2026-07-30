# Obfuscation Instructions

Run this **once when you're done developing and ready to release/redeploy.**

---

## Step 1 — Restore clean source files

Always start from the originals, not whatever is currently live:

```powershell
Copy-Item -Path "C:\Users\Damir\Desktop\myhflixer\CURRENT BACKUP\_source_backup\css\*"  -Destination "C:\Users\Damir\Desktop\myhflixer\CURRENT BACKUP\css\"  -Force
Copy-Item -Path "C:\Users\Damir\Desktop\myhflixer\CURRENT BACKUP\_source_backup\html\*" -Destination "C:\Users\Damir\Desktop\myhflixer\CURRENT BACKUP\html\" -Force
Copy-Item -Path "C:\Users\Damir\Desktop\myhflixer\CURRENT BACKUP\_source_backup\js\*"   -Destination "C:\Users\Damir\Desktop\myhflixer\CURRENT BACKUP\js\"   -Force
```

## Step 2 — Run the obfuscator

```powershell
cd "C:\Users\Damir\Desktop\myhflixer\CURRENT BACKUP"
node scripts/obfuscate-deploy.js
```

This will:
- Scramble all 23 JS files in `js/` into unreadable `_0x1a2b` style code
- Leave CSS and HTML untouched (so the site doesn't break)
- Each run produces **different** random identifiers — new fingerprint every time

## Step 3 — Restart your servers

```powershell
# Terminal 1
cd "C:\Users\Damir\Desktop\myhflixer\CURRENT BACKUP\Backend"
node server.js

# Terminal 2
cd "C:\Users\Damir\Desktop\myhflixer\CURRENT BACKUP\Backend"
node middleware.js
```

---

## To go back to readable code (for development)

```powershell
Copy-Item -Path "C:\Users\Damir\Desktop\myhflixer\CURRENT BACKUP\_source_backup\css\*"  -Destination "C:\Users\Damir\Desktop\myhflixer\CURRENT BACKUP\css\"  -Force
Copy-Item -Path "C:\Users\Damir\Desktop\myhflixer\CURRENT BACKUP\_source_backup\html\*" -Destination "C:\Users\Damir\Desktop\myhflixer\CURRENT BACKUP\html\" -Force
Copy-Item -Path "C:\Users\Damir\Desktop\myhflixer\CURRENT BACKUP\_source_backup\js\*"   -Destination "C:\Users\Damir\Desktop\myhflixer\CURRENT BACKUP\js\"   -Force
```

> **Important:** Obfuscation is one-way. There is no "undo" tool.  
> `_source_backup/` is your only way back — never delete it.

---

## Notes

- **Never edit JS files after obfuscating** — edit the originals in `_source_backup/js/` instead, then re-run the obfuscator
- The `_source_backup/` folder also stores `_obfuscation-map.json` from the last run (for debugging only)
- The `javascript-obfuscator` package is installed in the root `node_modules/` — no extra install needed
