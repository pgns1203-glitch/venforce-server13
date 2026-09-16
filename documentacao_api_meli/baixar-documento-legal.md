# Download de documento Legal

Fonte: https://developers.mercadolivre.com.br/baixar-documento-legal

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 25/04/2024

## Download de documento Legal

Compartilhamos um passo a passo para baixar as faturas legais do Mercado Livre e do Mercado Pago no formato PDF. Você deve obter o file\_id consultando o endpoint de /documents. Em alguns casos, você pode receber dois file\_id. Apenas nestes casos, é importante observar que você deve usar o file\_id correspondente ao PDF.  
 Se o endpoint devolver apenas um file\_id, então você deve usar esse dado para baixar o documento legal.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/billing/integration/legal_document/$FILE_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/billing/integration/legal_document/1234_FE_MEPF00869625_pdf
```

  

Resposta:  **download do arquivo em formato PDF**.

  
  

## Download do relatório de conciliação

Para fazer o download dos relatórios de conciliação do **Mercado Livre**, **Mercado Envios Flex**, **Insurtech** e **Mercado Pago** nos formatos **XLSX** e **CSV** você deve seguir um processo de gerar o relatório. Esse mesmo processo servirá para o relatório de **Fulfillment e para o relatório de pagamentos**, que admitem apenas o formato de download **XLSX**.  
O processo de gerar o relatório consiste en três passos:

  

### 1. Criação do relatório

Através deste endpoint irá realizar a criação do relatório.

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d {...} 
https://api.mercadolibre.com/billing/integration/periods/key/$KEY/reports
```

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN'
  -d '{
     "group": "ML",
     "document_type": "BILL",
     "report_format": "CSV"
  }' 
  https://api.mercadolibre.com/billing/integration/periods/key/2021-08-01/reports
```

O valor do parâmetro group varia segundo o relatório que queira gerar:

- ML para relatório de ML
- MP para relatório de MP
- FLEX para relatório de Flex
- FULL para relatório de Fulfillment
- INSURTECH para relatório de Insurtech
- PAYMENT para relatório de pagamentos

  

Resposta:

```
{
  "fileId": "ML-report-BILL-2021-08-04-11119999-CSV-v2"
  }
```

### 2. Estado de criação de relatório

Permitirá obter o estado de criação de um relatório.Os estados podem ser:

- PROCESSING: o relatório está sendo gerado.
- READY: o relatório terminou de ser criado.
- ERROR: a criação do relatório falhou, deverá ser consultado novamente.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/billing/integration/reports/$FILE_ID/status
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' 
https://api.mercadolibre.com/billing/integration/reports/ML-report-BILL-2021-08-04-11119999-CSV-v2/status?document_type=BILL
```

Resposta:

```
{
"status": "PROCESSING"
}
```

### 3. Download do relatório

Com este endpoint poderá realizar o download do relatório. Este download poderá ser feito uma vez que o estado da criação seja **Ready**.

  

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/billing/integration/reports/$FILE_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN'
https://api.mercadolibre.com/billing/integration/reports/ML-report-BILL-2021-08-04-11119999-CSV-v2?document_type=BILL
```

**Seguinte**: [Percepções](/pt_br/percepcoes).

Conteúdos
