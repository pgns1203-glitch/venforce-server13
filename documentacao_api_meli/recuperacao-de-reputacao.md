# Programa Decola e Benefício de Reputação

Fonte: https://developers.mercadolivre.com.br/recuperacao-de-reputacao

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 04/02/2025

## Programa Decola e Benefício de Reputação

Importante:

Disponível na Argentina (MLA), Brasil (MLB), México (MLM), Chile (MLC) e Colômbia (MCO) para vendedores sem reputação ou com reputação vermelha, amarela ou laranja.

Esta iniciativa permite que os vendedores sem reputação ou com reputação vermelha, laranja ou amarela tenham uma oportunidade por um período de tempo em que seu nível permanecerá congelado em verde, de acordo com regras estabelecidas, para aumentar sua exposição e vendas. O vendedor poderá deixar uma quantia de dinheiro como garantia, e com base na quantidade de problemas (reclamações, cancelamentos, atrasos) gerados, receberá de volta parte ou a totalidade do dinheiro.

- **Programa decola** (NEWBIE\_GRNTEE): para vendedores sem reputação (level\_id: null). Além disso, têm acesso a benefícios do Mercado Livre Ads, Clips e maior chance de ganho no Catálogo. Termos e Condições: [Argentina (MLA)](https://www.mercadolibre.com.ar/ayuda/terminos-y-condiciones-programa-despegue_33285), [Brasil (MLB)](https://www.mercadolivre.com.br/ajuda/termos-e-condi%C3%A7%C3%B5es-programa-decola_33285), [México (MLM)](https://www.mercadolibre.com.mx/ayuda/terminos-y-condiciones-programa-despegue_33285), [Chile (MLC)](https://www.mercadolibre.cl/ayuda/terminos-y-condiciones-programa-despegue_33285) e [Colômbia (MCO)](https://www.mercadolibre.com.co/ayuda/33285).
- **Benefício de Reputação** (RECOVERY\_GRNTEE): aplica-se a vendedores com reputação vermelha, laranja ou amarela (leve\_id: 1\_red, 2\_orange ou 3\_yellow). Termos e Condições: [Argentina (MLA)](https://www.mercadolibre.com.ar/ayuda/terminos-y-condiciones-beneficio-de-reputacion_29528), [Brasil (MLB)](https://www.mercadolivre.com.br/ajuda/termos-e-condicoes-reputacao-vantagens_29528), [México (MLM)](https://www.mercadolibre.com.mx/ayuda/terminos-y-condiciones-beneficio-de-reputacion_29528), [Chile (MLC)](https://www.mercadolibre.cl/ayuda/terminos-y-condiciones-beneficio-de-reputacion_29528) e [Colômbia (MCO)](https://www.mercadolibre.com.co/ayuda/terminos-y-condiciones-beneficio-de-reputacion_29528).

## Fluxo técnico

![](https://http2.mlstatic.com/storage/developers-site-cms-admin/168413181259-Despegue-Recovery-MLB.png)  

## Notificações

Atualmente, os vendedores são notificados por e-mail, notificações e novidades no Mercado Livre.
Utilize a [api de novidades](/pt_br/conheca-as-novidades-que-recebem-os-vendedores#Obter-novidades) (**/communications/notices**) para que os vendedores sejam avisados via sua integração assim que forem convidados a participar. Em breve, habilitaremos um novo tópico de notificações.

  

## Consultar reputação

Primeiro, recomendamos [consultar a reputação do vendedor](/pt_br/reputacao-dos-vendedores?nocache=true) para garantir que ele se enquadra em algum programa. Se o vendedor possui reputação sem cor, vermelha, laranja ou amarela, utilize os seguintes endpoints.   
Vendedores com reputação verde (id: 4\_light\_green ou 5\_green) estão excluídos de participar.

Chamada:

```
curl -X GET -H 'Authorization: Bearer Token' https://api.mercadolivre.com/users/$USER_ID
```

Resposta:

```
{
  "id": 123456,
  ...
  "seller_reputation": {
      "level_id": null,
      "power_seller_status": null,
      "transactions": {
          ...
          },
          "total": 8
      }
  ...
}
```

Nota:

É possível que um usuário atenda aos requisitos do nível de reputação, mas não tenha sido convidado a participar da proteção devido a regras internas de segurança.

## Conhecer detalhes do Programa

O vendedor habilitado para participar de um programa pode obter informações detalhadas sobre a proteção, garantia, limites e dinheiro disponível no Mercado Ads.

Nota:

O limite de taxa é 100 RPM por vendedor (user\_id).

Chamada:

```
curl -X GET -H 'Authorization: Bearer Token' 
https://api.mercadolibre.com/users/reputation/seller_recovery/status
```

Resposta:

```
{
    "seller_id": 1234567,
    "current_level": "newbie",
    "status": "AVAILABLE",
    "type": "NEWBIE_GRNTEE",
    "site_id": "MLA",
    "protection_limits": {
        "max_issues_allowed": 5,
        "protection_days_limit": 365
    },
    "guarantee_limits": {
        "guarantee_price": "$45.000",
        "advertising_amount": 45000
    },
    "guarantee_detail": {
        "guarantee_status": "OFF"
    },
    "is_renewal": false
}
```

### Campos da resposta

**seller\_id**: ID do vendedor.

**status**: Estado atual da proteção. Valores possíveis:

- **AVAILABLE**: proteção habilitada.
- **ACTIVE**: proteção ativada.
- **UNAVAILABLE**: proteção não disponível.
- **FINISHED\_BY\_DATE**: proteção finalizada por data.
- **FINISHED\_BY\_ISSUES**: proteção finalizada por problemas.
- **FINISHED\_BY\_LEVEL**: proteção finalizada por cor recuperada.
- **FINISHED\_BY\_USER**: proteção cancelada pelo vendedor.
- **FINISHED**: proteção finalizada por várias razões.

**type**: tipo de proteção: Programa de Decola (NEWBIE\_GRNTEE) ou Benefício de Reputação (RECOVERY\_GRNTEE).  
**site\_id**: país.

**protection\_limits**: limites de proteção.

- **max\_issues\_allowed**: quantidade máxima de problemas permitidos.
- **protection\_days\_limit**: duração (dias) da proteção.

**guarantee\_limits**: limites de garantia.

- **guarantee\_price**: valor da garantia.
- **advertising\_amount**: valor do bônus no Mercado Ads. Aplica-se somente ao programa Decola (NEWBIE\_GRNTEE).

**protection\_detail**: detalhes sobre a proteção atual.

- **warning**: alerta sobre a finalização da proteção.
- **reactivated**: indica se a proteção foi reativada.
- **init\_date**: data de início da proteção.
- **end\_date**: data de finalização da proteção.
- **protection\_days**: dias de proteção válidos.
- **start\_level**: cor do vendedor ao iniciar a proteção.
- **end\_level**: cor do vendedor ao terminar a proteção.

**sales\_detail**: detalhes das vendas durante a proteção.

- **orders\_qty**: quantidade de ordens vendidas.
- **total\_issues**: problemas do vendedor.
- **claims\_qty**: quantidade de reclamações.
- **cancel\_qty**: quantidade de cancelamentos.
- **delay\_qty**: quantidade de envios atrasados.

**guarantee\_detail**: detalhes sobre a garantia.

- **guarantee\_status**: estado da garantia.
- **guarantee\_end\_date**: data de finalização da garantia.
- **guarantee\_buffer**: duração do buffer para avaliar a garantia.
- **guarantee\_release\_amount**: valor da reserva de garantia.
- **guarantee\_charge\_amount**: valor da cobrança de garantia.

  

## Ativar programa

Antes de ativar o programa, o vendedor deve depositar o valor informado anteriormente em sua conta do Mercado Pago ou reservar esse valor caso já tenha dinheiro na conta. Caso você não tenha o dinheiro disponível, você receberá um erro ao ativar o programa. Assim que o vendedor ativa o programa (opt-in), o período de proteção começa.

Chamada:

```
curl -X POST -H 'Authorization: Bearer Token' -H 'Content-Type: application/json'
https://api.mercadolibre.com/users/reputation/seller_recovery/activate
```

Resposta:

```
{
  "message": "ok"
}
```

## Desativar Programa

Em qualquer momento, o vendedor poderá solicitar seu cancelamento e enviar o seguinte parâmetro obrigatório: **cancellation\_reason**: motivo do cancelamento do programa (obrigatório para o Programa Startup, não é necessário para o Benefício de Reputação). Valores possíveis:

- **business\_not\_ready**: meu negócio não está pronto.
- **program\_not\_useful**: o programa não foi útil.
- **need\_money**: preciso do dinheiro.
- **goal\_achieved**: já atingi meu objetivo.
- **without\_reason**: sem razão.

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer Token' -H 'Content-Type: application/json'-D 
{
    "cancellation_reason" : "goal_achieved"
}
https://api.mercadolibre.com/users/reputation/seller_recovery/cancel_guarantee
```

Resposta:

```
{
   "message": "ok"
}
```

## Baixar Domiciliação Legal

Importante:

Aplica obrigatoriamente para o México e a Colômbia.

Integradores com usuários (vendedores) do México e da Colômbia são legalmente obrigados a mostrar aos vendedores desses países a opção de baixar a domiciliamento legal, podendo ser uma versão preliminar ou completa.

  

### Parâmetro obrigatório

**type**: é o tipo de domiciliamento legal que você pode baixar. Valores possíveis:

- **preview**: só é possível chamar no modo de visualização se a proteção estiver no estado AVAILABLE e a garantia estiver no estado OFF.
- **complete**: uma vez que o vendedor tenha ativado a proteção do programa (seja Decola ou Benefício de Reputação), pode baixar o documento completo. Só é possível se a proteção estiver no estado ACTIVE ou FINISHED\_BY\_\*.

Chamada:

```
curl -X GET -H 'Authorization: Bearer Token' 
https://api.mercadolibre.com/users/reputation/seller_recovery/legal-document?type=(PREVIEW|COMPLETE)
```

Resposta:

```
{
    "document": "JVBERi0xLjQKJfbk/N8KMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovVmVyc2lvbiAvMS41Ci9QYWdlcyAyIDAgUgovTmFtZXMgMyAwIFIKPj4KZW5kb2JqCjQgMCBvYmoKPDwKL01vZERhdGUgKEQ6MjAyNDA5MTkxN"
}
```

Por segurança, a resposta será um tipo de dados codificado em base64, que você pode decodificar usando um script python e obter o pdf.  
Exemplo:

```
import base64

# The base64 string you provided
base64_data = ""  

# Add the proper padding if necessary
base64_data = base64_data.rstrip('=')  # Remove any previous padding, if there is any
padding_needed = len(base64_data) % 4
if padding_needed:
    base64_data += '=' * (4 - padding_needed)

# Decode the base64 string
pdf_data = base64.b64decode(base64_data)

# Save the binary data as a PDF file
with open('output.pdf', 'wb') as pdf_file:
    pdf_file.write(pdf_data)

print("PDF saved as output.pdf")
```

Para **ativar esses programas em usuários de teste**, envie-nos 2 usuários de teste com reputação nula (sem cor) via Suporte e ativaremos um programa em cada um deles.

  

**Siguiente**: [Reputación de vendedores](/es_ar/reputacion-de-vendedores?nocache=true).

Conteúdos
