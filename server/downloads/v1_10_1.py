import asyncio
import json
import re
from datetime import date
from pathlib import Path

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

CONFIG_PATH = Path("config.json")
SESSAO_PATH = Path("sessao_ml.json")
HOME_URL = "https://www.mercadolivre.com.br/"
BASE_URL = "https://www.mercadolivre.com.br/anuncios/lista/promos?page=1&search={mlb}"

MESES_PT = {
    "jan": 1, "fev": 2, "mar": 3, "abr": 4, "mai": 5, "jun": 6,
    "jul": 7, "ago": 8, "set": 9, "out": 10, "nov": 11, "dez": 12,
}


def carregar_config():
    if not CONFIG_PATH.exists():
        raise FileNotFoundError("Arquivo config.json não encontrado.")

    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config = json.load(f)

    itens = config.get("mlbs", [])
    if not isinstance(itens, list) or not itens:
        raise ValueError("Nenhum MLB informado no config.json.")

    headless = bool(config.get("headless", False))
    slow_mo = int(config.get("slow_mo", 50))
    quantidade_padrao_global = str(config.get("quantidade_padrao", 10))

    mlbs_processados = []
    for item in itens:
        if not isinstance(item, dict):
            raise ValueError("Cada item de 'mlbs' deve ser um objeto com mlb, quantidade_padrao e preco_final.")

        mlb = str(item.get("mlb", "")).strip().upper()
        if not mlb:
            raise ValueError("Há item sem campo 'mlb' no config.json.")

        quantidade_item = str(item.get("quantidade_padrao", quantidade_padrao_global))
        preco_final = item.get("preco_final")
        preco_final = None if preco_final in (None, "") else str(preco_final).strip()

        mlbs_processados.append(
            {
                "mlb": mlb,
                "quantidade_padrao": quantidade_item,
                "preco_final": preco_final,
            }
        )

    return mlbs_processados, headless, slow_mo


def log(msg: str) -> None:
    print(msg, flush=True)


URL_REDIRECIONAMENTO = "mercadolivre.com.br/anuncios/lista/promos/edicao-online"


def url_indica_redirecionamento(url: str) -> bool:
    return URL_REDIRECIONAMENTO in (url or "").lower()


def url_indica_login(url: str) -> bool:
    url = (url or "").lower()
    return any(s in url for s in ("login", "identification", "authentication", "registration", "/gz/login", "/security"))


def normalizar_preco_para_input(valor):
    if valor is None:
        return None

    txt = str(valor).strip()
    if not txt:
        return None

    txt = txt.replace("R$", "").replace(" ", "")

    if "," in txt and "." in txt:
        txt = txt.replace(".", "").replace(",", ".")
    elif "," in txt:
        txt = txt.replace(",", ".")

    try:
        numero = float(txt)
    except Exception:
        return None

    inteiro, decimal = f"{numero:.2f}".split(".")
    return f"{inteiro},{decimal}"


async def salvar_sessao_se_logado(context, page) -> bool:
    try:
        await page.goto(HOME_URL, wait_until="domcontentloaded")
        await page.wait_for_timeout(1200)
    except Exception:
        pass

    if url_indica_login(page.url):
        return False

    try:
        if await page.locator("input[name='user_id'], input[name='password'], form[action*='login']").count():
            return False
    except Exception:
        pass

    await context.storage_state(path=str(SESSAO_PATH))
    return True


async def login_manual_primeira_vez(context, page) -> None:
    log("Sessão não encontrada. Faça login no navegador e só depois pressione Enter no terminal.")
    await page.goto(HOME_URL, wait_until="domcontentloaded")

    while True:
        await asyncio.get_event_loop().run_in_executor(None, input)
        if await salvar_sessao_se_logado(context, page):
            log("Sessão salva.")
            return
        log("Login ainda não concluído. Termine o login no navegador e pressione Enter novamente.")


