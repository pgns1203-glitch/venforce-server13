# Importar Nota Fiscal

Fonte: https://developers.mercadolivre.com.br/importar-nota-fiscal

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 03/08/2026

## Importar Nota Fiscal

Sellers **Pessoa Jurídica (PJ) contribuintes** podem importar as notas fiscais de venda
através de nossa API de forma automática para pedidos com as logísticas
**drop\_off** (Mercado Envios Drop Off),
**xd\_drop\_off** (Mercado Envios Places),
**xd\_same\_day** (Mercado Envios Coleta Rápida)
e **cross\_docking** (Mercado Envios Coletas). Veja como funciona
[a parte fiscal em Mercado Envios Full](https://developers.mercadolivre.com.br/pt_br/api-fiscal-faturamento-de-venda).

A importação da Nota Fiscal é o processo que **altera o status do envio**, destrancando o substatus `invoice_pending` e permitindo a geração da etiqueta de envio. Diferente do recurso de [anexar Nota Fiscal](https://developers.mercadolivre.com.br/pt_br/anexar-nota-fiscal?nocache=true) ao pacote, que apenas disponibiliza o documento ao comprador.

**Sellers PF e PJ não-contribuinte: fluxo DC-e**

Sellers **Pessoa Física (PF)** e **Pessoa Jurídica não-contribuinte** não emitem Nota Fiscal e **não utilizam este recurso de importação de NF-e**. Para esses perfis, o documento exigido é a **Declaração de Conteúdo Eletrônica (DC-e)**, que cobre envios com logística **drop\_off**, **xd\_drop\_off** e **cross\_docking**.

  

**Não é possível importar ou fazer upload de DC-e via API.** A emissão deve ser realizada pelo seller via **Seller Central** (painel do Mercado Livre) ou através da API de DC-e. O seller tem até **3 dias corridos** após a venda para emitir a DC-e; caso contrário, o pedido é cancelado automaticamente.

  

## Assinatura de notificações

**Lembre-se:** o desenvolvimento deve estar configurado para receber notificações de "shipments" (envios) através do painel MyApps. Recomendamos a leitura da nossa documentação oficial para entender o fluxo de trabalho com notificações. O recebimento dos alertas será iniciado assim que uma venda for gerada na plataforma e o pagamento devidamente confirmado.

  

**Exemplo de notificação:**

```
{
    "resource": "/shipments/139876",
    "user_id": 1234,
    "topic": "shipments",
    "received": "2011-10-19T16:38:34.425Z",
    "sent" : "2011-10-19T16:40:34.425Z",
}
```

## Status do envio do pedido

Obtenha os detalhes do envio através do shipment\_id. Confirmando que o envio tenha status "ready\_to\_ship" e substatus "invoice\_pending", você deverá enviar o XML da nota. Este substatus aplica-se às logísticas **drop\_off**, **xd\_drop\_off**, **cross\_docking** e **xd\_same\_day**.

**Chamada:**

```
curl -H "x-format-new:true" -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipments/$SHIPMENT_ID
```

O substatus `invoice_pending` ocorre quando a Nota Fiscal Eletrônica (NFe) ainda não foi importada, a Declaração de Conteúdo Eletrônica (DC-e) ainda não foi emitida, ou o Conhecimento de Transporte (CT-e) ainda não foi emitido.
Após a importação da nota (ou emissão da DC-e) e emissão do CT-e (gerado pelo Mercado Livre), o status passa a ser "ready\_to\_ship" e substatus "ready\_to\_print".

**Exemplo:**

```
{
    "date": "2025-07-07T09:45:46.000-04:00",
    "substatus": "invoice_pending",
    "status": "ready_to_ship"
},
```

## Informação fiscal da logística de envio do pedido

A partir do endpoint /shipments, é possível derivar recursos essenciais para a gestão logística de um pedido. O recurso /shipments/billing\_info, especificamente, é utilizado para consultar as informações fiscais dos diferentes atores que operam no fluxo de envio, garantindo conformidade e transparência nos detalhes do faturamento.

**Chamada:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipments/$SHIPMENT_ID/billing_info
```

**Exemplo:**

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipments/26474580996/billing_info
{
	"receiver": {
		"id": 154808171,
		"document": {
			"id": "CPF",
			"value": "02972404475"
		},
		"additional_documents": []
	},
	"senders": [{
		"id": 168777350,
		"document": {
			"id": "CNPJ",
			"value": "21611372000396"
		},
		"additional_documents": [{
			"id": "IE",
			"value": "421038162111"
		}]
	}],
	"carrier": {
		"document": {
			"id": "CNPJ",
			"value": "20121850000317"
		},
		"additional_documents": []
	}
}
```

### Considerações

- Dentro de cada "additional\_documents" pode vir uma lista de outros documentos que podem ser requeridos.
- Em cumprimento a Nota Técnica **NT2020.006**, o CNPJ que deve ser utilizado como sendo o do intermediador da transação (Mercado Livre)
  pode ser obtido através do [Mercado Livre, no rodapé da página](https://www.mercadolivre.com.br/).

## Enviar nota fiscal eletrônica

Somente é possível enviar NFe com modelo 55. Ou seja, no momento do upload do arquivo, será analisado o modelo e não poderá ser feito o envio de uma NFC-e, por exemplo.

Com todas informações disponíveis, assim que o status e substatus estiverem confirmados, você deverá enviar o XML da nota:

**Chamada:**

```
curl -s -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/xml' -d '<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
...
</nfeProc>' "https://api.mercadolibre.com/shipments/{id}/invoice_data/?siteId=$SITE_ID"
```

### Importante:

- Estamos realizando a validação dos XMLs enviados, sendo assim não serão aceitas Notas Fiscais geradas pelo ambiente de homologação da SEFAZ, somente Notas Fiscais válidas.
- Uma vez impressa a etiqueta, não será possível alterar a nota.

**NT 2025.001 — Regras para pagamentos com cartão e PIX**

A NT 2025.001 estabelece novas validações para notas fiscais eletrônicas em pedidos pagos com **cartão de crédito, débito ou PIX**. A obrigatoriedade passa a valer a partir de **01/09/2025**.

**Dados necessários para cumprir a obrigatoriedade:**

- **tpIntegra:** tipo de integração — valor fixo `1`.
- **CNPJ:** do intermediador — usar `03.007.331/0001-41` (Mercado Livre).
- **tBand:** bandeira do cartão (ex.: Visa, Master, Elo, etc.).
- **cAut:** código de autorização da transação (igual ao comprovante do cliente).

**Importante:** o grupo `<card>` é obrigatório apenas para **cartão de crédito e débito**. Para **PIX**, não é necessário enviar `cAut`, `tBand` ou `CNPJ`.

Além disso, preencha o campo **vTroco** sempre que o valor pago for maior que o valor da nota, para evitar a rejeição **869**.

  

**Parcelas com juros na NFe**

Quando um comprador optar por pagar em parcelas com juros, o Mercado Livre exibe o valor dos juros de acordo com a quantidade de parcelas escolhidas. Recomendamos incluir esse valor na sua NFe, em conformidade com a **Lei de Diferenciação de Preços (Lei n.º 13.455/17)**.

Este valor **não representa um novo custo** em suas vendas. Você pode consultar esses valores no relatório de vendas ou por meio da API utilizando o recurso /orders.

  

**Fórmula para calcular o acréscimo/juros:**

```
total_paid_amount + coupon_amount - transaction_amount - taxes_amount - shipping_cost = acréscimos
```

## Consultar a Nota Fiscal Enviada

Você pode consultar os detalhes da Nota Fiscal Enviada utilizando o recurso:

**Chamada:**

```
curl -H GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipments/$SHIPMENT_ID/invoice_data?siteId=MLB
```

**Exemplo:**

```
curl -H GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/shipments/53932058390/invoice_data?siteId=MLB
```

**Exemplo de resposta:**

```
{
    "id": 429348053945853,
    "sender_id": 4258493958,
    "shipment_id": 53932058390,
    "fiscal_key": "35250718128675438943295483011669689451",
    "weight": 81.0,
    "item_title": "Produto Teste",
    "invoice_serie": "2",
    "invoice_number": "00001",
    "invoice_amount": 100.00,
    "status": "approved",
    "invoice_date": "2025-07-07T14:04:21.000-03:00",
    "date_created": "2025-07-07T13:10:12.334-04:00",
    "last_updated": "2025-07-07T13:10:12.334-04:00"
}
```

## Atualizar nota fiscal eletrônica

Caso haja necessidade de atualizar alguma informação dos dados fiscais já enviados, você pode utilizar o recurso para enviar a nota fiscal atualizada:

**Chamada:**

```
curl -s -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/xml' -d '<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
...
</nfeProc>' "https://api.mercadolibre.com/shipment_invoice/{invoice_id}/?siteId=$SITE_ID"
```

## Referências de código de erro

| Error\_code | Mensagem de erro | Descrição | Possível solução |
| --- | --- | --- | --- |
| shipment\_invoice\_already\_saved | shipment invoice already saved | Já existe uma nota fiscal salva para o envio informado. | Para que a nota fiscal possa ser salva, o envio necessita estar no substatus de invoice\_pending, para verificar se o envio se encontra nesse substatus, consulte /shipments/{shipment\_id}, ou consulte se já não foi salva a nota fiscal para o envio informado através do endpoint /shipments/{id}/invoice\_data. |
| duplicated\_fiscal\_key | fiscal key has already been used | Já existe uma nota fiscal salva com a chave fiscal informada. | O número de chave fiscal da nota precisa ser único. |
| invalid\_nfe\_cstat | Invalid NFe cStat | A nota fiscal possui um status diferente de autorizada. | Envie uma nota fiscal que esteja autorizada pela Sefaz. |
| wrong\_invoice\_date | NFe date must be greater than the sale date. | A data informada na nota fiscal é inválida. | Verifique a data informada. |
| wrong\_sender\_zipcode | NFe sender zipcode must be the same as the sale zipcode. | O CEP do vendedor informado na nota fiscal é inválido ou nulo. | Verifique o CEP do vendedor informado. |
| wrong\_receiver\_zipcode | NFe receiver zipcode must be the same as the sale zipcode. | O CEP do comprador informado na nota fiscal é inválido ou nulo. | Verifique o CEP do comprador informado. |
| wrong\_receiver\_cnpj | NFe receiver CNPJ must be the same as the sale CNPJ. | O CNPJ do comprador informado na nota fiscal é inválido ou nulo. | Verifique o CNPJ do comprador informado. |
| wrong\_receiver\_cpf | NFe receiver CPF must be the same as the sale CPF. | O CPF do comprador informado na nota fiscal é inválido ou nulo. | Verifique o CPF do comprador informado. |
| wrong\_receiver\_state\_tax | NFe receiver state tax must be the same as the sale state tax. | A Inscrição Estadual do comprador informada na nota fiscal é inválida ou nula. | Verifique a Inscrição Estadual do comprador informada. |
| invalid\_user | You are not allowed to perform this operation on the resource Shipment $shipmentId | Você não tem permissão para realizar operações no envio informado. | Verifique o número de envio informado e se você tem permissões sobre ele. |
| seller\_not\_allowed\_to\_import\_nfe | Seller not allowed to import nfe $callerId | Você não tem permissão para realizar a importação de NF-e | Verifique se você tem permissão para importar notas fiscais ou use nosso emissor de notas fiscais. |
| shipment\_invoice\_should\_contain\_company\_state\_tax\_id | shipment invoice should contain company\_state\_tax\_id | A Inscrição Estadual do comprador não foi informada na nota fiscal. | Verifique a Inscrição Estadual do comprador informada. |
| invalid\_state\_tax\_id | Invalid state tax id | A Inscrição Estadual do comprador informada na nota fiscal é inválida ou nula. | Verifique a Inscrição Estadual do comprador informada. |
| invalid\_operation\_for\_site\_id | Invalid operation for site id: $siteId | Operação inválida para a região informada. | Só é permitida a execução de operações para o site MLB. |
| error\_parse\_invoice\_data | $json | Erro ao converter dados da nota fiscal para json. | Verifique se a nota fiscal foi informada de forma correta. |
| invalid\_parameter | Body cannot contain id | A nota fiscal informada não contém o número de identificação. | Verifique o número de identificação na nota fiscal informada. |
| invalid\_caller\_id | Invalid caller id | Caller Id informado é inválido ou não foi informado. | Verifique se o Caller Id está sendo informado ao realizar o request. |
| sender\_ie\_not\_found | Seller CNPJ not registered on SEFAZ as tax payer | O CNPJ do vendedor não está cadastrado na Sefaz como contribuinte ou está bloqueado. | Não é possível informar a NF-e porque seus dados cadastrados no Mercado Livre são diferentes dos que você tem cadastrados na SEFAZ. Revise o CNPJ, a Inscrição Estadual (IE) e o estado (UF). Corrija as informações do seu cadastro no Mercado Livre e tente novamente. |
| invalid\_sender\_ie\_for\_state | Invalid seller state registry for registered state | A inscrição estadual do vendedor é inválida para o estado cadastrado. | Não é possível informar a NF-e porque seu dado de IE cadastrado no Mercado Livre está incorreto para o estado cadastrado no endereço. Revise o CNPJ, a Inscrição Estadual (IE) e o estado (UF). Corrija as informações do seu cadastro no Mercado Livre e tente novamente. |
| invalid\_sender\_ie | Issue an NF-e with the correct State Registration (IE) because the information provided, %s, is different from the one on Mercado Livre: %s. The state (UF) of the NF-e must also be the same as the one used in your registration. | A inscrição estadual do vendedor é diferente da cadastrada junto à Sefaz. | Não é possível informar a NF-e porque seus dados cadastrados no Mercado Livre são diferentes dos que você tem cadastrados na SEFAZ. Revise a Inscrição Estadual (IE). Corrija as informações do seu cadastro no Mercado Livre e tente novamente. |
| invalid\_sender\_cnpj | Issue an NF-e with the correct CNPJ because the one entered, %s, is different from what is on Mercado Livre: %s. | O CNPJ do vendedor é diferente do cadastrado junto à Sefaz. | Não é possível informar a NF-e porque seus dados cadastrados no Mercado Livre são diferentes dos que você tem cadastrados na SEFAZ. Revise o CNPJ. Corrija as informações do seu cadastro no Mercado Livre, e tente novamente. |
| different\_state\_nfe\_shipment\_origin | Emit state from XML is different to shipment origin address state | A UF da nota é diferente do estado de origem do envio. | Não é possível informar a NF-e porque a UF do XML da nota é diferente da UF onde o envio foi gerado. Corrija as informações do XML e tente novamente. |
| nfe\_order\_value\_divergence | The NFe value does not equal the purchase value. | O valor da nota fiscal diverge do valor total dos itens do pedido. | O valor da NF-e é diferente do valor da venda. Confira os valores preenchidos como preço, descontos e frete e emita uma nova nota com o valor corrigido. |
| wrong\_invoice\_type | Invoices with ISSQN are not allowed. | Nota fiscal de serviço ou contém valor de ISSQN. | Emita uma NF-e de venda para seus produtos. Notas fiscais de serviços não são aceitas no Mercado Livre. |
| unexpected\_error\_post\_biller | The file has invalid XML. Check the XML and try again. | XML inválido ou com campos incorretos. | Envie o XML no formato aprovado pelo emissor de nota fiscal e validado pelo governo. |
| shipment\_already\_being\_processed | We're already processing a request for shipment\_id:%s. | Foi enviada mais de uma requisição ao mesmo tempo. | Aguarde o processamento da primeira requisição. |
| batch\_nfe\_not\_supported | NFe cannot have batch layout. | Não é possível informar nota fiscal com formato em lote. | Envie o XML de uma nota fiscal individual. |
| nfe\_layout\_not\_supported | NFe layout not supported. | Não é possível informar nota fiscal com esse formato. | Enviar XML de uma nota fiscal no formato aprovado pelo emissor fiscal e validado pelo governo do seu estado, seguindo a estrutura correta do XML com as tags: , , |
| nf\_already\_generated | A NF-e dessa venda já foi gerada pelo Faturador e por isso não é possível importar outra nota. | Já existe uma NFe emitida pelo faturador. | Verifique o status da NFe. Caso a NFe esteja anulada ou inutilizada, emitir novamente pelo faturador. |
| internal\_error | An internal error has occurred | Houve um erro interno | Aguarde e tente novamente. |
| invalid\_shipment | Shipment status is wrong | O shipment se encontra em um status em que a importação da NF-e não é aceita | Verifique o status do shipment antes de enviar a NF-e. |
| invalid\_nfe | NFe receiver must be to valid | Os dados do destinatário são inválidos ou não está corretamente preenchidos | Verifique os dados do destinário na NFe. Caso necessário, envie uma nova NFe para a Sefaz para carregar na API. |
| malformed\_XML | Malformed XML | O arquivo XML enviado possui algum erro de sintax ou estrutura | Revise e corrija o XML para carregar novamente na API. Utilize um validador de NFe da Sefaz caso necessário. |
| invalid\_cnpj\_multiorigem | Invoice CNPJ differs from the CNPJ registered for the sales warehouse. | O arquivo XML enviado possui o CNPJ do emitente divergente do CNPJ cadastrado para o depósito no Mercado Livre. | Reemita a nota fiscal com o CNPJ correto e faça o upload novamente no sistema. |
| invalid\_sender\_ie\_for\_state\_multiorigem\_model\_c | Invalida Sender IE for state | Emita uma NF-e com a Inscrição Estadual (IE) correta porque a informada, {IE}, é diferente da que está no Mercado Libre: {IE}. O Estado (UF) da NF-e também deve ser igual ao que usou no seu cadastro. | Emitir uma nota com a Inscrição Estadual igual a que está cadastrada no Mercado Livre. |
| invalid\_nfe\_cstat\_multiorigem\_model\_c | Invalid or unauthorized shipping key | A nota fiscal de remessa informada é inválida ou não está autorizada. | A nota fiscal de remessa referenciada na NF-e de venda deve estar autorizada pela Sefaz. |

Conteúdos
