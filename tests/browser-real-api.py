"""LUXX v1.7.0 RC2 — real-API browser test.

Everything here runs against the REAL Netlify functions through tests/local-server.mjs:
real storage, real domain, real media pipeline. Nothing is mocked.

What changed from RC1
---------------------
1. RC1 pointed ROOT at an absolute machine path (/mnt/data/LUXX_FINAL_INTEGRATED_V1_3)
   that does not exist in this package. ROOT is now derived from this file.
2. RC1 injected a fetch-proxy shim and used page.set_content(). The page is now served
   straight off the local server, so the browser talks to the API the way it does in
   production and localStorage has a real origin.
3. RC1 drove '#prescribeBtn', 'UPLOAD + SAVE', 'BRAND SHOOTS', '.media' and
   'EDIT / VERIFY' — none of which exist in the current UI. All selectors are current,
   and TODAY is driven job-first: USE THIS -> APPROVE -> MARK POSTED.
4. RC1 hard-coded /usr/bin/chromium. The browser comes from Playwright, overridable
   with LUXX_CHROMIUM_PATH.

Run:  python tests/browser-real-api.py
"""
import json, os, pathlib, socket, subprocess, sys, tempfile, time
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
FFMPEG = os.environ.get('LUXX_FFMPEG_PATH', '/usr/bin/ffmpeg')

report = {'pass': False, 'steps': [], 'page_errors': [], 'console_errors': [], 'dialogs': []}
def step(x):
    report['steps'].append(x)
    print('  step:', x)

def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p

tmp = pathlib.Path(tempfile.mkdtemp(prefix='luxx-real-api-'))
port = free_port()
env = os.environ.copy()
env['LUXX_LOCAL_STORAGE_DIR'] = str(tmp / 'store')
env['LUXX_LOCAL_AUTH_BYPASS'] = '1'
env['LUXX_TEST_PORT'] = str(port)
env['LUXX_PASSCODE'] = 'LUXX-TEST-PASSCODE'
env['LUXX_SESSION_SECRET'] = 'test-session-secret-not-for-production-use-0123456789'
env['LUXX_FFMPEG_PATH'] = FFMPEG
env['LUXX_FFPROBE_PATH'] = os.environ.get('LUXX_FFPROBE_PATH', '/usr/bin/ffprobe')