async def validar_sessao_existente(context, page) -> None:
    await page.goto(BASE_URL.format(mlb="mlb5780821000"), wait_until="domcontentloaded")
    await page.wait_for_timeout(1200)

    precisa_login = url_indica_login(page.url)
    if not precisa_login:
        try:
            if await page.locator("input[name='user_id'], input[name='password'], form[action*='login']").count():
                precisa_login = True
        except Exception:
            pass

    if not precisa_login:
        log("Sessão carregada.")
        return

    log("Sessão expirada. Faça login no navegador e só depois pressione Enter no terminal.")
    await page.goto(HOME_URL, wait_until="domcontentloaded")

    while True:
        await asyncio.get_event_loop().run_in_executor(None, input)
        if await salvar_sessao_se_logado(context, page):
            log("Sessão salva.")
            return
        log("Login ainda não concluído. Termine o login no navegador e pressione Enter novamente.")


async def criar_contexto(playwright, headless: bool, slow_mo: int):
    browser = await playwright.chromium.launch(headless=headless, slow_mo=slow_mo)
    context_args = {"viewport": {"width": 1400, "height": 950}}
    if SESSAO_PATH.exists():
        context_args["storage_state"] = str(SESSAO_PATH)

    context = await browser.new_context(**context_args)
    page = await context.new_page()

    if SESSAO_PATH.exists():
        await validar_sessao_existente(context, page)
    else:
        await login_manual_primeira_vez(context, page)

    await page.close()
    return context


async def click(locator) -> bool:
    for action in (
        lambda: locator.click(timeout=1200),
        lambda: locator.click(timeout=1200, force=True),
        lambda: locator.dispatch_event("click"),
        lambda: locator.evaluate("el => el.click()"),
    ):
        try:
            await locator.wait_for(state="visible", timeout=700)
        except Exception:
            pass
        try:
            await action()
            return True
        except Exception:
            pass
    return False


async def fechar_modal(page):
    modal = page.locator("[role='dialog'][aria-modal='true'], [role='dialog'].andes-modal").last
    try:
        await modal.wait_for(state="visible", timeout=800)
    except Exception:
        return

    for seletor in (
        "button:has-text('Cancelar')",
        "button:has-text('Fechar')",
        "button[aria-label='Fechar']",
        ".andes-modal__close",
    ):
        botao = modal.locator(seletor).first
        try:
            if await botao.count() and await click(botao):
                await page.wait_for_timeout(70)
                return
        except Exception:
            pass

    try:
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(70)
    except Exception:
        pass


async def expandir_promocoes(page) -> bool:
    for seletor in (
        "button.sc-list-collapsible-row__promotion-box__column__line__button:has-text('Ver mais')",
        "button:has-text('Ver mais')",
        "text='Ver mais'",
    ):
        botoes = page.locator(seletor)
        for i in range(await botoes.count()):
            botao = botoes.nth(i)
            try:
                if await botao.is_visible() and await click(botao):
                    await page.wait_for_timeout(120)
                    return True
            except Exception:
                pass
    return False


def extrair_data_card(texto: str):
    m = re.search(r"\b(\d{1,2})\s*/\s*([a-zç]{3})\b", texto.lower())
    if not m:
        return None

    dia = int(m.group(1))
    mes = MESES_PT.get(m.group(2)[:3])
    if not mes:
        return None

    hoje = date.today()
    ano = hoje.year
    try:
        dt = date(ano, mes, dia)
    except ValueError:
        return None

    if dt < hoje and mes < hoje.month:
        try:
            dt = date(ano + 1, mes, dia)
        except ValueError:
            return None
    return dt


def prioridade_data(dt):
    hoje = date.today()
    if dt is None:
        return (2, 9999)

    delta = (dt - hoje).days
    if delta > 0:
        return (0, delta)
    if delta == 0:
        return (1, 0)
    return (2, abs(delta))


async def cards_relampago_priorizados(page):
    cards = page.locator("div.sc-list-collapsible-row__promotion-box")
    encontrados = []

    for i in range(await cards.count()):
        card = cards.nth(i)
        try:
            texto = " ".join((await card.inner_text()).split())
        except Exception:
            continue

        texto_lower = texto.lower()
        if "relâmpago" not in texto_lower and "relampago" not in texto_lower:
            continue

        assinatura = texto[:300]
        encontrados.append(
            {
                "card": card,
                "assinatura": assinatura,
                "data": extrair_data_card(texto_lower),
            }
        )

    encontrados.sort(key=lambda x: (prioridade_data(x["data"]), x["assinatura"]))
    return encontrados


