"""LUXX v1.7.0 RC2 — visible browser UI test.

What changed from RC1
---------------------
1. RC1 carried a hand-written Python re-implementation of the domain. It had drifted
   away from the app, so the suite passed against a LUXX that no longer existed. The
   mock is gone: /api/action now executes the REAL domain through tests/domain-bridge.mjs.
2. RC1 drove '#prescribeBtn', a control that only exists on the HOLD card now. The
   suite drives the real job-based TODAY: USE THIS -> READY TO APPROVE -> APPROVE ->
   MARK POSTED.
3. RC1 called page.set_content(), which leaves the page on an opaque about:blank
   origin. Reading localStorage there throws a SecurityError and killed boot before
   #shell was ever shown. The page is now served from a real https://luxx.test origin.
4. RC1 hard-coded /usr/bin/chromium and /mnt/data/_luxx_browser_e2e/test-image.png.
   The browser comes from Playwright (override with LUXX_CHROMIUM_PATH) and the image
   fixture is generated into a temp directory at run time.

Run:  python tests/browser-tests.py
"""
import json, os, pathlib, re, subprocess, sys, tempfile
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
html = (ROOT / 'public/index.html').read_text()

report = {'pass': False, 'steps': [], 'page_errors': [], 'console_errors': [], 'dialogs': []}
def step(x):
    report['steps'].append(x)
    print('  step:', x)

