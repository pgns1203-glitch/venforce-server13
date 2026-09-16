# Integração DCe

Fonte: https://developers.mercadolivre.com.br/integracao-dce

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 08/06/2026

## Integração DCe

A Declaração de Conteúdo Eletrônica (DC-e) é o documento fiscal obrigatório para sellers **Pessoa Física (PF)** e **Pessoa Jurídica não-contribuinte** no Brasil — perfis que não emitem Nota Fiscal. Com a migração em waves a partir de **18/06/2026**, esses sellers passam a poder operar também em **Coletas (cross\_docking)** e **Places (xd\_drop\_off)**, além do **drop\_off**.

O envio fica retido no substatus `invoice_pending` até que a DC-e seja emitida. O seller tem **3 dias corridos** a partir da venda para emitir a DC-e — após esse prazo, o pedido é cancelado automaticamente.

A integração DC-e disponibiliza três endpoints: um para **iniciar a emissão** de uma DC-e vinculada a um pedido, outro para **consultar o status e os documentos fiscais** gerados, e um terceiro para **fazer o download** dos documentos emitidos.

Importante:

Estes endpoints estão disponíveis exclusivamente para o site **MLB (Brasil)**.

### DC-e aplica para:

- Sellers **Pessoa Física (PF)**
- Sellers **PJ não-contribuintes**
- Envios com logística **drop\_off**, **xd\_drop\_off** e **cross\_docking**

### DC-e NÃO aplica para:

- Sellers **PJ contribuintes** → seguem emitindo NF-e via `/shipments/{shipment_id}/invoice_data?siteId=MLB`
- Outros sites — endpoints disponíveis apenas para MLB

## Emitir DCe

A emissão de uma DC-e pode ser feita pelo seller diretamente via **Seller Central** (painel do Mercado Livre) ou de forma integrada através da API. Para iniciar a emissão via API, utilize a seguinte chamada:

  

### Parameters

- **order\_id** (required, string): Identificador do pedido. Deve conter apenas dígitos.

Chamada:

```
curl -X POST \
    'https://api.mercadolibre.com/mlb/order/$ORDER_ID/dce/emission' \
    -H 'Authorization: Bearer $ACCESS_TOKEN'
```

Exemplo:

```
curl -X POST \
    'https://api.mercadolibre.com/mlb/order/2000000483899592/dce/emission' \
    -H 'Authorization: Bearer $ACCESS_TOKEN'
```

Resposta:

```
{
    "id": "94e95c5fc1356f8e4c2bf779dce40000"
}
```

### Campos da Resposta

- **id** (string): ID da cobertura fiscal criada.

### Status do Response

| HTTP Code | Descrição |
| --- | --- |
| 200 | Emissão iniciada com sucesso. |
| 400 | Parâmetro **order\_id** ausente ou inválido. |
| 401 | Token de autorização inválido ou ausente. |
| 404 | Pedido não encontrado. O **order\_id** deve conter apenas dígitos. |
| 5xx | Erro inesperado no processamento fiscal. |

## Status dos DCes da Cobertura

Para consultar o status e os documentos fiscais de DCe associados a um pedido, utilize a seguinte chamada:

  

### Parameters

- **order\_id** (required, string): Identificador do pedido. Deve conter apenas dígitos.

Chamada:

```
curl -X GET \
    'https://api.mercadolibre.com/mlb/order/$ORDER_ID/dce/info' \
    -H 'Authorization: Bearer $ACCESS_TOKEN'
```

Exemplo:

```
curl -X GET \
    'https://api.mercadolibre.com/mlb/order/2000000483899592/dce/info' \
    -H 'Authorization: Bearer $ACCESS_TOKEN'
```

Resposta:

```
{
    "status": "completed",
    "sub_status": "issued",
    "documents": [
        {
            "dce_key": "doc-789",
            "document_type": "NFe",
            "status": "issued",
            "files": [
                {
                    "location": "https://...",
                    "format": "pdf"
                }
            ],
            "error": {
                "code": "",
                "message": ""
            }
        }
    ]
}
```

### Campos da Resposta

- **status** (string): Status geral da cobertura fiscal. Valores possíveis:
  - **pending**: emissão em processamento.
  - **completed**: emissão concluída.
  - **error**: ocorreu um erro durante o processamento.
- **sub\_status** (string): Substatus detalhado da cobertura fiscal. Exemplo: **issued**.
- **documents** (array): Lista de documentos fiscais vinculados ao pedido.

- **dce\_key** (string): Chave de acesso do documento DCe.
- **document\_type** (string): Tipo do documento fiscal. Exemplo: **NFe**.
- **status** (string): Status do documento individual. Valores possíveis: **authorized**, **rejected**, **issued**.
- **files** (array): Arquivos do documento fiscal disponíveis para download.

- **location** (string): URL de acesso ao arquivo do documento fiscal.
- **format** (string): Formato do arquivo. Exemplo: **pdf**.