async def proximo_card_participar(page, ignorados: set[str]):
    for item in await cards_relampago_priorizados(page):
        card = item["card"]
        assinatura = item["assinatura"]

        if assinatura in ignorados:
            continue

        if await card.locator("button:has-text('Alterar')").count():
            ignorados.add(assinatura)
            continue

        if await card.locator("button:has-text('Deixar de participar')").count():
            ignorados.add(assinatura)
            continue

        botao = card.locator("button:has-text('Participar')").first
        if not await botao.count():
            ignorados.add(assinatura)
            continue

        return botao, assinatura, item["data"]

    return None, None, None


async def extrair_maximo_unidades(modal):
    for seletor in (
        "span.andes-helper__label:has-text('Ofereça no máximo')",
        ".andes-helper__label:has-text('Ofereça no máximo')",
        "text='Ofereça no máximo'",
    ):
        try:
            textos = await modal.locator(seletor).all_inner_texts()
        except Exception:
            continue
        for texto in textos:
            m = re.search(r"máximo\s+(\d+)\s+unidades", texto, flags=re.IGNORECASE)
            if m:
                return m.group(1)
    return None


async def preencher_campo_input(campo, valor: str) -> bool:
    try:
        await campo.click(timeout=1200)
    except Exception:
        pass

    try:
        await campo.press("Control+A")
    except Exception:
        pass

    try:
        await campo.fill(valor)
    except Exception:
        await campo.type(valor, delay=25)

    atual = await campo.input_value()
    if atual != valor:
        try:
            await campo.press("Control+A")
        except Exception:
            pass
        await campo.type(valor, delay=25)
        atual = await campo.input_value()

    return atual == valor


async def preencher_quantidade_no_modal(modal, quantidade: str):
    for seletor in (
        "div.promotion-modal__row:has-text('Quantidade de unidades') input",
        "div.promotion-modal__row-value input",
        "input.andes-textfield__input",
        "input[data-andes-textfield='true']",
        "input[type='number']",
        "input[type='text']",
    ):
        campo = modal.locator(seletor).first
        if not await campo.count():
            continue

        try:
            await campo.wait_for(state="visible", timeout=1200)

            if not await preencher_campo_input(campo, quantidade):
                continue

            await modal.page.wait_for_timeout(120)
            maximo = await extrair_maximo_unidades(modal)
            if maximo and await preencher_campo_input(campo, maximo):
                await modal.page.wait_for_timeout(120)
                return maximo

            return quantidade
        except Exception:
            continue

    return None


async def preencher_preco_final_no_modal(modal, preco_final):
    valor = normalizar_preco_para_input(preco_final)
    if not valor:
        return True

    for seletor in (
        "div.promotion-modal__row:has-text('Preço final') input",
        "div.promotion-modal__row:has-text('Preço final*') input",
        "div.promotion-modal__row-title:has-text('Preço final') + div input",
        "input[id*='andes-form-control'][value]",
    ):
        campo = modal.locator(seletor).first
        if not await campo.count():
            continue

        try:
            await campo.wait_for(state="visible", timeout=1200)
            if await preencher_campo_input(campo, valor):
                await modal.page.wait_for_timeout(100)
                return True
        except Exception:
            continue

    return False



