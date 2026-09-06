# TOMORROW — LUXX SETUP DAY
### Saturday 5 September 2026 · two people, one afternoon

You are setting LUXX up so it can run the week starting **Monday 8 September**.
Work through this in order. The app has the same list built in: tap **SETUP** and tick each box
as you finish it. The ticks are saved, so you can stop and come back.

**Roles:** one of you is the **Creator**, one is the **Executive Producer**. Both have identical
powers. The label only records who did what. Set it with the **ROLE** button, top right.

---

## Before you start
- Both phones charged, on wifi.
- The Netlify login for the **existing** LUXX site.
- The creator logged in to: X, Pornhub, OnlyFans Free, OnlyFans Paid, ManyVids, Fansly, Chaturbate.
- A laptop is easier than a phone for steps 10–13.

> **Do not create a new Netlify site.** All existing media and history are attached to the
> current one. A new site starts empty.

---

## 1 · Back up what you already have  *(2 min)*
RESULTS → **BACKUP JSON**. Save the file somewhere you will still find it next week.
Do this *before* anything else, every setup day, forever.

## 2 · Confirm the site  *(1 min)*
Open the LUXX URL you already use. If you are asked for a passcode, that is the value in
`LUXX_PASSCODE`. If the screen says configuration is missing, the environment variables were not
set — stop and fix that first.

## 3 · Confirm roles  *(1 min)*
Each phone: **ROLE** → pick Creator or Executive Producer.

## 4 · System health  *(1 min)*
SETUP → run **System Health**. Everything should be green before you load media.

## 5 · Set the timezone  *(1 min)*
SETUP → **Timezone** → `America/Chicago` → SAVE.
Until this is set, LUXX will not suggest a posting time from your own results. That is deliberate.

## 6 · Photograph the before-state  *(20 min)*
Before touching any profile, screenshot each platform's dashboard:
X · Pornhub · OnlyFans Free · OnlyFans Paid · ManyVids · Fansly · Chaturbate.
Name them plainly: `x-before.png`, `pornhub-before.png`, and so on.
**This is the only chance to capture the true starting point.**

## 7 · Enter the baseline  *(20 min)*
SETUP → **CAPTURE PLATFORM BASELINE**. One platform at a time. Type the exact numbers from the
screenshots. Put the screenshot filename in *Evidence reference*.
Leave a box blank if you cannot see the number. **Do not estimate.** A blank stays unknown; a
guess becomes a fake fact you will be comparing against for months.

## 8 · Read it back to each other  *(5 min)*
One person reads the numbers aloud, the other checks them against the screenshots. Fix errors now.

## 9 · LOCK BASELINE  *(1 min)*
SETUP → **LOCK BASELINE**. After this the numbers cannot be edited, only corrected with a
written reason. LUXX will not prescribe anything until this is done.

## 10 · Set up tracking routes  *(45 min — the important hour)*
LIBRARY → **ROUTES**. Do these, in this order:

| Route | Create the link on | Paste it into |
|---|---|---|
| `X_BIO_TO_OF_FREE_01` | OnlyFans Free | X bio |
| `X_PINNED_TO_OF_FREE_01` | OnlyFans Free | X pinned post |
| `X_POST_TO_OF_FREE_01` | OnlyFans Free | a normal X post |
| `PH_PROFILE_TO_OF_FREE_01` | OnlyFans Free | Pornhub profile |
| `PH_VIDEO_DESC_TO_OF_FREE_01` | OnlyFans Free | Pornhub video description |
| `OF_FREE_BIO_TO_OF_PAID_01` | OnlyFans **Paid** | OF Free bio |
| `OF_FREE_PINNED_TO_OF_PAID_01` | OnlyFans **Paid** | OF Free pinned post |
| `OF_FREE_POST_TO_OF_PAID_01` | OnlyFans **Paid** | OF Free normal post |
| `OF_FREE_MESSAGE_TO_OF_PAID_01` | OnlyFans **Paid** | OF Free DM |

`OF_PAID_FEED_01`, `OF_PAID_PPV_MESSAGE_01` and `CB_NATIVE_TIPS_01` are measured inside the
platform. Nothing to paste.

**Every placement gets its own link.** Bio, pinned and post are three different routes. If you
reuse one link across all three you will never know which one earned.

## 11 · Verify each route  *(20 min)*
For each one: tap your own link on a phone that is **not** logged in as the creator, confirm it
lands on the right page, then mark it verified in LUXX with a note of what you saw.
A route stays INACTIVE until it has been tested. LUXX will not use an untested route.

## 12 · Load the Pornhub history  *(20 min)*
LIBRARY → **HISTORY** → **IMPORT HISTORICAL PUBLICATIONS**.
Paste all 9 existing videos. JSON example:

```json
[{"platform":"Pornhub","title":"Lake House Afternoon",
  "url":"https://www.pornhub.com/view_video.php?viewkey=ph000000001",
  "published_at":"2025-11-14","runtime_seconds":451,"views":2140,"likes":88,
  "current_description":"Full scene.","current_cta_link":"https://onlyfans.com/creator001free",
  "usage_status":"HISTORICAL","notes":"batch BATCH-LAKE"}]
```