tmp = pathlib.Path(tempfile.mkdtemp(prefix='luxx-browser-'))
fixture = tmp / 'test-image.png'
FFMPEG = os.environ.get('LUXX_FFMPEG_PATH', 'ffmpeg')
subprocess.run([FFMPEG, '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=240x320', '-frames:v', '1', str(fixture)],
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

# ---------------------------------------------------------------------------
# Real domain, driven through the bridge. State persists between calls exactly as it
# would on the server, so the UI is exercised against current behaviour.
# ---------------------------------------------------------------------------
state = {}
def domain_call(op, payload):
    proc = subprocess.run(['node', str(ROOT / 'tests/domain-bridge.mjs')],
                          input=json.dumps({'state': state, 'assets': assets, 'op': op, 'payload': payload}),
                          capture_output=True, text=True, cwd=str(ROOT))
    if proc.returncode != 0:
        raise RuntimeError('domain bridge crashed: ' + proc.stderr[-2000:])
    out = json.loads(proc.stdout)
    state.clear(); state.update(out['state'])
    return out

def variant(vid, asset_id, vtype, **extra):
    v = {'variant_id': vid, 'asset_id': asset_id, 'variant_type': vtype, 'rendered': True,
         'privacy_safe_export': True, 'metadata_stripped': True,
         'thumbnail_key': 'thumb/%s/%s.jpg' % (asset_id, vid),
         'recipe': {'mode': 'AUTO_BEST', 'aspect': 'ORIGINAL', 'processing_version': 'ORIENTATION_VERIFIED_V3'},
         'orientation_verified': True, 'evidence_label': 'TECHNICAL HEURISTIC'}
    v.update(extra)
    return v

assets = [
    {'asset_id': 'IMG-BROWSER', 'media_type': 'IMAGE', 'name': 'browser-image.png', 'type': 'image/png',
     'size': 100, 'parts': 1, 'status': 'READY_FOR_REVIEW', 'authorization_status': 'AUTHORIZED',
     'availability': 'AVAILABLE', 'historical_usage_status': 'PROSPECTIVE', 'platform_eligibility': [],
     'notes': '', 'master_sha256': 'abc123456789', 'thumbnail_key': 'thumb/IMG-BROWSER/thumb.jpg',
     'uploaded_at': '2026-09-05T10:00:00Z', 'visual_score': {'score': 78.4},
     'variants': [variant('IMG-BROWSER-SAFE', 'IMG-BROWSER', 'PRIVACY_SAFE_EXPORT')]},
    {'asset_id': 'IMG-BROWSER-2', 'media_type': 'IMAGE', 'name': 'browser-image-two.png', 'type': 'image/png',
     'size': 120, 'parts': 1, 'status': 'READY_FOR_REVIEW', 'authorization_status': 'AUTHORIZED',
     'availability': 'AVAILABLE', 'historical_usage_status': 'PROSPECTIVE', 'platform_eligibility': [],
     'notes': '', 'master_sha256': 'abc987654321', 'thumbnail_key': 'thumb/IMG-BROWSER-2/thumb.jpg',
     'uploaded_at': '2026-09-05T10:30:00Z', 'visual_score': {'score': 71.2},
     'variants': [variant('IMG-BROWSER-2-SAFE', 'IMG-BROWSER-2', 'PRIVACY_SAFE_EXPORT')]},
    {'asset_id': 'VID-BROWSER', 'media_type': 'VIDEO', 'name': 'browser-video.mp4', 'type': 'video/mp4',
     'size': 1000, 'parts': 1, 'status': 'READY_FOR_REVIEW', 'authorization_status': 'AUTHORIZED',
     'availability': 'AVAILABLE', 'historical_usage_status': 'PROSPECTIVE',
     'platform_eligibility': ['Pornhub', 'OnlyFans Paid'], 'notes': '', 'master_sha256': 'def123456789',
     'thumbnail_key': 'thumb/VID-BROWSER/thumb.jpg', 'uploaded_at': '2026-09-05T11:00:00Z',
     'analysis': {'duration_seconds': 451},
     'variants': [
        variant('FULL-MASTER', 'VID-BROWSER', 'FULL_MASTER', duration_seconds=300, final_runtime=300,
                start_seconds=0, start_timestamp='0', end_timestamp='300',
                thumbnail_frame_timestamp_or_reference='0.5s', title_direction='Title',
                description_direction='Description', cta='Open the full paid drop.',
                tracking_route_id='PH_VIDEO_DESC_TO_OF_FREE_01', platform='Pornhub',
                price_if_applicable=None, price_creator_approved=False,
                native_listing_measurement_capability=False),
        variant('TEASER-1', 'VID-BROWSER', 'TEASER', duration_seconds=30, final_runtime=30,
                start_seconds=0, start_timestamp='0', end_timestamp='30',
                thumbnail_frame_timestamp_or_reference='0.5s', title_direction='Title',
                description_direction='Description', cta='Full scene on OnlyFans Free.',
                tracking_route_id='PH_VIDEO_DESC_TO_OF_FREE_01', platform='Pornhub',
                price_if_applicable=None, price_creator_approved=False,
                native_listing_measurement_capability=False)]}
]

PNG = fixture.read_bytes()

def handler(route, request):
    u = urlparse(request.url)
    path = u.path
    if path in ('/', '/index.html'):
        return route.fulfill(body=html, headers={'content-type': 'text/html; charset=utf-8'})
    if path == '/api/session':
        return route.fulfill(json={'authenticated': True, 'configured': True})
    if path in ('/api/login', '/api/logout'):
        return route.fulfill(json={'ok': True})
    if path == '/api/health':
        return route.fulfill(json={'version': '1.7.0-rc2', 'parent': {'name': 'LUXX Simplified Revenue Pilot v1.2.1'},
                                   'features': {'video_manual_edit': True}})
    if path == '/api/state':
        if not state:
            domain_call('BASELINE_COVERAGE', {})
        return route.fulfill(json={'state': state})
    if path == '/api/assets':
        return route.fulfill(json={'assets': assets, 'total': len(assets), 'next_cursor': None})
    if path == '/api/assets-index':
        return route.fulfill(json={'signature': 'browser-test-signature'})
    if path == '/api/action':
        body = json.loads(request.post_data or '{}')
        out = domain_call(body.get('op'), body.get('payload') or {})
        if not out['ok']:
            return route.fulfill(status=400, json={'error': out['error']})
        return route.fulfill(json={'ok': True, 'result': out['result'], 'state': state})
    if path == '/api/settings':
        body = json.loads(request.post_data or '{}')
        state.setdefault('settings', {}).update(body)
        return route.fulfill(json={'ok': True, 'settings': state['settings']})
    if path == '/api/asset-update':
        body = json.loads(request.post_data or '{}')
        a = next((x for x in assets if x['asset_id'] == body.get('asset_id')), None)
        if a:
            a.update({k: v for k, v in body.items() if k != 'asset_id'})
        return route.fulfill(json={'ok': True, 'asset': a})
    if path == '/api/asset-batch-update':
        return route.fulfill(json={'ok': True, 'updated': 0})
    if path == '/api/asset-delete':
        body = json.loads(request.post_data or '{}')
        return route.fulfill(json={'ok': True, 'asset_id': body.get('asset_id'), 'rule': 'SAFE_UNUSED_DUPLICATE_ONLY'})
    if path == '/api/image-edit':
        body = json.loads(request.post_data or '{}')
        a = next((x for x in assets if x['asset_id'] == body.get('asset_id')), assets[0])
        v = variant('IMG-EDIT-%d' % len(a['variants']), a['asset_id'], 'MANUAL_EDIT')
        a['variants'].append(v)
        return route.fulfill(json={'ok': True, 'variant': v})
    if path == '/api/start-media-job':
        return route.fulfill(json={'ok': True, 'job': {'job_id': 'JOB-1', 'status': 'QUEUED'}})
    if path in ('/api/kick-media-job', '/api/job'):
        return route.fulfill(json={'ok': True, 'job': {'job_id': 'JOB-1', 'status': 'COMPLETE'}})
    if path == '/api/variant-update':
        return route.fulfill(json={'ok': True})
    if path in ('/api/upload-chunk', '/api/thumbnail'):
        return route.fulfill(json={'ok': True})
    if path == '/api/upload-complete':
        return route.fulfill(json={'ok': True, 'asset': assets[0]})
    if path == '/api/media-chunk':
        return route.fulfill(body=PNG, headers={'content-type': 'image/png'})
    if path == '/api/download-manifest':
        return route.fulfill(json={'parts': [{'url': '/api/media-chunk?key=x'}]})
    if path == '/api/hls':
        return route.fulfill(body='#EXTM3U\n', headers={'content-type': 'application/vnd.apple.mpegurl'})
    if path == '/api/export-data':
        if parse_qs(u.query).get('format', ['json'])[0] == 'csv':
            return route.fulfill(body='a,b\n1,2\n',
                                 headers={'content-type': 'text/csv',
                                          'content-disposition': 'attachment; filename="LUXX_RESULTS_EXPORT.csv"'})
        return route.fulfill(body=json.dumps(state),
                             headers={'content-type': 'application/json',
                                      'content-disposition': 'attachment; filename="LUXX_STATE_EXPORT.json"'})
    if path == '/api/import-data':
        return route.fulfill(json={'ok': True, 'state': state})
    return route.fulfill(status=404, body='mock missing ' + path)

BASELINE_IMPORT_FILE = json.dumps({
    'schema': 'LUXX_BASELINE_IMPORT_V1',
    'rows': [
        {'platform': 'X', 'metric': 'followers', 'value': 36, 'evidence_reference': 'x.png'},
        {'platform': 'Chaturbate', 'metric': 'followers', 'value': 1343, 'evidence_reference': 'cb.png'},
        {'platform': 'OnlyFans Paid', 'metric': 'revenue_last_30_days', 'value': 'NOT_AVAILABLE',
         'evidence_reference': 'ofp.png', 'notes': 'dashboard does not expose it'}
    ]})

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
    """Some SETUP actions close and immediately reopen the modal. Always start clean."""
    safe_click(page, lambda: page.locator('#setupBtn'))
    page.locator('#modal .modalBack').wait_for()

def open_view(page, name):
    safe_click(page, lambda: page.locator('button[data-view="%s"]' % name))
    page.wait_for_timeout(400)

def lib_tab(page, name):
    safe_click(page, lambda: page.get_by_role('button', name=name, exact=True).first)
    page.wait_for_timeout(400)

def preview_day(page, label):
    """Select a day in the TODAY strip and wait until that day is actually rendered."""
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

def wait_state(page, pred, why, tries=60):
    """Poll a condition on the mirrored server state.

    The wait MUST yield through Playwright (page.wait_for_timeout), never time.sleep:
    with the sync API the route handlers run on this same thread, so a blocking sleep
    would starve /api/action and the request under test would never be served.
    """
    for _ in range(tries):
        try:
            if pred():
                return
        except Exception:
            pass
        page.wait_for_timeout(250)
    raise AssertionError('timed out waiting for: ' + why)

def wait_btn_rx(page, btn_id, rx_id, why):
    """The TODAY buttons carry the prescription id in their onclick. After a revision the
    DOM must catch up before we click, or the click targets the superseded prescription."""
    page.wait_for_function(
        "a=>{const b=document.getElementById(a.id);return !!b&&(b.getAttribute('onclick')||'').includes(a.rx)}",
        arg={'id': btn_id, 'rx': rx_id}, timeout=20000)

def launch(p):
    exe = os.environ.get('LUXX_CHROMIUM_PATH')
    kwargs = {'headless': True, 'args': ['--no-sandbox']}
    if exe:
        kwargs['executable_path'] = exe
    return p.chromium.launch(**kwargs)

try:
    with sync_playwright() as p:
        browser = launch(p)
        page = browser.new_page(accept_downloads=True)
        page.route('https://luxx.test/**', handler)
        page.on('pageerror', lambda e: report['page_errors'].append(str(e)))
        page.on('console', lambda m: report['console_errors'].append(m.text) if m.type == 'error' else None)
        page.on('dialog', lambda d: (report['dialogs'].append(d.message), d.accept()))

        # Served from a real origin, so localStorage works and boot is not killed by it.
        page.goto('https://luxx.test/', wait_until='networkidle')
        page.locator('#shell').wait_for(state='visible'); step('boot on a real origin')
        probe = page.evaluate("(()=>{try{localStorage.setItem('luxx_probe','1');return localStorage.getItem('luxx_probe')}catch(e){return 'THREW'}})()")
        assert probe == '1', 'localStorage must be usable on a real origin'
        assert page.locator('.nav button').count() == 3; step('3 primary nav tabs — no fourth tab')
        # The 4s background poll re-renders TODAY with the CURRENT day, which would race
        # every day-preview assertion below. Polling is not a visible control, so stop it
        # and drive every refresh explicitly from the controls under test.
        page.evaluate("()=>{for(let i=1;i<5000;i++)clearInterval(i)}")

        # --- SETUP: IMPORT -> REVIEW -> CAPTURE -> LOCK ------------------------
        open_setup(page)
        modal_text = page.locator('#modal').inner_text()
        assert 'Import baseline' in modal_text, 'IMPORT BASELINE must live inside SETUP'
        assert 'Cam availability' in modal_text, 'CAM AVAILABILITY must live inside SETUP'
        page.locator('#blImpText').fill(BASELINE_IMPORT_FILE)
        retry_click(page, lambda: page.locator('#importBaselineBtn'))
        wait_state(page, lambda: any(v.get('source') == 'IMPORT' for v in state['baseline']['snapshots']),
                   'the baseline import to land')
        page.wait_for_timeout(400)
        open_setup(page)
        review = page.locator('#modal').inner_text()
        assert 'NOT AVAILABLE' in review, 'an unavailable metric must stay NOT AVAILABLE in review'
        assert 'IMPORTED_PENDING_REVIEW' in review, 'imported values wait for human review'
        assert state['baseline']['captured'] is False and state['baseline']['locked'] is False, \
            'import must not capture and must not lock'
        step('baseline import populates review, preserves NOT AVAILABLE, does not lock')

        fill_stable(page, '#be', 'launch-day screenshots')
        fill_stable(page, '#bi', 'library map')
        retry_click(page, lambda: page.locator('#captureBaselineBtn'))
        page.wait_for_function("!document.querySelector('#lockBaselineBtn')?.disabled")
        retry_click(page, lambda: page.locator('#lockBaselineBtn'))
        wait_state(page, lambda: state['baseline']['locked'] is True, 'the baseline to lock')
        step('capture then lock, in that order')

        open_setup(page)
        assert page.locator('#importBaselineBtn').is_disabled(), 'import must be refused once the baseline is locked'
        assert 'BASELINE IS LOCKED' in page.locator('#modal').inner_text()
        step('locked baseline cannot be overwritten by import')

        # --- SETUP: cam availability ------------------------------------------
        assert 'CAM AVAILABILITY NOT FINALIZED' in page.locator('#modal').inner_text()
        assert page.locator('[data-camday]').count() == 5, 'only the five weekdays are offered'
        codes = page.locator('[data-camday]').evaluate_all("els=>els.map(e=>e.dataset.camday)")
        assert 'SAT' not in codes and 'SUN' not in codes, 'weekend must not be offerable anywhere'
        step('cam availability offers weekdays only')

        page.locator('#selfTestBtn').click(); page.wait_for_timeout(80)
        page.locator('.close').click(); step('system health + close')

        # --- TODAY before availability is configured ---------------------------
        open_view(page, 'today')
        page.locator('.dayStrip button').first.wait_for()
        assert page.locator('.dayStrip button').count() == 7, 'day strip must offer all 7 days'
        preview_day(page, 'Mon')
        body = page.locator('#view').inner_text()
        assert 'CAM AVAILABILITY NOT FINALIZED' in body, 'TODAY must say cam availability is unset'
        assert 'PRODUCE is OFF' in body, 'PRODUCE must be reported OFF with no documented gap'
        live_card = page.locator('.jobCard').filter(has_text='CAM AVAILABILITY NOT FINALIZED').first.inner_text()
        assert not re.search(r'\d\s*(AM|PM)', live_card), 'TODAY must not invent a cam clock time'
        assert 'LOG CAM SESSION' not in body, 'LIVE must not be actionable before availability is set'
        assert page.locator('.jobCard').count() <= 5
        step('TODAY refuses to invent a LIVE time and reports PRODUCE off')

        # --- configure availability, then confirm LIVE appears -----------------
        open_setup(page)
        page.locator('[data-camday="TUE"]').check()
        page.locator('[data-camday="FRI"]').check()
        page.locator('#camStart').fill('09:00')
        page.locator('#camEnd').fill('13:00')
        retry_click(page, lambda: page.locator('#saveCamAvailBtn'))
        wait_state(page, lambda: state['settings']['camAvailability']['configured'] is True,
                   'cam availability to be saved')
        page.wait_for_timeout(500)
        open_view(page, 'today')
        preview_day(page, 'Fri')
        fri = page.locator('#view').inner_text()
        assert 'LOG CAM SESSION' in fri, 'a configured weekday must offer the cam session control'
        assert '9:00 AM–1:00 PM' in fri, 'the LIVE card uses the configured window'
        preview_day(page, 'Sat')
        assert not any(t.strip() == 'LIVE' for t in page.locator('.jobTag').all_inner_texts()), \
            'Saturday must carry no LIVE job at all'
        assert 'LOG CAM SESSION' not in page.locator('#view').inner_text()
        preview_day(page, 'Sun')
        assert not any(t.strip() == 'LIVE' for t in page.locator('.jobTag').all_inner_texts()), \
            'Sunday must carry no LIVE job at all'
        step('LIVE appears only on configured weekdays and never on the weekend')

        # --- cam session logging carries the optional theme ---------------------
        preview_day(page, 'Fri')
        safe_click(page, lambda: page.get_by_role('button', name='LOG CAM SESSION').first)
        try:
            page.locator('#cs9').wait_for(timeout=8000)
        except Exception:
            raise AssertionError('cam session modal never opened; modal was: '
                                 + repr(page.locator('#modal').inner_text()[:400]))
        cam_modal = page.locator('#modal').inner_text()
        assert 'theme used' in cam_modal.lower(), 'the optional theme field must exist: ' + repr(cam_modal[:600])
        assert page.locator('#cs9 option').count() == 5, 'four suggested themes plus the no-theme default'
        assert 'GUESS / DEFAULT' in cam_modal, 'a theme must be labelled a guess'
        for f, v in [('#cs1', '2026-09-11T09:05'), ('#cs2', '2026-09-11T12:10'), ('#cs3', '195'),
                     ('#cs4', '1343'), ('#cs5', '1361'), ('#cs6', '880'), ('#cs7', '44')]:
            page.locator(f).fill(v)
        page.locator('#cs9').select_option(label='Bookish / Nerdy Daytime')
        page.get_by_role('button', name='SAVE SESSION').click()
        page.wait_for_timeout(1200)
        wait_state(page, lambda: len(state.get('camSessions', [])) == 1, 'the cam session to be recorded')
        sess = state['camSessions'][0]
        assert sess['followers_delta'] == 18, 'follower delta: %r' % sess
        assert sess['theme'] == 'Bookish / Nerdy Daytime', 'theme: %r' % sess
        assert sess['tips_tokens'] == 880 and sess['native_revenue'] == 44, 'tips/revenue: %r' % sess
        assert sess['effort_minutes'] == 195, 'effort: %r' % sess
        assert sess['outside_configured_availability'] is False, 'deviation flag: %r' % sess
        step('cam session records start, end, effort, followers, tips, revenue and theme')

        # --- TODAY: the real job-based approval loop ---------------------------
        preview_day(page, 'Mon')
        assert page.locator('.jobCard').count() > 0
        for i in range(page.locator('.stampLine').count()):
            assert page.locator('.stampLine').nth(i).locator('.stampSubject').count() == 1, \
                'a CALL/GUESS stamp rendered without its subject'
        safe_click(page, lambda: page.get_by_role('button', name='USE THIS', exact=True).first)
        page.wait_for_selector('#approveBtn', timeout=20000)
        step('USE THIS creates a prescription from the job card')


        # --- CTA selection lives inside READY TO APPROVE, no extra modal ------
        opts = page.locator('.ctaOption')
        assert opts.count() >= 2, 'the approve card must show the alternate captions'
        assert page.locator('.ctaSelected').count() == 1, 'exactly one caption is marked selected'
        assert 'SELECTED CTA' in page.locator('.ctaSelected').inner_text()
        assert page.locator('[data-cta-copy]').count() == opts.count(), 'every caption has its own COPY'
        assert page.locator('[data-cta-use]').count() == opts.count() - 1, 'every other caption switches directly'
        before_rx = next(x for x in state['prescriptions'] if x.get('status') == 'PRESCRIBED')
        alternate = before_rx['cta_options'][1]
        safe_click(page, lambda: page.locator('[data-cta-use="1"]'))
        wait_state(page, lambda: next(x for x in state['prescriptions']
                                      if x.get('status') == 'PRESCRIBED')['cta'] == alternate,
                   'the alternate caption to become the selected caption')
        after_rx = next(x for x in state['prescriptions'] if x.get('status') == 'PRESCRIBED')
        assert after_rx['prescription_id'] != before_rx['prescription_id'], 'a selection is a revision'
        assert after_rx['cta_selection_source'] == 'CREATOR_SELECTED'
        assert next(x for x in state['prescriptions']
                    if x['prescription_id'] == before_rx['prescription_id'])['status'] == 'REVISED'
        # The command resolves before load()+render() repaint, so wait on the DOM too.
        page.wait_for_function(
            "t=>{const e=document.querySelector('.ctaSelected');return !!e&&e.innerText.includes(t)}",
            arg=alternate, timeout=20000)
        assert alternate in page.locator('.ctaSelected').inner_text(), 'the new caption is visibly marked'
        assert page.locator('.ctaSelected').count() == 1, 'still exactly one selected caption'
        assert page.locator('[data-cta-use="1"]').count() == 0, 'the now-selected caption offers no USE THIS CTA'
        assert page.locator('[data-cta-use="0"]').count() == 1, 'the previous default is switchable back'
        step('alternate CTA selected directly from READY TO APPROVE, history preserved')

        original_rx = next(x for x in state['prescriptions'] if x.get('status') == 'PRESCRIBED')
        safe_click(page, lambda: page.locator('#changeBtn'))
        page.locator('#chgReason').fill('revision reason')
        page.get_by_role('button', name='CREATE REVISION').click()
        # Waiting on "exactly one PRESCRIBED" would pass before the change even ran, so the
        # wait is on the ORIGINAL line actually flipping to REVISED.
        wait_state(page, lambda: next(x for x in state['prescriptions']
                                      if x['prescription_id'] == original_rx['prescription_id'])['status'] == 'REVISED',
                   'the original prescription to be revised')
        revision = next(x for x in state['prescriptions'] if x.get('revision_of') == original_rx['prescription_id'])
        assert revision['status'] == 'PRESCRIBED' and revision['change_reason'] == 'revision reason', \
            'a revision is a new prescription with a reason, never an edit in place'

        # TODAY re-renders asynchronously after every command, so the decline is driven as a
        # loop: point at whatever is prescribed right now, decline it, confirm it landed.
        for attempt in range(6):
            prescribed = [x for x in state['prescriptions'] if x.get('status') == 'PRESCRIBED']
            if not prescribed:
                break
            close_modal(page)
            page.wait_for_selector('#declineBtn', timeout=20000)
            wait_btn_rx(page, 'declineBtn', prescribed[-1]['prescription_id'],
                        'the decline button to target the live prescription')
            safe_click(page, lambda: page.locator('#declineBtn'))
            page.locator('#declineReason').wait_for(timeout=10000)
            page.locator('#declineReason').fill('decline reason')
            page.locator('#modal').get_by_role('button', name='DECLINE', exact=True).click()
            for _ in range(16):
                page.wait_for_timeout(250)
                if not any(x.get('status') == 'PRESCRIBED' for x in state['prescriptions']):
                    break
        assert not any(x.get('status') == 'PRESCRIBED' for x in state['prescriptions']), \
            'the decline never persisted: %r' % [(x['prescription_id'], x['status']) for x in state['prescriptions']]
        declined = [x for x in state['prescriptions'] if x.get('status') == 'DECLINED']
        assert declined and declined[0].get('decline_reason') == 'decline reason'
        step('change with a reason, then decline with a reason')

        safe_click(page, lambda: page.get_by_role('button', name='USE THIS', exact=True).first)
        page.wait_for_selector('#approveBtn', timeout=20000)
        wait_state(page, lambda: len([x for x in state['prescriptions'] if x.get('status') == 'PRESCRIBED']) == 1,
                   'a single fresh prescription to approve')
        fresh_rx = next(x for x in state['prescriptions'] if x.get('status') == 'PRESCRIBED')
        wait_btn_rx(page, 'approveBtn', fresh_rx['prescription_id'], 'the approve button to target the fresh prescription')
        safe_click(page, lambda: page.locator('#approveBtn'))
        wait_state(page, lambda: any(a['status'] == 'APPROVED' for a in state['actions']), 'the approval to persist')
        safe_click(page, lambda: page.locator('#view').get_by_role('button', name='MARK POSTED', exact=True))
        mp = page.locator('#modal').inner_text()
        assert 'actually' in mp.lower(), 'mark-posted must ask what was ACTUALLY sent'
        assert page.locator('#mpStyle').count() == 1, 'preview style field missing'
        assert page.locator('#mpSeg').count() == 1, 'audience segment field missing'
        assert page.locator('#mpSent').count() == 1, 'sent_to field missing'
        assert 'never invents' in mp, 'must state LUXX will not invent the denominator'
        page.locator('#postRef').fill('post-ref')
        page.locator('#effort').fill('6')
        page.locator('#mpSent').fill('40')
        page.locator('#modal').get_by_role('button', name='MARK POSTED', exact=True).click()
        page.wait_for_timeout(1500)
        assert any(a['status'] in ('EXECUTED', 'MEASURED') for a in state['actions']), 'the action was executed'
        step('approve then mark posted with the actual treatment and a real sent_to')

        # --- RESULTS: measure, correct, revenue, custom order, export, import ---
        open_view(page, 'results'); page.wait_for_timeout(400)
        # RESULTS lists every scheduled outcome under MEASURE; TODAY only surfaces the
        # ones that are already due, so the RESULTS control is the one under test here.
        safe_click(page, lambda: page.get_by_role('button', name='MEASURE', exact=True).first)
        page.locator('#m-views').fill('100')
        page.locator('#m-gross_revenue').fill('10')
        page.locator('#modal').get_by_role('button', name='SAVE', exact=True).click(); page.wait_for_timeout(1200)
        safe_click(page, lambda: page.get_by_role('button', name='CORRECT').first)
        page.locator('#corReason').fill('correction')
        page.locator('#m-views').fill('110')
        page.locator('#modal').get_by_role('button', name='SAVE', exact=True).click(); page.wait_for_timeout(1200)
        assert len(state['measurementCorrections']) >= 1
        step('measure + correct')

        safe_click(page, lambda: page.locator('#addRevenueBtn'))
        page.locator('#rtype').select_option(label='TIP')
        page.locator('#ramount').fill('5')
        page.get_by_role('button', name='SAVE REVENUE').click(); page.wait_for_timeout(1200)
        safe_click(page, lambda: page.locator('#customOrderBtn'))
        page.locator('#camount').fill('25')
        page.locator('#cref').fill('c1')
        page.locator('#cdel').fill('deliverable')
        page.get_by_role('button', name='SAVE CUSTOM ORDER').click(); page.wait_for_timeout(1200)
        assert len(state['revenueEvents']) >= 2 and len(state['customOrders']) >= 1
        step('revenue + custom order (RC1 left both inline handlers undefined)')

        with page.expect_download(timeout=8000): safe_click(page, lambda: page.locator('#exportJsonBtn'))
        with page.expect_download(timeout=8000): safe_click(page, lambda: page.locator('#exportCsvBtn'))
        step('exports')
        imp = tmp / 'import.json'; imp.write_text('{}')
        safe_click(page, lambda: page.get_by_role('button', name='IMPORT JSON'))
        page.locator('#imp').set_input_files(str(imp))
        page.locator('#modal').get_by_role('button', name='IMPORT', exact=True).click()
        page.wait_for_timeout(700); step('import')

        # --- LIBRARY -----------------------------------------------------------
        open_view(page, 'library'); page.wait_for_timeout(400); step('library nav')
        page.locator('.filterbar input').first.fill('browser-image.png')
        page.wait_for_timeout(400)
        n = page.locator('.mediaCard').count()
        assert n == 1, 'the name filter should isolate one card, saw %d' % n
        page.locator('.filterbar input').first.fill(''); page.wait_for_timeout(400); step('filters')
        safe_click(page, lambda: page.locator('.mediaCard').filter(has_text='browser-image.png').first
                   .get_by_role('button', name='DETAILS'))
        page.get_by_role('button', name='SAVE DETAILS').click(); page.wait_for_timeout(900)
        step('asset details save')
        safe_click(page, lambda: page.locator('.mediaCard').filter(has_text='browser-image.png').first
                   .get_by_role('button', name='EDIT', exact=True))
        page.locator('#autoBestBtn').click(); page.wait_for_timeout(900)
        step('image auto best')
        safe_click(page, lambda: page.locator('#uploadBtn'))
        page.locator('#files').set_input_files(str(fixture))
        page.locator('#upAuth').select_option(label='AUTHORIZED')
        page.get_by_role('button', name='UPLOAD + ANALYZE + SAVE').click()
        page.wait_for_timeout(900); step('upload control')

        lib_tab(page, 'ROUTES')
        rt = page.locator('#view').inner_text()
        for marker in ['X_BIO_TO_OF_FREE_01', 'X_PINNED_TO_OF_FREE_01', 'X_POST_TO_OF_FREE_01',
                       'PH_PROFILE_TO_OF_FREE_01', 'PH_VIDEO_DESC_TO_OF_FREE_01',
                       'OF_FREE_POST_TO_OF_PAID_01', 'OF_PAID_PPV_MESSAGE_01', 'CB_NATIVE_TIPS_01']:
            assert marker in rt, 'route %s missing from the setup list' % marker
        assert ('UNVERIFIED' in rt) or ('VERIFIED' in rt)
        safe_click(page, lambda: page.locator('.row').filter(has_text='X_POST_TO_OF_FREE_01').first.get_by_role('button', name='SET UP / VERIFY'))
        page.locator('#ru').fill('https://track.example/x-post')
        page.locator('#rt').select_option(value='OPENED_UNIQUE_TRACKING_LINK_AND_CONFIRMED_DESTINATION')
        page.locator('#re').select_option(value='UNIQUE_TRACKING_IDENTIFIER_PRESERVED')
        page.locator('#rd').check()
        page.get_by_role('button', name='TEST & ACTIVATE ROUTE').click()
        wait_state(page, lambda: next(r for r in state['routes'] if r['route_id'] == 'X_POST_TO_OF_FREE_01')['verification_status'] == 'VERIFIED',
                   'the X post route to verify')
        assert next(r for r in state['routes'] if r['route_id'] == 'X_BIO_TO_OF_FREE_01')['verification_status'] == 'UNVERIFIED', \
            'verifying one placement must never activate another'
        step('route edit + verify keeps distinct placement IDs')

        lib_tab(page, 'BRANCH SHOOTS')
        safe_click(page, lambda: page.locator('#brandShootBtn'))
        page.locator('#sn').fill('Reference branch')
        page.locator('#sg').fill('Documented gap from the reviewed Library')
        page.locator('[data-sp="X"]').check()
        page.locator('#sr').fill('hero + teaser')
        page.get_by_role('button', name='CREATE DRAFT').click(); page.wait_for_timeout(1200)
        page.get_by_role('button', name='APPROVE').first.click(); page.wait_for_timeout(1200)
        assert len(state['brandShoots']) >= 1
        step('branch shoot draft + approve')

        lib_tab(page, 'HISTORY')
        safe_click(page, lambda: page.locator('#histImportBtn'))
        page.locator('#hiText').fill('[{"platform":"Pornhub","title":"Lake House Afternoon","url":"https://example.test/1","runtime_seconds":451,"views":2140}]')
        page.locator('#modal').get_by_role('button', name='IMPORT').click()
        page.wait_for_timeout(1500)
        assert 'Imported 1' in page.locator('#hiOut').inner_text()
        page.locator('.close').click(); page.wait_for_timeout(400)
        hist = page.locator('#view').inner_text()
        assert 'Lake House Afternoon' in hist and 'not matched' in hist, \
            'an imported record must appear and must NOT be auto-linked'
        step('historical import stores the row and never auto-links a master')

        # --- static completeness ----------------------------------------------
        defs = set(re.findall(r'(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(', html))
        refs = set(re.findall(r'on(?:click|change|input)="([A-Za-z_$][\w$]*)\s*\(', html))
        missing = sorted(refs - defs)
        assert not missing, missing
        step('all %d inline handlers resolve' % len(refs))

        browser.close()
    report['pass'] = not report['page_errors'] and not report['console_errors']
    report['visible_control_groups_passed'] = len(report['steps'])
except Exception as e:
    report['error'] = repr(e)

(ROOT / 'tests/BROWSER_TEST_RESULTS.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
if not report['pass']:
    sys.exit(1)