async def detectar_erro_preco_final(modal) -> bool:
    try:
        texto_modal = (await modal.inner_text()).lower()
    except Exception:
        texto_modal = ""

    chaves_erro = (
        "preço final",
        "valor inválido",
        "valor invalido",
        "revise este valor",
        "o preço deve ser",
        "preço mínimo",
        "preço máximo",
        "preco minimo",
        "preco maximo",
        "maior que o permitido",
        "menor que o permitido",
        "fora do permitido",
        "no máximo",
        "no maximo",
        "máximo permitido",
        "maximo permitido",
    )
    if any(chave in texto_modal for chave in chaves_erro):
        return True

    # Helper de erro exatamente na área do campo de preço final.
    for seletor in (
        "div.promotion-modal__row:has-text('Preço final') .andes-form-control--error",
        "div.promotion-modal__row:has-text('Preço final*') .andes-form-control--error",
        "div.promotion-modal__row:has-text('Preço final') .andes-helper__label",
        "div.promotion-modal__row:has-text('Preço final*') .andes-helper__label",
        "div.promotion-modal__row:has-text('Preço final') [data-andes-state='error']",
        "div.promotion-modal__row:has-text('Preço final*') [data-andes-state='error']",
        "div.promotion-modal__row:has-text('Preço final') .andes-form-control__bottom-info",
        "div.promotion-modal__row:has-text('Preço final*') .andes-form-control__bottom-info",
    ):
        try:
            loc = modal.locator(seletor).first
            if await loc.count():
                texto = (await loc.inner_text()).lower()
                if texto.strip():
                    return True
        except Exception:
            pass

    return False


async def botao_confirmar_clicavel(modal):
    for seletor in (
        "button:has-text('Confirmar')",
        "button:has-text('Participar')",
        "button:has-text('Aceitar')",
        "button[type='submit']",
    ):
        botao = modal.locator(seletor).first
        if not await botao.count():
            continue
        try:
            await botao.wait_for(state="visible", timeout=1200)
            if await botao.is_enabled():
                return botao
        except Exception:
            continue
    return None


async def botao_confirmar_secundario(page):
    for seletor in (
        "button[data-testid='emon-confirm-promo-button']",
        "div.sp-action__detail button[data-testid='emon-confirm-promo-button']",
        "button.andes-button--loud:has-text('Confirmar')",
        "main button:has-text('Confirmar')",
    ):
        botao = page.locator(seletor).first
        try:
            if await botao.count():
                await botao.wait_for(state="visible", timeout=1200)
                if await botao.is_enabled():
                    return botao
        except Exception:
            continue
    return None


async def snackbar_erro_agendamento(page, timeout=1500) -> bool:
    for seletor in (
        ".andes-snackbar--negative .andes-snackbar__message:has-text('Ocorreu um erro e não foi possível agendar a sua oferta.')",
        "[data-andes-snackbar-color='negative'] .andes-snackbar__message:has-text('Ocorreu um erro e não foi possível agendar a sua oferta.')",
        "span[role='alert']:has-text('Ocorreu um erro e não foi possível agendar a sua oferta.')",
        "text='Ocorreu um erro e não foi possível agendar a sua oferta.'",
    ):
        try:
            await page.locator(seletor).first.wait_for(state="visible", timeout=timeout)
            return True
        except Exception:
            continue
    return False


async def preencher_e_confirmar(page, quantidade: str, preco_final):
    modal = page.locator("[role='dialog'][aria-modal='true'], [role='dialog'].andes-modal").last
    try:
        await modal.wait_for(state="visible", timeout=3500)
    except PlaywrightTimeout:
        botao_secundario = await botao_confirmar_secundario(page)
        if botao_secundario is None:
            return "sem_modal"

        if not await click(botao_secundario):
            return "confirmar_falhou"

        await page.wait_for_timeout(350)

        if await snackbar_erro_agendamento(page, timeout=1200):
            return "limite_or"

        return f"ok:{quantidade}"

    quantidade_final = await preencher_quantidade_no_modal(modal, quantidade)
    if quantidade_final is None:
        return "sem_campo"

    if not await preencher_preco_final_no_modal(modal, preco_final):
        return "sem_preco"

    botao = await botao_confirmar_clicavel(modal)
    if botao is None:
        # Primeiro tenta detectar explicitamente erro de preço.
        if await detectar_erro_preco_final(modal):
            return "preco_fora_do_permitido"
        # Quando há preço final configurado e o botão não habilita, na prática esse
        # fluxo costuma ser causado por preço inválido no ML.
        if preco_final:
            return "preco_fora_do_permitido"
        return "sem_estoque"

    if not await click(botao):
        return "confirmar_falhou"

    try:
        await modal.wait_for(state="hidden", timeout=2500)
    except Exception:
        await page.wait_for_timeout(350)

    if await snackbar_erro_agendamento(page, timeout=1200):
        return "limite_or"

    return f"ok:{quantidade_final}"