CSV works too — first row is the header, same column names.

## 13 · Load the ManyVids history  *(15 min)*
Same screen. Include price, sales and revenue where you can see them:

```json
[{"platform":"ManyVids","title":"Booksmart Tease Set",
  "url":"https://www.manyvids.com/Video/000000/booksmart-tease",
  "published_at":"2026-02-02","runtime_seconds":612,
  "sales":7,"revenue":104.93,"current_price":14.99,"usage_status":"HISTORICAL"}]
```

**Nothing is deleted.** These stay as historical truth. Later you can mark each one
KEEP / RE-EDIT / REPLACE / RETIRE — that records a decision, it does not erase the record.

## 14–16 · Confirm the rest  *(10 min)*
- OF Free → Paid placements are actually live on the profile.
- OF Paid native feed and PPV measurement look right.
- Fansly: only set it up **if you are actually going to use it this week.** Skipping it is fine.

## 17 · Chaturbate  *(10 min)*
Confirm the login works, the camera and mic work, and both of you know the pilot windows:
**Friday and Saturday, 8–11 PM Central.**
That window is a starting guess, not an optimum. Do not add more shifts in week one.

## 18 · Upload Launch Core  *(30 min)*
LIBRARY → **UPLOAD**. Start with **40–60 files you would be happy to post in the next two weeks.**
In the batch Notes field type: `LAUNCH CORE`.
Upload these *first and alone*. Monday must not depend on the full archive being processed.

## 19 · Safety review  *(20 min)*
Go through the Launch Core:
- **Authorization** — only mark AUTHORIZED what she has confirmed she is happy to publish.
- **Quarantine** — anything with an identity or privacy problem.
- **X face-safe** — X stays blocked for any photo until someone confirms no face is visible.
- Wait for **Privacy Shield** to finish. LUXX will not prescribe a file without a safe derivative.

## 20 · Upload the archive  *(as long as it takes)*
Now the rest — hundreds of files, in batches of 50–100. Notes field: `ARCHIVE`.
Videos process in the background and resume if one fails. You can close the app.
**Monday does not depend on this finishing.**

## 21 · Clean duplicates  *(5 min)*
LIBRARY → **CLEAN EXACT DUPLICATES**. Only byte-identical files, and only ones with no history.

## 22 · Dry run  *(15 min)*
Open **TODAY**. You should see 2–4 job cards, not a wall of photos.
Take one line all the way through: **USE THIS → APPROVE → MARK POSTED → ENTER RESULT.**
On MARK POSTED, fill in what you *actually* did — preview style, audience, price, and how many
fans it went to. Then reload the app on the other phone and confirm it is still there.

Expect almost everything to say **GUESS**. That is correct on day one. GUESS means LUXX is going
on rotation and eligibility, not on evidence. It becomes CALL only after six comparable results.

## 23 · Back up again  *(2 min)*
RESULTS → **BACKUP JSON**. Save it as `luxx-after-setup-2026-09-05.json`.

---

## Monday morning
Open **TODAY**. Do the 2–4 jobs it lists. Mark each one posted, with the real numbers.
Come back when the measurement is due and enter the result.

### The week, as LUXX will offer it
| Day | Jobs |
|---|---|
| Mon | MONETIZE: OF Paid wall · ACQUIRE: one X teaser |
| Tue | MONETIZE: OF wall / re-engagement · ACQUIRE: one X teaser |
| Wed | MONETIZE: one PPV DM · ACQUIRE: one Pornhub teaser |
| Thu | MONETIZE: OF wall / BTS · ACQUIRE: one discovery action |
| Fri | LIVE: cam 8–11 PM CT · MONETIZE: light paid-page activity |
| Sat | LIVE: cam 8–11 PM CT · MONETIZE: one PPV DM |
| Sun | MONETIZE: PPV / bundle · ACQUIRE: light X |

This schedule is a **starting default**, not an optimum. It changes only when results earn it.

---

## Three things to remember
1. **LUXX never posts, messages or generates anything.** It tells you which file you already
   shot, where it goes, and how sure it is. You do the posting.
2. **GUESS is not a failure.** It is the app refusing to pretend. Every result you record with a
   real send count moves it closer to a CALL.
3. **If something looks wrong, it probably is.** Do not follow a line you disagree with — decline
   it and say why. LUXX reads those reasons and will tell you when you keep overriding it.

## If something breaks tomorrow
- **Won't load:** hard-refresh. If the login says configuration is missing, the env vars are unset.
- **Upload stuck:** it is safe to close and reopen. Videos resume; nothing is lost.
- **TODAY says HOLD:** it will tell you exactly what is missing — usually the baseline is not
  locked, or no route is verified yet.
- **Worst case:** you have the backup from step 1, and the written week above. You can run Monday
  from this page alone.
