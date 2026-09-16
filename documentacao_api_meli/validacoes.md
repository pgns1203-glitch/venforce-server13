# Validações

Fonte: https://developers.mercadolivre.com.br/validacoes

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 29/12/2025

## Validações

Nosso objetivo é aumentar a qualidade das publicações de nossos vendedores. Por este motivo disponibilizamos um fluxo que valida consistências dentro da publicação antes de sua criação e em certas ocasiões, solicita ações de correção por parte do vendedor, para cumprir os requisitos esperados.  
Exemplo de resposta com validações após executar a chamada para a [criação de uma publicação](https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos#Publicacao-de-um-anuncio):

  
  

```
{
   "message": "Validation error",
   "error": "validation_error",
   "status": 400,
   "cause": [
       {
           "department": "structured-data",
           "cause_id": 2511,
           "type": "warning",
           "code": "create.item.attribute.business_conditional",
           "references": [
               "item.attributes"
           ],
           "message": "Attribute [AGE_GROUP] to be added with values [(6725189,null)]"
       },
       {
           "department": "moderations",
           "cause_id": 3250,
           "type": "error",
           "code": "moderations.seller.not_authorized",
           "references": [
               "item.seller_id",
               "item.category_id",
               "item.attributes[0]"
           ],
           "message": "Seller is not authorized for this brand and category"
       },
       {
           "department": "structured-data",
           "cause_id": 1212,
           "type": "warning",
           "code": "normalize.item.attribute.values",
           "references": [
               "item.variations[0].attribute_combinations[1].values"
           ],
           "message": "Attribute [SIZE] to be modified - values [(null,32.5 BR)] should be [(11375386,32.5 BR)] - Normalized form: [migration]"
       },
       {
           "department": "shipping",
           "cause_id": 4029,
           "type": "warning",
           "code": "shipping.me2_adoption_mandatory",
           "references": [
               "shipping.modes",
               "user.shipping_preferences.option"
           ],
           "message": "ME2 adoption is mandatory for the user"
       }
```

### Descrição dos campos

- **message**: mensagem que indica que foi gerada pela validação de qualidade.
- **error**: código de erro.
- **status**: código http para identificar erro.
- **cause**: array que contém o detalhe das validações executadas e que possivelmente requer uma ação do vendedor para solucioná-las.

- **department**: nome da área do Mercado Livre owner da validação.
- **cause\_id**: ID da validação.
- **type**: tipo de validação com dois possíveis valores warning (validação não bloqueante para a execução da chamada, informativa) ou erro (validação bloqueante para a execução da chamada que requer uma ação do vendedor que modifique o JSON).
- **code**: código da validação.
- **references**: referências aos atributos do JSON que causaram a validação.
- **message**: mensagem que detalha a validação causada.

## Detalhe

A seguir, você irá encontrar o detalhe das validações que ajudam a melhorar a qualidade das publicações, onde as quatro primeiras colunas referem-se aos campos **cause\_id**, **type**, **code** e **message** da resposta, respectivamente:

| Id | Tipo | Código de validação | Mensagem | Descrição | Possível solução |
| --- | --- | --- | --- | --- | --- |
|
|  |
| 101 | error | body.invalid\_field\_types | linvalid property type: [$FIELD\_ID] expected URL-Friendly String but was String value: $VALUE. | O campo $FIELD\_ID tem valores inválidos $VALUE. | Para os valores disponíveis dos campos, consulte /categories/$CATEGORY\_ID/$TYPE\_ID. |
| 109 | error | item.price.invalid | The category $CATEGORY\_ID requires a minimum price of $VALUE. | O preço está abaixo do permitido para esta categoria. | Consulte o campo minimum\_price em /categories/$CATEGORY\_ID. |
| 126 | error | item.category\_id.invalid | Is not allowed to post in category $CATEGORY\_ID. Make sure you're posting in a leaf category". | "listing\_allowed": false não permite publicar nesta categoria. | Consulte o campo listing\_allowed em /categories/$CATEGORY\_ID. |
| 129 | error | item.price.invalid | Price must be less than 9999999999. | O preço supera o máximo permitido. | Corrigir o campo price com um valor válido. |
| 147 | error | item.attributes.missing\_required | The attributes [$ATTRIBUTE\_ID] are required for category $CATEGORY\_ID and channel marketplace. Check the attribute is present in the attributes list or in all variation's attributes\_combination or attributes. | O atributo $ATTRIBUTE\_ID é obrigatário para esta categoria $CATEGORY\_ID. | Para ver os atributos obrigatórios na categoria, consulte /categories/$CATEGORY\_ID/attributes reconociendo "tags": { "required": true }. |
| 154 | error | item.attributes.invalid\_length | Invalid value length for attribute $ATTRIBUTE\_ID. Maximum length is 255. | A longitude máxima para o atributo $ATTRIBUTE\_ID foi superada. | Para ver os atributos consulte /categories/$CATEGORY\_ID/attributes campo value\_max\_length. |
| 173 | error | item.listing\_type\_id.requiresPictures | Item pictures are mandatory for listing type gold\_special. | As imagens são obrigatórias. | Associar imagens na publicação. |
| 201 | error | item.pictures.max | Items in category $CATEGORY\_ID cannot exceeds $NUMBER pictures. | As imagens excedem a quantidade máxima permitida. | Consulte o límite permitido de imagens em /categories/$CATEGORY\_ID campos max\_pictures\_per\_item e max\_pictures\_per\_item\_var. |
| 204 | error | item.pictures.picture\_not\_found | Picture id $PICTURE\_ID does not exist. | A imagem não existe. | Adicione uma imagem válida. |
| 369 | error | body.required\_fields | The variations[$VARIATION\_NUMBER] does not contains some or none of the following properties [attribute\_combinations, $ATTRIBUTE\_ID]. | O atributo $ATTRIBUTE\_ID é obrigatório para o array de attribute\_combinations na variação. | Para ver os atributos obrigatórios na categoria, consulte /categories/$CATEGORY\_ID/attributes identificando "tags": { "required": true }. |
| 372 | error | tem.attributes.non\_existent.limit\_exceded | The attribute\_combinations not existing in category $CATEGORY\_ID in the variation $VARIATION\_ID exceed the allowed amount, only 1 of this kind is allowed. | Algum dos atributos especificados no array de attribute\_combinations não existe ou está repetido. | Verifique o array attribute\_combinations. |
| 382 | warning | item.category\_id.migrated | Category id migrated to: $CATEGORY\_ID. | O id de categoria informado foi migrado a $CATEGORY-ID. | Não aplica, o campo é automático. |
| 394 | error | item.attribute.values.name.invalid | Attribute $ATTRIBUTE\_ID has a values entry with name too long ($CHARACTERS\_NUMBER). Maximum name size allowed is 255. | A longitude máxima para o atributo $ATTRIBUTE\_ID foi superada. | Para ver os atributos consulte a /categories/$CATEGORY\_ID/attributes campo value\_max\_length. |
| 465 | warning | item.video\_id.dropped | Item video id was dropped. | Desativamos a opção de incluir vídeos do YouTube nas publicações de Marketplace. | Utilize [Clips](https://www.mercadolivre.com.br/a/store/clips-escola-de-videos-home). |
| 1212 | warning | normalize.item.attribute.values | Attribute [$ATTRIBUTE] to be modified - values [($VALUE\_ID,$VALUE\_NAME)] should be [($VALUE\_ID,$VALUE\_NAME)] - Normalized form: [migration]. | O atributo não conta com o value\_id ou value\_name especificados na chamada, completamos automaticamente o campo que falta. | Não aplica. |
| 2511 | warning | create.item.attribute.business\_conditional | Attribute $ATTRIBUTE to be added with values [($VALUE\_ID,$VALUE\_NAME)]". | O atributo não está especificado na chamada, adicionamos automaticamente. | Não aplica. |
| 3250 | warning | moderations.seller.not\_authorized | Seller is not authorized for this brand and category. | É uma marca que deve ser validada, ou seja, demostrar que se adquirem los produtos através de distribuidores ou retailers autorizados pela marca no país. | Entre no Mercado Livre na seção de Vendas > Preferências de vendas > Validações, selecione “Validar marca”, entre na marca e valide, depois anexe as faturas de compra . |
| 4029 | warning | shipping.me2\_adoption\_mandatory | ME2 adoption is mandatory for the user. | O tipo de envio ME2 é obrigatário para o usuário, completamos a informação automaticamente. | Não aplica. |
| 7710 | error | item.attribute.product\_identifier.invalid | Product Identifier [GTIN] has invalid values: [$VALUE]. | O identificador de produtos contém caracteres inválidos. | Adicione um identificador de produto válido. |
| 7711 | error | item.attribute.product\_identifier.invalid\_format | Product Identifier [GTIN] contains values with invalid format: [$VALUE]. | O identificador do produto beste caso GTIN tem formato incorreto. | Adicione um identificador de produto válido. |
| 7712 | error | item.attribute.product\_identifier.invalid   \_by\_domain\_catalog | Product Identifier [GTIN] with values [$VALUE] corresponds to category [$CATEGORY\_ID]. | O identificador de produto enviado corresponde a um produto de outra categoria $CATEGORY\_ID dentro do mesmo domínio onde está publicando. | Adicione um identificador de produto válido para a categoria que está publicando. |
| 7714 | error |  | The {$UNIVERSAL\_CODE\_FIELD} universal code has an incorrect format. | Ao menos um atributo do tipo (GTIN, EAN, UPC, JAN, GTIN14, ISBN, ISBN10, ISBN13) é inválido. | Pode validar os códigos, usando este recurso /product-identifier/validator?product\_identifier=$UNIVERSAL\_CODE\_FIELD. |
| 7810 | error | item.attribute.missing\_conditional\_required | The attributes [$ATTRIBUTE\_ID] are required for category [$CATEGORY\_ID]. Check the attribute is present in the attributes list or in all variation's attributes\_combination or attributes. | O GTIN é um atributo obrigatário para a categoria $CATEGORY\_ID. | Para ver os atributos obrigatórios na categoria, consulte /categories/$CATEGORY\_ID/attributes identificando "conditional\_required": true |
| 3701 | error | item.attribute.invalid\_product\_identifier | Enter a universal code that you have not used in another brand listing/category listing. | O GTIN foi utilizado para outras publicações de outra marca ou domínio. | Corrija o campo GTIN ou código universal. |
| 3702 | error | item.attribute.invalid\_sanitary\_registry\_value | The value you entered in {$ATTRIBUTE\_ID} is incorrect. An example is: {$VALUE}. | Possuí erros de formato em dados de registro sanitário. | Corrija o atributo $ATTRIBUTE\_ID com um valor válido. |
| 3703 | error | item.pictures.invalid\_size | The photos must have a minimum size of 500 pixels on at least one side. | As fotos devem ter um tamanho máximo de 500 pixels em ao menos um dos lados. | Carregar fotos que cumprem com o estândar mínimo de 500 pixels. |
| 3704 | error | item.attribute.missing\_catalog\_required | The {$FIELD\_ID} field is mandatory and was not added. | Falta completar algum dos atributos de tipo catalog\_required ou catalog\_child\_required. | Para ver os atributos obrigatórios na categoria, consulte /categories/$CATEGORY\_ID/attributes identificando "catalog\_required": true ou “catalog\_child\_required”: true |
| 3705 | error | item.title.minimum\_length | You should include more main features in the title to differentiate it from other products. | O título deve incluir mais detalhe sobre o produto ofertado. | Corrigir o campo título da publicação. |
| 3706 | error | item.pictures.unavailable | An error occurred while processing the photo. Please upload it again. | Durante o processo de carregamento de imagem principal houve uma falha ou ficou inacessível. | Tete carregar a publicação, se o erro persistir modifique a imagem. |
| 3707 | error | item.descriptions.length\_exceeded | You exceeded the {$VALUE} character limit. Shorten the description. | A descrição não deve superar $VALUE caracteres | Corrigir a descrição para não superar a regra de quantidade máxima de caracteres permitidos. |
| 3708 | error | item.attribute.number\_invalid\_format | The value you entered in {$FIELD\_ID} is incorrect. An example is: {$VALUE}. | O valor informado no campo $FIELD\_ID é incorreto. | Corrigir valores errado que tem um formato incorreto nos atributos numéricos. |
| 3709 | error | item.attribute.invalid\_sale\_units | You added {$VALUE\_1} in the {$FIELD\_ID\_1} field, but you have not filled out the {$FIELD\_ID\_2} field.   You added {$VALUE\_1} in the {$FIELD\_ID\_1} field and, in this case, the {$FIELD\_ID\_2} field should not be {$VALUE\_2}.  If in the {ase, the {$FIELD\_ID} option, you chose {$VALUE\_1}, in this field you must fill in {ase, the {$VALUE\_2}. | Você carregou {0} no campo{1} mas não completou o campo {2}.  Você carregou {0} no campo {1} e, neste campo, o campo {2} não deve ser {3}.  Se em {0} escolheu {1}, neste campo deve completar {2}. | Corrigir os atributos SALE\_FORMAT e UNITS\_PER\_PACK. Seguindo as seguintes condições: Se está carregando UNITS\_PER\_PACK, deve estar carregado SALE\_FORMAT.  Se SALE\_FORMAT tem valor Unidad, então UNITS\_PER\_PACK (se está carregado) deve ser 1.  Se SALE\_FORMAT tem valor Pack, então UNITS\_PER\_PACK deve ser maio que 1.  Se SALE\_FORMAT tem valor Peso, então NET\_WEIGHT deve estar carregado. |
| 3710 | error | item.attribute.invalid\_voltage | It is not allowed to sell products of this voltage in Argentina. | Aplica para Argentina, tem uma voltagem entre 100 e 199 Volts e sua venda não é permitida. | Não aplica. |
| 3711 | error | item.attribute.gtin\_invalid\_domain | The {$GTIN} universal code corresponds to the {$CATEGORY\_ID} category. | Se valida que o GTIN não está em outro produto correspondente a outro domínio ao qual está publicando. | Adicionar um identificador de produto válido para a categoria que está publicando. |
| 3712 | error | item.attribute.gtin\_invalid\_brand | The {$GTIN} universal code corresponds to the {$BRAND} brand. | O código universal informado corresponde a outra marca $BRAND diferente a que informou para sua publicação. | Adicionar um identificador de produto válido para a categoria que está publicando. |
| 4210 | error | invalid.title.gender | Please make sure you enter a gender that matches the title of your listing. | O título da publicação refere-se a um gênero diferente do indicado no atributo GENDER. | O título deve ser corrigido para se referir ao mesmo gênero, tal como indicado na ficha técnica da publicação. |
| 3416 | warning | item.attribute.anatel\_homologation\_number.invalid | Declaro que este produto é homologado pela ANATEL e assumo responsabilidade legal caso não esteja em conformidade com a regulamentação. | O código ANATEL informado é inválido. | Deverá subir um código ANATEL válido em conformidade com a regulamentação. |
| 3417 | warning | item.attribute.ean.invalid | Declaro que este produto é homologado pela ANATEL e assumo responsabilidade legal caso não esteja em conformidade com a regulamentação. | O código GTIN/EAN informado é inválido. | Deverá subir um código GTIN/EAN válido em conformidade com a regulamentação. |
| 3418 | warning | item.attribute.anatel\_homologation\_number.missing | Declaro que este produto é homologado pela ANATEL e assumo responsabilidade legal caso não esteja em conformidade com a regulamentação. | O código ANATEL não foi informado. | Deverá informar um código ANATEL válido em conformidade com a regulamentação. |
| 3510 | Error | Attribute [%s] is not valid, item values [%s], attributeId, itemValuesStr | Revise os atributos e formato, com base na categoria e ou domínios. | Atributo informado, não é um allow\_value. | Insira com atributos válidos. |
| 3419 | warning | item.attribute.ean.missing | Declaro que este produto é homologado pela ANATEL e assumo responsabilidade legal caso não esteja em conformidade com a regulamentação. | O código GTIN/EAN não foi informado. | Deverá informar um código GTIN/EAN válido em conformidade com a regulamentação. |

Conteúdos