- **error** (object): Informações de erro do documento. Presente mesmo quando não há erro.

- **code** (string): Código do erro fiscal, se houver.
- **message** (string): Descrição do erro, se houver.

Nota:

A URL retornada em **documents[].files[].location** é um link de acesso direto ao arquivo. Para realizar o download estruturado pelo formato desejado (pdf, xml ou json), utilize o endpoint descrito no **Download de Documento DCe**.

### Status do Response

| HTTP Code | Descrição |
| --- | --- |
| 200 | Informações do DCe retornadas com sucesso. |
| 400 | Parâmetro **order\_id** ausente ou inválido. |
| 401 | Token de autorização inválido ou ausente. |
| 404 | Pedido não encontrado. O **order\_id** deve conter apenas dígitos. |
| 5xx | Erro inesperado no processamento fiscal. |

## Download de Documento DCe

Para fazer o download de um documento fiscal de DCe associado a um pedido, utilize a seguinte chamada. O endpoint retorna o conteúdo do arquivo do documento fiscal diretamente no corpo da resposta, com os headers indicando o tipo e o nome do arquivo.

  

### Parameters

- **order\_id** (path, required, string): Identificador do pedido. Deve conter apenas dígitos.
- **dce\_id** (path, required, string): Chave de acesso (**dce\_key**) do documento DCe obtida na consulta de status.

### Query parameters

- **doctype** (required, string): Formato do arquivo a ser baixado. Valores possíveis: **pdf**, **xml**, **json**.

Chamada:

```
curl -X GET \
    'https://api.mercadolibre.com/mlb/order/$ORDER_ID/dce/info/$DCE_ID?doctype=$FORMAT' \
    -H 'Authorization: Bearer $ACCESS_TOKEN'
```

Exemplo:

```
curl -X GET \
    'https://api.mercadolibre.com/mlb/order/2000000987654321/dce/info/doc-789?doctype=pdf' \
    -H 'Authorization: Bearer $ACCESS_TOKEN'
```

Resposta (headers):

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="doc-789.pdf"
```

### Formatos suportados

| Valor | Content-Type | Descrição |
| --- | --- | --- |
| **pdf** | application/pdf | Representação visual do documento fiscal (DANFE). |
| **xml** | application/xml | XML autorizado do documento fiscal. |
| **json** | application/json | Representação estruturada do documento fiscal em JSON. |

  

### Headers da Resposta

- **Content-Type**: Tipo MIME do arquivo retornado, conforme o **doctype** solicitado (**application/pdf**, **application/xml** ou **application/json**).
- **Content-Disposition**: Indica o nome sugerido do arquivo no formato **attachment; filename="{dce\_id}.{format}"**.

  

### Status do Response

| HTTP Code | Descrição |
| --- | --- |
| 200 | Documento retornado com sucesso no corpo da resposta (conteúdo binário). |
| 400 | Parâmetros ausentes ou inválidos (**order\_id**, **dce\_id** ou **doctype**). |
| 401 | Token de autorização inválido ou ausente. |
| 404 | Pedido ou documento não encontrado. |
| 5xx | Erro inesperado ao recuperar o documento fiscal. |

## Considerações

- **Identificar o perfil do seller** (PF, PJ não-contribuinte ou PJ contribuinte) para decidir entre o fluxo DC-e ou o fluxo NF-e.
- **Monitorar o substatus invoice\_pending** nos envios para disparar a emissão da DC-e automaticamente logo após a venda.
- **Realizar o POST em /dce/emission** assim que o pedido for gerado; armazenar o id da cobertura fiscal retornado para rastreio.
- **Consultar e baixar PDF e XML** via `/dce/info/{DCE_ID}?doctype=…` para uso no ERP do seller. O gerenciamento dos arquivos é responsabilidade do integrador — não há upload de DC-e via API.
- **Implementar alerta de prazo:** se a DC-e não for emitida em até **3 dias corridos** após a venda, o pedido é cancelado automaticamente. Exiba esse aviso ao seller.
- **Continuar suportando** `/shipments/{shipment_id}/invoice_data?siteId=MLB` para sellers PJ contribuintes — o fluxo NF-e não muda.
- A DC-e aplica **apenas** a sellers PF e PJ não-contribuintes. Sellers PJ contribuintes seguem o fluxo NF-e normal.
- Os endpoints DC-e estão disponíveis **somente para o site MLB**. Outros sites não são impactados.
- A migração para XD/XDDO ocorre em **waves progressivas** a partir de 18/06/2026 — não assumir que todos os sellers PF/PJ não-contribuinte estarão habilitados ao mesmo tempo.
- Pedidos sem DC-e emitida em até **3 dias corridos** são cancelados automaticamente — comunique esse prazo ao seller.
- **Não é possível importar ou fazer upload de DC-e via API.** A emissão deve ser iniciada pelo endpoint `/dce/emission` ou via Seller Central.

Conteúdos