async def processar_mlb(page, item_config: dict):
    mlb = item_config["mlb"]
    quantidade = item_config["quantidade_padrao"]
    preco_final = item_config.get("preco_final")

    await fechar_modal(page)
    await page.goto(BASE_URL.format(mlb=mlb.lower()), wait_until="domcontentloaded", timeout=30000)
    await page.wait_for_timeout(600)

    if url_indica_login(page.url):
        raise RuntimeError("Sessão inválida ou expirada. Gere novamente o sessao_ml.json.")

    if url_indica_redirecionamento(page.url):
        log(f"{mlb}: redirecionado para página de edição online, pulando anúncio.")
        return "redirecionado"

    await expandir_promocoes(page)
    if not await cards_relampago_priorizados(page):
        log(f"{mlb}: sem Oferta Relâmpago.")
        return

    ativadas = 0
    ignorados = set()

    while True:
        await fechar_modal(page)

        if ativadas > 0:
            await expandir_promocoes(page)

        botao, assinatura, data_card = await proximo_card_participar(page, ignorados)
        if not botao:
            break

        if not await click(botao):
            ignorados.add(assinatura)
            continue

        await page.wait_for_timeout(1500)
        if url_indica_redirecionamento(page.url):
            log(f"{mlb}: redirecionado para página de edição online após clicar em Participar.")
            return "redirecionado"

        resultado = await preencher_e_confirmar(page, quantidade, preco_final)

        if resultado.startswith("ok:"):
            ativadas += 1
            ignorados.add(assinatura)
            qtd_usada = resultado.split(":", 1)[1]
            extras = f" com {qtd_usada} unidade(s)"
            if preco_final:
                extras += f" e preço final {preco_final}"
            if data_card:
                log(f"{mlb}: oferta {ativadas} ativada para {data_card.strftime('%d/%m')}{extras}.")
            else:
                log(f"{mlb}: oferta {ativadas} ativada{extras}.")
            await page.wait_for_timeout(60)
            continue

        await fechar_modal(page)

        if resultado == "sem_estoque":
            log(f"{mlb}: sem estoque, pulando anúncio.")
            break

        if resultado == "preco_fora_do_permitido":
            log(f"{mlb}: preço final acima/fora do permitido pelo Mercado Livre, pulando anúncio.")
            return "preco_fora_do_permitido"

        if resultado == "limite_or":
            log(f"{mlb}: erro ao agendar oferta, pulando anúncio.")
            break

        if resultado == "sem_preco":
            log(f"{mlb}: campo de preço final não encontrado, pulando anúncio.")
            break

        ignorados.add(assinatura)

    if ativadas:
        log(f"{mlb}: {ativadas} oferta(s) ativada(s).")
        return "ok"
    else:
        log(f"{mlb}: nenhuma oferta ativada.")
        return "nenhuma"


async def main():
    itens_config, headless, slow_mo = carregar_config()
    mlbs_preco_fora = []
    mlbs_redirecionados = []

    async with async_playwright() as playwright:
        context = await criar_contexto(playwright, headless, slow_mo)
        page = await context.new_page()

        for item in itens_config:
            try:
                resultado = await processar_mlb(page, item)
                if resultado == "preco_fora_do_permitido":
                    mlbs_preco_fora.append(item["mlb"])
                elif resultado == "redirecionado":
                    mlbs_redirecionados.append(item["mlb"])
            except Exception as e:
                log(f"{item['mlb']}: erro - {e}")
            await asyncio.sleep(1)

        await context.close()

    if mlbs_preco_fora:
        log("MLBs com preço final fora do permitido:")
        for mlb in mlbs_preco_fora:
            log(f"- {mlb}")
    else:
        log("MLBs com preço final fora do permitido: nenhum")

    if mlbs_redirecionados:
        log("MLBs redirecionados para edição online (sem participação):")
        for mlb in mlbs_redirecionados:
            log(f"- {mlb}")
    else:
        log("MLBs redirecionados para edição online: nenhum")


if __name__ == "__main__":
    asyncio.run(main())