server = subprocess.Popen(['node', 'tests/local-server.mjs'], cwd=str(ROOT), env=env,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
line = server.stdout.readline().strip()
if not line:
    raise RuntimeError('Local server failed to start: ' + server.stderr.read())
json.loads(line)
BASE = 'http://127.0.0.1:%d' % port

img = tmp / 'browser-real.png'
subprocess.run([FFMPEG, '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=240x320', '-frames:v', '1', str(img)],
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
vid = tmp / 'browser-real.mp4'
subprocess.run([FFMPEG, '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=5', '-t', '8',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', str(vid)],
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)


def launch(p):
    kwargs = {'headless': True, 'args': ['--no-sandbox']}
    exe = os.environ.get('LUXX_CHROMIUM_PATH')
    if exe:
        kwargs['executable_path'] = exe
    return p.chromium.launch(**kwargs)

def close_modal(page):
    if page.locator('#modal .modalBack').count():
        page.evaluate("()=>{const m=document.getElementById('modal');if(m)m.innerHTML=''}")
        page.wait_for_timeout(80)

def fill_stable(page, selector, value, tries=6):
    """Fill a field and confirm it survived.

    Some SETUP actions close and rebuild the modal asynchronously, so a value typed
    just before that rebuild lands in a detached element. Filling is retried until the
    live element actually holds the value.
    """
    for _ in range(tries):
        close_note = page.locator(selector)
        try:
            close_note.fill(value, timeout=4000)
            page.wait_for_timeout(250)
            if page.locator(selector).input_value() == value:
                return
        except Exception:
            page.wait_for_timeout(250)
    raise AssertionError('field %s never held %r' % (selector, value))

def retry_click(page, make_locator, tries=6):
    """Click a control INSIDE the open modal.

    safe_click() clears the modal first, which would also clear the fields the operator
    just filled, so in-modal controls retry without tearing the modal down.
    """
    last = None
    for _ in range(tries):
        try:
            make_locator().click(timeout=4000)
            return
        except Exception as e:
            last = e
            page.wait_for_timeout(300)
    raise AssertionError('could not click an in-modal control: %r' % last)

def safe_click(page, make_locator, tries=8):
    """Click something that a late-resolving load() may cover with a reopened modal.

    Several SETUP actions close the modal, await load(), then reopen it. That reopen can
    land between our close_modal() and our click, so the click is retried rather than
    waiting 30s on an intercepted element.
    """
    last = None
    for _ in range(tries):
        close_modal(page)
        try:
            make_locator().click(timeout=4000)
            return
        except Exception as e:
            last = e
            page.wait_for_timeout(400)
    raise AssertionError('could not click through a reopened modal: %r' % last)

def open_setup(page):
    safe_click(page, lambda: page.locator('#setupBtn'))
    page.locator('#modal .modalBack').wait_for()

def open_view(page, name):
    safe_click(page, lambda: page.locator('button[data-view="%s"]' % name))
    page.wait_for_timeout(400)

def lib_tab(page, name):
    safe_click(page, lambda: page.get_by_role('button', name=name, exact=True).first)
    page.wait_for_timeout(400)

def preview_day(page, label):
    close_modal(page)
    code = {'Mon': 'MON', 'Tue': 'TUE', 'Wed': 'WED', 'Thu': 'THU', 'Fri': 'FRI', 'Sat': 'SAT', 'Sun': 'SUN'}[label]
    shown = "c=>[...document.querySelectorAll('.eyebrow')].some(e=>e.textContent.includes(\"TODAY'S PLAN · \"+c))"
    for _ in range(12):
        safe_click(page, lambda: page.get_by_role('button', name=label, exact=True))
        try:
            page.wait_for_function(shown, arg=code, timeout=5000)
        except Exception:
            continue
        # A load() still in flight from an earlier action re-renders TODAY with the
        # CURRENT day and would silently replace the preview under us. Settle, re-check,
        # and click again if something overwrote it.
        page.wait_for_timeout(900)
        if page.evaluate(shown, code):
            return
    raise AssertionError('TODAY never settled on the %s plan' % code)

def wait_btn_rx(page, btn_id, rx_id, why):
    """The TODAY buttons carry the prescription id in their onclick. After a revision the
    DOM must catch up before we click, or the click targets the superseded prescription."""
    page.wait_for_function(
        "a=>{const b=document.getElementById(a.id);return !!b&&(b.getAttribute('onclick')||'').includes(a.rx)}",
        arg={'id': btn_id, 'rx': rx_id}, timeout=20000)

def server_state(page):
    return page.evaluate("fetch('/api/state').then(r=>r.json()).then(j=>j.state)")

def server_assets(page):
    return page.evaluate("fetch('/api/assets?limit=200&cursor=0').then(r=>r.json()).then(j=>j.assets)")

def wait_for(page, pred, why, tries=160):
    """Poll through Playwright so the page keeps running while we wait."""
    last = None
    for _ in range(tries):
        try:
            v = pred()
            if v:
                return v
            last = v
        except Exception as e:
            last = e
        page.wait_for_timeout(250)
    raise AssertionError('timed out waiting for %s (last=%r)' % (why, last))

BASELINE_IMPORT_FILE = json.dumps({
    'schema': 'LUXX_BASELINE_IMPORT_V1',
    'rows': [
        {'platform': 'X', 'metric': 'followers', 'value': 36, 'evidence_reference': 'x.png'},
        {'platform': 'Pornhub', 'metric': 'full_videos', 'value': 9, 'evidence_reference': 'ph.png'},
        {'platform': 'OnlyFans Paid', 'metric': 'revenue_last_30_days', 'value': 'NOT_AVAILABLE',
         'evidence_reference': 'ofp.png', 'notes': 'dashboard does not expose it'},
    ]})

try:
    with sync_playwright() as p:
        browser = launch(p)
        page = browser.new_page(accept_downloads=True)
        page.on('pageerror', lambda e: report['page_errors'].append(str(e)))
        page.on('console', lambda m: report['console_errors'].append(m.text) if m.type == 'error' else None)
        page.on('dialog', lambda d: (report['dialogs'].append(d.message), d.accept()))

        page.goto(BASE + '/', wait_until='networkidle')
        page.locator('#shell').wait_for(state='visible'); step('real API boot, served by the real functions')
        page.evaluate("()=>{for(let i=1;i<5000;i++)clearInterval(i)}")
        assert page.locator('.nav button').count() == 3; step('three primary views, no fourth tab')

        # --- IMPORT -> REVIEW -> CAPTURE -> LOCK, against real storage ----------
        open_setup(page)
        page.locator('#blImpText').fill(BASELINE_IMPORT_FILE)
        retry_click(page, lambda: page.locator('#importBaselineBtn'))
        wait_for(page, lambda: any(s.get('source') == 'IMPORT' for s in server_state(page)['baseline']['snapshots']),
                 'the imported baseline to persist')
        st = server_state(page)
        ofp = next(s for s in st['baseline']['snapshots'] if s['platform'] == 'OnlyFans Paid')
        assert 'revenue_last_30_days' not in ofp['metrics'], 'NOT AVAILABLE must not become a number'
        assert 'revenue_last_30_days' in ofp['not_available']
        assert st['baseline']['captured'] is False and st['baseline']['locked'] is False
        step('real baseline import persists, keeps NOT AVAILABLE, and does not lock')

        open_setup(page)
        fill_stable(page, '#be', 'browser real evidence')
        fill_stable(page, '#bi', 'browser real inventory')
        retry_click(page, lambda: page.locator('#captureBaselineBtn'))
        page.wait_for_function("!document.querySelector('#lockBaselineBtn')?.disabled")
        retry_click(page, lambda: page.locator('#lockBaselineBtn'))
        wait_for(page, lambda: server_state(page)['baseline']['locked'] is True, 'the real baseline to lock')
        step('real baseline capture + lock')

        open_setup(page)
        assert page.locator('#importBaselineBtn').is_disabled(), 'a locked baseline must refuse a re-import'
        step('locked baseline cannot be overwritten')

        # --- cam availability, stored through the real settings/state path ------
        page.locator('[data-camday="TUE"]').check()
        page.locator('[data-camday="FRI"]').check()
        page.locator('#camStart').fill('09:00')
        page.locator('#camEnd').fill('13:00')
        retry_click(page, lambda: page.locator('#saveCamAvailBtn'))
        cfg = wait_for(page, lambda: server_state(page)['settings']['camAvailability'].get('configured') and
                       server_state(page)['settings']['camAvailability'], 'cam availability to persist')
        assert cfg['days'] == ['TUE', 'FRI'] and cfg['earliest_start'] == '09:00' and cfg['latest_end'] == '13:00'
        step('cam availability persists through the real API')

        # --- upload a real image and render real derivatives --------------------
        open_view(page, 'library')
        close_modal(page)
        safe_click(page, lambda: page.locator('#uploadBtn'))
        page.locator('#files').set_input_files(str(img))
        page.locator('#upAuth').select_option(label='AUTHORIZED')
        page.get_by_role('button', name='UPLOAD + ANALYZE + SAVE').click()
        page.locator('#modal').wait_for(state='hidden', timeout=60000)
        ia = wait_for(page, lambda: next((a for a in server_assets(page) if a.get('media_type') == 'IMAGE'), None),
                      'the image to persist')
        step('real image upload persisted')

        safe_click(page, lambda: page.locator('.mediaCard').filter(has_text=ia['name']).first.get_by_role('button', name='EDIT', exact=True))
        page.locator('#autoBestBtn').click()
        wait_for(page, lambda: len(next(a for a in server_assets(page) if a['asset_id'] == ia['asset_id']).get('variants', [])) >= 1,
                 'the AUTO BEST derivative')
        step('real image AUTO BEST derivative')

        close_modal(page)
        safe_click(page, lambda: page.locator('.mediaCard').filter(has_text=ia['name']).first.get_by_role('button', name='DETAILS'))
        page.get_by_role('button', name='EDIT AGAIN').first.click()
        page.get_by_role('button', name='SAVE MANUAL EDIT').click()
        wait_for(page, lambda: len(next(a for a in server_assets(page) if a['asset_id'] == ia['asset_id']).get('variants', [])) >= 2,
                 'the second-generation derivative')
        step('real second-generation image derivative')

        # --- routes: each placement verified on its own -------------------------
        close_modal(page)
        lib_tab(page, 'ROUTES')
        safe_click(page, lambda: page.locator('.row').filter(has_text='X_POST_TO_OF_FREE_01').first.get_by_role('button', name='SET UP / VERIFY'))
        page.locator('#ru').fill('https://track.example/x-post')
        page.locator('#rt').select_option(value='OPENED_UNIQUE_TRACKING_LINK_AND_CONFIRMED_DESTINATION')
        page.locator('#re').select_option(value='UNIQUE_TRACKING_IDENTIFIER_PRESERVED')
        page.locator('#rd').check()
        page.get_by_role('button', name='TEST & ACTIVATE ROUTE').click()
        wait_for(page, lambda: next(r for r in server_state(page)['routes'] if r['route_id'] == 'X_POST_TO_OF_FREE_01')['verification_status'] == 'VERIFIED',
                 'the X post route to verify')
        assert next(r for r in server_state(page)['routes'] if r['route_id'] == 'X_BIO_TO_OF_FREE_01')['verification_status'] == 'UNVERIFIED', \
            'verifying one placement must never activate another'
        step('real route verification stays placement-specific')

        # --- TODAY: job-first prescribe / change / decline / approve / execute ---
        open_view(page, 'today')
        preview_day(page, 'Mon')
        assert page.locator('.jobCard').count() > 0, 'TODAY must render job cards'
        safe_click(page, lambda: page.get_by_role('button', name='USE THIS', exact=True).first)
        page.wait_for_selector('#approveBtn', timeout=30000)

        # --- CTA selection against the real API -------------------------------
        opts = page.locator('.ctaOption')
        assert opts.count() >= 2, 'the approve card must show the alternate captions'
        assert page.locator('[data-cta-copy]').count() == opts.count()
        assert page.locator('[data-cta-use]').count() == opts.count() - 1
        before_rx = next(x for x in server_state(page)['prescriptions'] if x.get('status') == 'PRESCRIBED')
        alternate = before_rx['cta_options'][1]
        safe_click(page, lambda: page.locator('[data-cta-use="1"]'))
        wait_for(page, lambda: next(x for x in server_state(page)['prescriptions']
                                    if x.get('status') == 'PRESCRIBED')['cta'] == alternate,
                 'the alternate caption to persist as the selected caption')
        after_rx = next(x for x in server_state(page)['prescriptions'] if x.get('status') == 'PRESCRIBED')
        assert after_rx['revision_of'] == before_rx['prescription_id']
        assert after_rx['cta_selection_source'] == 'CREATOR_SELECTED'
        assert next(x for x in server_state(page)['prescriptions']
                    if x['prescription_id'] == before_rx['prescription_id'])['status'] == 'REVISED'
        # The command resolves before load()+render() repaint, so wait on the DOM too.
        page.wait_for_function(
            "t=>{const e=document.querySelector('.ctaSelected');return !!e&&e.innerText.includes(t)}",
            arg=alternate, timeout=20000)
        assert page.locator('.ctaSelected').count() == 1
        step('alternate CTA selected directly from READY TO APPROVE and persisted')

        original_rx = next(x for x in server_state(page)['prescriptions'] if x.get('status') == 'PRESCRIBED')
        safe_click(page, lambda: page.locator('#changeBtn'))
        page.locator('#chgReason').fill('test revision')
        page.get_by_role('button', name='CREATE REVISION').click()
        wait_for(page, lambda: next(x for x in server_state(page)['prescriptions']
                                    if x['prescription_id'] == original_rx['prescription_id'])['status'] == 'REVISED',
                 'the original prescription to be revised')
        revision = next(x for x in server_state(page)['prescriptions'] if x.get('revision_of') == original_rx['prescription_id'])
        assert revision['status'] == 'PRESCRIBED' and revision['change_reason'] == 'test revision', \
            'a revision is a new prescription with a reason, never an edit in place'
        for attempt in range(6):
            prescribed = [x for x in server_state(page)['prescriptions'] if x.get('status') == 'PRESCRIBED']
            if not prescribed:
                break
            close_modal(page)
            page.wait_for_selector('#declineBtn', timeout=30000)
            wait_btn_rx(page, 'declineBtn', prescribed[-1]['prescription_id'],
                        'the decline button to target the live prescription')
            safe_click(page, lambda: page.locator('#declineBtn'))
            page.locator('#declineReason').wait_for(timeout=10000)
            page.locator('#declineReason').fill('test decline')
            page.locator('#modal').get_by_role('button', name='DECLINE', exact=True).click()
            for _ in range(16):
                page.wait_for_timeout(250)
                if not any(x.get('status') == 'PRESCRIBED' for x in server_state(page)['prescriptions']):
                    break
        assert not any(x.get('status') == 'PRESCRIBED' for x in server_state(page)['prescriptions']), \
            'the decline never persisted'
        step('real prescribe, revise with a reason, decline with a reason')

        preview_day(page, 'Mon')
        safe_click(page, lambda: page.get_by_role('button', name='USE THIS', exact=True).first)
        page.wait_for_selector('#approveBtn', timeout=30000)
        fresh_rx = wait_for(page, lambda: next((x for x in server_state(page)['prescriptions']
                                                if x.get('status') == 'PRESCRIBED'), None),
                            'a fresh prescription to approve')
        wait_btn_rx(page, 'approveBtn', fresh_rx['prescription_id'], 'the approve button to target the fresh prescription')
        safe_click(page, lambda: page.locator('#approveBtn'))
        wait_for(page, lambda: any(a['status'] == 'APPROVED' for a in server_state(page)['actions']),
                 'the approval to persist')
        page.wait_for_selector('#view button', timeout=30000)
        safe_click(page, lambda: page.locator('#view').get_by_role('button', name='MARK POSTED', exact=True))
        mp = page.locator('#modal').inner_text()
        assert 'never invents' in mp, 'the denominator promise must be on the mark-posted form'
        page.locator('#postRef').fill('real-browser-post')
        page.locator('#effort').fill('7')
        page.locator('#mpSent').fill('40')
        page.locator('#modal').get_by_role('button', name='MARK POSTED', exact=True).click()
        page.locator('#modal').wait_for(state='hidden', timeout=30000)
        act = wait_for(page, lambda: next((a for a in server_state(page)['actions'] if a['status'] in ('EXECUTED', 'MEASURED')), None),
                       'the executed action')
        assert act['creator_effort_minutes'] == 7, 'effort must be the real number entered'
        assert int(act.get('sent_to') or 0) == 40, 'sent_to must be the real recipient count'
        step('real approve + mark posted with the actual treatment and a real sent_to')

        # --- cam session against the real ledger --------------------------------
        preview_day(page, 'Fri')
        if page.get_by_role('button', name='LOG CAM SESSION').count() == 0:
            raise AssertionError('no cam control on Friday. view=%r cam=%r' % (
                page.locator('#view').inner_text()[:900],
                server_state(page)['settings'].get('camAvailability')))
        safe_click(page, lambda: page.get_by_role('button', name='LOG CAM SESSION').first)
        page.locator('#cs9').wait_for()
        for f, v in [('#cs1', '2026-09-11T09:05'), ('#cs2', '2026-09-11T12:10'), ('#cs3', '195'),
                     ('#cs4', '1343'), ('#cs5', '1361'), ('#cs6', '880'), ('#cs7', '44')]:
            page.locator(f).fill(v)
        page.locator('#cs9').select_option(label='Bookish / Nerdy Daytime')
        page.get_by_role('button', name='SAVE SESSION').click()
        sess = wait_for(page, lambda: (server_state(page).get('camSessions') or [None])[0], 'the cam session to persist')
        assert sess['day_code'] == 'FRI' and sess['followers_delta'] == 18
        assert sess['outside_configured_availability'] is False, \
            'a 9:05 AM Central session is inside a 09:00-13:00 window'
        assert sess['theme'] == 'Bookish / Nerdy Daytime'
        step('real cam session records the full pilot record inside the configured window')

        # --- RESULTS: measure, correct, revenue, custom order -------------------
        open_view(page, 'results')
        safe_click(page, lambda: page.get_by_role('button', name='MEASURE', exact=True).first)
        page.locator('#m-views').fill('101')
        page.locator('#m-tracked_clicks').fill('8')
        page.locator('#modal').get_by_role('button', name='SAVE', exact=True).click()
        wait_for(page, lambda: any(o['measurement_state'] == 'MEASURED' for o in server_state(page)['outcomes']),
                 'the measurement to persist')
        safe_click(page, lambda: page.get_by_role('button', name='CORRECT', exact=True).first)
        page.locator('#corReason').fill('verified correction')
        page.locator('#m-views').fill('111')
        page.locator('#modal').get_by_role('button', name='SAVE', exact=True).click()
        wait_for(page, lambda: len(server_state(page)['measurementCorrections']) >= 1, 'the correction to persist')
        safe_click(page, lambda: page.locator('#addRevenueBtn'))
        page.locator('#rtype').select_option(label='TIP')
        page.locator('#ramount').fill('5')
        page.get_by_role('button', name='SAVE REVENUE').click()
        safe_click(page, lambda: page.locator('#customOrderBtn'))
        page.locator('#camount').fill('25')
        page.locator('#cref').fill('custom-1')
        page.locator('#cdel').fill('custom deliverable')
        page.get_by_role('button', name='SAVE CUSTOM ORDER').click()
        wait_for(page, lambda: len(server_state(page)['customOrders']) >= 1, 'the custom order to persist')
        step('real measurement, correction, revenue and custom order')

        # --- branch shoot, real video pipeline, historical review ---------------
        open_view(page, 'library')
        lib_tab(page, 'BRANCH SHOOTS')
        safe_click(page, lambda: page.locator('#brandShootBtn'))
        page.locator('#sn').fill('Gap Shoot')
        page.locator('#sg').fill('Missing vertical teaser family')
        page.locator('[data-sp="X"]').check()
        page.locator('#sr').fill('hero image + vertical teaser')
        page.get_by_role('button', name='CREATE DRAFT').click()
        page.get_by_role('button', name='APPROVE').first.click()
        wait_for(page, lambda: any(s['status'] == 'APPROVED' for s in server_state(page)['brandShoots']),
                 'the branch shoot to be approved')
        step('real branch shoot create + approve')

        lib_tab(page, 'MEDIA')
        close_modal(page)
        safe_click(page, lambda: page.locator('#uploadBtn'))
        page.locator('#files').set_input_files(str(vid))
        page.locator('#upAuth').select_option(label='AUTHORIZED')
        page.get_by_role('button', name='UPLOAD + ANALYZE + SAVE').click()
        page.locator('#modal').wait_for(state='hidden', timeout=90000)
        va = wait_for(page, lambda: next((a for a in server_assets(page)
                                          if a.get('media_type') == 'VIDEO' and len(a.get('variants', [])) > 0), None),
                      'the video to render its derivatives', tries=320)
        assert any(v.get('variant_type') == 'FULL_MASTER' for v in va['variants']), 'the full master export must exist'
        fm = next(v for v in va['variants'] if v.get('variant_type') == 'FULL_MASTER')
        assert abs(float(fm.get('final_runtime') or fm.get('duration_seconds') or 0) - float(va['analysis']['duration_seconds'])) < 1.5, \
            'the master must span the whole uploaded source, not a 5-minute cut'
        step('real video upload + automatic render')

        close_modal(page)
        open_view(page, 'library')
        safe_click(page, lambda: page.locator('.mediaCard').filter(has_text=va['name']).first.get_by_role('button', name='REVIEW EXISTING'))
        page.locator('#hp').select_option(label='OnlyFans Paid')
        page.locator('#href').fill('existing-video-ref')
        page.get_by_role('button', name='ADD HISTORICAL RECORD').click()
        wait_for(page, lambda: len(server_state(page)['historicalPublications']) >= 1,
                 'the historical publication to persist')
        assert server_state(page)['historicalPublications'][0]['status'] == 'HISTORICAL_BASELINE', \
            'existing published work stays historical truth'
        step('real historical record preserved, never rewritten')

        # --- exports / import against the real endpoints ------------------------
        close_modal(page)
        open_view(page, 'results')
        with page.expect_download(timeout=20000): safe_click(page, lambda: page.locator('#exportJsonBtn'))
        with page.expect_download(timeout=20000): safe_click(page, lambda: page.locator('#exportCsvBtn'))
        imp = tmp / 'merge.json'
        imp.write_text(json.dumps({'schemaVersion': 'fixture', 'revenueEvents': [
            {'revenue_event_id': 'BROWSER-IMPORT-1', 'action_id': None, 'event_type': 'OTHER',
             'gross_amount': 1, 'attribution_precision': 'UNATTRIBUTED'}]}))
        safe_click(page, lambda: page.get_by_role('button', name='RESTORE / IMPORT JSON'))
        page.locator('#imp').set_input_files(str(imp))
        page.locator('#modal').get_by_role('button', name='IMPORT', exact=True).click()
        wait_for(page, lambda: any(r['revenue_event_id'] == 'BROWSER-IMPORT-1' for r in server_state(page)['revenueEvents']),
                 'the merge import to land')
        step('real export + import')

        # --- final persisted-state assertions -----------------------------------
        st = server_state(page)
        aa = server_assets(page)
        assert st['baseline']['locked'] is True
        assert len(st['measurementCorrections']) >= 1
        assert len(st['revenueEvents']) >= 3
        assert len(st['customOrders']) >= 1
        assert len(st['brandShoots']) >= 1
        assert len(st['camSessions']) == 1
        assert any(a['media_type'] == 'IMAGE' and len(a.get('variants', [])) >= 2 for a in aa)
        assert any(a['media_type'] == 'VIDEO' and len(a.get('variants', [])) >= 1 for a in aa)
        assert st['settings']['camAvailability']['days'] == ['TUE', 'FRI']
        step('real persisted final-state assertions')

        browser.close()
    report['pass'] = not report['page_errors'] and not report['console_errors']
    report['groups_passed'] = len(report['steps'])
except Exception as e:
    report['error'] = repr(e)
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except Exception:
        server.kill()
    # Surface anything the real functions logged. A 500 in the browser console is
    # useless without the server-side reason, and RC1 threw that reason away.
    try:
        err = server.stderr.read() or ''
    except Exception:
        err = ''
    report['server_errors'] = [l for l in err.splitlines() if l.strip()]
    if report['server_errors']:
        report['pass'] = False
        print('SERVER ERRORS:\n' + '\n'.join(report['server_errors'][:40]))

(ROOT / 'tests/BROWSER_REAL_API_RESULTS.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
if not report['pass']:
    raise SystemExit(1)
