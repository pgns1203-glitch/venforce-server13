from pathlib import Path
from playwright.sync_api import sync_playwright

URL = "https://www.mercadolivre.com.br/anuncios/lista/promos/campanhas/crio/relampago#origin=central-marketing&card=my_page_light"
SESSION_FILE = "sessao_ml.json"


def log(msg: str) -> None:
    print(msg, flush=True)


def goto_start(page) -> None:
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_load_state("networkidle")


def ensure_session(context, page, session: Path) -> None:
    if session.exists():
        log("Sessão carregada.")
        return

    page.goto("https://www.mercadolivre.com.br/", wait_until="domcontentloaded")
    input("Faça login e pressione Enter...")
    context.storage_state(path=str(session))
    log("Sessão salva.")


def open_datepicker(page) -> None:
    btn = page.locator(
        "button.andes-datepicker__trigger[aria-haspopup='dialog'], "
        "button[data-andes-datepicker-trigger-field='true']"
    ).first
    btn.wait_for(state="visible", timeout=10000)
    btn.click()
    page.locator("td[data-andes-datepicker-day='true']").first.wait_for(state="visible", timeout=10000)
    page.wait_for_timeout(300)


def close_datepicker(page) -> None:
    try:
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
    except Exception:
        pass


def get_days(page):
    cells = page.locator("td[data-andes-datepicker-day='true']")
    days = []

    for i in range(cells.count()):
        cell = cells.nth(i)
        if (cell.get_attribute("data-disabled") or "").lower() == "true":
            continue

        btn = cell.locator("button").first
        if btn.count() == 0:
            continue

        try:
            text = (btn.inner_text() or "").strip()
        except Exception:
            continue

        if not text.isdigit():
            continue

        days.append(
            {
                "button": btn,
                "text": text,
                "selected": (cell.get_attribute("data-selected") or "").lower() == "true",
            }
        )

    return days


def select_day_by_index(page, day_index: int):
    open_datepicker(page)
    days = get_days(page)

    if day_index >= len(days):
        close_datepicker(page)
        return None

    day = days[day_index]

    if not day["selected"]:
        try:
            day["button"].click(timeout=3000)
        except Exception:
            day["button"].click(force=True)
        page.wait_for_timeout(500)

    close_datepicker(page)
    return day["text"]


def select_day_by_label(page, day_label: str) -> bool:
    open_datepicker(page)
    days = get_days(page)

    for day in days:
        if day["text"] != day_label:
            continue

        if not day["selected"]:
            try:
                day["button"].click(timeout=3000)
            except Exception:
                day["button"].click(force=True)
            page.wait_for_timeout(500)

        close_datepicker(page)
        return True

    close_datepicker(page)
    return False


def click_create_offer(page) -> None:
    btn = page.locator(
        "button:has-text('Criar oferta'), "
        "button.andes-button--loud:has-text('Criar oferta')"
    ).first
    btn.wait_for(state="visible", timeout=10000)
    try:
        btn.click(timeout=3000)
    except Exception:
        btn.click(force=True)


def has_no_schedule_error(page, timeout=2000) -> bool:
    selectors = [
        "#schedule-period-dropdown-helper[data-andes-state='error']",
        "span.andes-helper__label:has-text('Selecione uma opção')",
    ]
    for selector in selectors:
        try:
            page.locator(selector).first.wait_for(state="visible", timeout=timeout)
            return True
        except Exception:
            continue
    return False


def wait_offer_result(page, timeout=12000) -> str:
    try:
        page.wait_for_url(lambda url: not url.startswith(URL), timeout=timeout)
        return "redirect"
    except Exception:
        pass

    if has_no_schedule_error(page, timeout=1200):
        return "no_schedule"

    try:
        page.locator("button:has-text('Criar oferta')").first.wait_for(state="visible", timeout=1500)
        return "same_page"
    except Exception:
        return "unknown"


def process_day(page, day_index: int):
    goto_start(page)
    day_label = select_day_by_index(page, day_index)
    if day_label is None:
        return "no_more_days", None, 0

    log(f"Processando dia {day_label}")

    created_count = 0
    consecutive_unknowns = 0

    while True:
        goto_start(page)

        if not select_day_by_label(page, day_label):
            if created_count == 0:
                log(f"Dia {day_label}: sem horário disponível.")
            else:
                log(f"Dia {day_label}: {created_count} oferta(s) criada(s).")
            return "finished_day", day_label, created_count

        click_create_offer(page)
        result = wait_offer_result(page)

        if result == "redirect":
            created_count += 1
            consecutive_unknowns = 0
            log(f"Dia {day_label}: oferta {created_count} criada.")
            continue

        if result == "no_schedule":
            if created_count == 0:
                log(f"Dia {day_label}: sem horário disponível.")
            else:
                log(f"Dia {day_label}: {created_count} oferta(s) criada(s).")
            return "finished_day", day_label, created_count

        # Em vez de encerrar com "não foi possível concluir",
        # reprocessa o mesmo dia algumas vezes.
        consecutive_unknowns += 1

        if consecutive_unknowns <= 4:
            page.wait_for_timeout(2000)
            continue

        if created_count == 0:
            log(f"Dia {day_label}: sem horário disponível.")
        else:
            log(f"Dia {day_label}: {created_count} oferta(s) criada(s).")

        return "finished_day", day_label, created_count


def run() -> None:
    session = Path(SESSION_FILE)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(storage_state=str(session) if session.exists() else None)
        page = context.new_page()

        ensure_session(context, page, session)

        day_index = 0
        while True:
            status, _, _ = process_day(page, day_index)
            if status == "no_more_days":
                log("Nenhum próximo dia disponível.")
                break
            day_index += 1

        context.storage_state(path=str(session))
        browser.close()


if __name__ == "__main__":
    run()
