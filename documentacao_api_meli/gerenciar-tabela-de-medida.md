# Gerenciar tabela de medidas

Fonte: https://developers.mercadolivre.com.br/gerenciar-tabela-de-medida

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 09/07/2026

## Gerenciar tabela de medidas

Importante:

Este recurso está disponível para Brasil, Argentina, México, Brasil, Uruguai, Colômbia, Peru, Equador e Chile.

Após obter as estruturas necessárias das fichas de domínio e a tabela de medidas, está pronto para criar uma tabela de medidas personalizada/específica (SPECIFIC).  
  
Utilizando as informações das tabelas de medidas criadas anteriormente, sejam elas do tipo marca (BRAND), padrão do Mercado Livre (STANDARD) ou personalizadas/específicas (SPECIFIC), será possível associá-las às publicações de moda.   
  
Lembre-se que no Uruguai, Colômbia, Peru, Equador e Chile só temos a experiência de tabela de medidas personalizado/específico (SPECIFIC).

  

## Criar tabela de medidas personalizada

Considere a resposta recebida na  [ficha técnica](https://developers.mercadolivre.com.br/pt_br/primeiros-pasos?nocache=true#Consultar-ficha-tecnica) da tabela de medidas. Com essa informação, você poderá estruturar o corpo do POST. Se você enviar algum atributo que não esteja na ficha técnica, ele retornará um erro.

  

E também indicará:

- Tipos de dados (text, number unit, list, etc).
- Atributos que possuem a tag **main\_attribute\_candidate** devem ser enviados pelo menos um como **main\_atributte**.Os atributos com a tag **required** são obrigatórios.
- Os atributos que possuem a tag **grid\_filter** devem ser carregados no nível geral da tabela de medidas e não no nível de rows.
- No nível de rows, você terá de enviar os atributos somente com a tag **required** somente e pelo menos um com a tag **main\_attribute\_candidate**.
- O atributo **BRAND** também é obrigatório no campo **attributes**, no mesmo nível onde **GENDER** é declarado. Ambos são atributos gerais da guia e não devem ser enviados dentro de **rows**.

Nota:

- O campo **names** tem no máximo **60 caracteres** e não aceita caracteres especiais como `(`, `)` nem `-`. Use apenas letras, números e espaços.
- O **domain\_id** deve ser enviado **sem o prefixo do site**. Exemplo: usar `"SHIRTS"`, não `"MLB-SHIRTS"`. A API concatena o prefixo internamente de acordo com o **site\_id** do token.
- O **Access Token** deve pertencer a um usuário registrado no **mesmo site** indicado em **site\_id**. Se houver divergência, a API retorna `site_id: this field has an invalid value` sem deixar claro que o problema é o token.

  

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d {...} https://api.mercadolibre.com/catalog/charts
```

Exemplo de criação de uma tabela personalizada para um domínio de footwear, gênero Masculino com as medidas de 40 a 42 e adicionalmente se define como um tamanho principal o US\_SIZE:

```
curl -X POST 'https://api.mercadolibre.com/catalog/charts' -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json' --data-raw '{
   "names": {
       "MLA": "Guía de talles de calzado de hombre"
   },
   "domain_id": "SNEAKERS",
   "site_id": "MLA",
   "main_attribute": {
       "attributes": [
           {
               "site_id": "MLA",
               "id": "M_US_SIZE"
           }
       ]
   },
   "attributes": [
       {
           "id": "GENDER",
           "values": [
               {
                   "id": "339666",
                   "name": "Hombre"
               }
           ]
       }
   ],
   "rows": [
       {
           "attributes": [
               {
                   "id": "AR_SIZE",
                   "values": [
                       {
                           "name": "40 AR"
                       }
                   ]
               },
               {
                   "id": "M_US_SIZE",
                   "values": [
                       {
                           "name": "8,5 US"
                       }
                   ]
               },
               {
                   "id": "FOOT_LENGTH",
                   "values": [
                       {
                           "name": "10 cm"
                       }
                   ]
               }
           ]
       },
       {
           "attributes": [
               {
                   "id": "AR_SIZE",
                   "values": [
                       {
                           "name": "41 AR"
                       }
                   ]
               },
               {
                   "id": "M_US_SIZE",
                   "values": [
                       {
                           "name": "9 US"
                       }
                   ]
               },
               {
                   "id": "FOOT_LENGTH",
                   "values": [
                       {
                           "name": "15 cm"
                       }
                   ]
               }
           ]
       },
       {
           "attributes": [
               {
                   "id": "AR_SIZE",
                   "values": [
                       {
                           "name": "42 AR"
                       }
                   ]
               },
               {
                   "id": "M_US_SIZE",
                   "values": [
                       {
                           "name": "9,5 US"
                       }
                   ]
               },
               {
                   "id": "FOOT_LENGTH",
                   "values": [
                       {
                           "name": "20 cm"
                       }
                   ]
               }
           ]
       }
   ]
}'
```

  

Respuesta criação da tabela de medidas para domínios de footwear:

```
{
   "id": "463005",
   "names": {
       "MLA": "Guía de talles de calzado de hombre"
   },
   "domain_id": "SNEAKERS",
   "site_id": "MLA",
   "type": "SPECIFIC",
   "seller_id": 1108966308,
   "main_attribute_id": "M_US_SIZE",
   "secondary_attribute_id": "AR_SIZE",
   "attributes": [
       {
           "id": "GENDER",
           "name": "Género",
           "values": [
               {
                   "id": "339666",
                   "name": "Hombre"
               }
           ]
       }
   ],
   "rows": [
       {
           "id": "463005:1",
           "attributes": [
               {
                   "id": "SIZE",
                   "name": "Talle",
                   "values": [
                       {
                           "name": "8,5 US",
                           "struct": {
                               "number": 8.5,
                               "unit": "US"
                           }
                       }
                   ]
               },
               {
                   "id": "FOOT_LENGTH",
                   "name": "Largo del pie",
                   "values": [
                       {
                           "name": "10 cm",
                           "struct": {
                               "number": 10.0,
                               "unit": "cm"
                           }
                       }
                   ]
               },
               {
                   "id": "AR_SIZE",
                   "name": "AR",
                   "values": [
                       {
                           "name": "40 AR",
                           "struct": {
                               "number": 40.0,
                               "unit": "AR"
                           }
                       }
                   ]
               },
               {
                   "id": "M_US_SIZE",
                   "name": "US-M",
                   "values": [
                       {
                           "name": "8,5 US",
                           "struct": {
                               "number": 8.5,
                               "unit": "US"
                           }
                       }
                   ]
               }
           ]
       },
       {
           "id": "463005:2",
           "attributes": [
               {
                   "id": "SIZE",
                   "name": "Talle",
                   "values": [
                       {
                           "name": "9 US",
                           "struct": {
                               "number": 9.0,
                               "unit": "US"
                           }
                       }
                   ]
               },
               {
                   "id": "FOOT_LENGTH",
                   "name": "Largo del pie",
                   "values": [
                       {
                           "name": "15 cm",
                           "struct": {
                               "number": 15.0,
                               "unit": "cm"
                           }
                       }
                   ]
               },
               {
                   "id": "AR_SIZE",
                   "name": "AR",
                   "values": [
                       {
                           "name": "41 AR",
                           "struct": {
                               "number": 41.0,
                               "unit": "AR"
                           }
                       }
                   ]
               },
               {
                   "id": "M_US_SIZE",
                   "name": "US-M",
                   "values": [
                       {
                           "name": "9 US",
                           "struct": {
                               "number": 9.0,
                               "unit": "US"
                           }
                       }
                   ]
               }
           ]
       },
       {
           "id": "463005:3",
           "attributes": [
               {
                   "id": "SIZE",
                   "name": "Talle",
                   "values": [
                       {
                           "name": "9,5 US",
                           "struct": {
                               "number": 9.5,
                               "unit": "US"
                           }
                       }
                   ]
               },
               {
                   "id": "FOOT_LENGTH",
                   "name": "Largo del pie",
                   "values": [
                       {
                           "name": "20 cm",
                           "struct": {
                               "number": 20.0,
                               "unit": "cm"
                           }
                       }
                   ]
               },
               {
                   "id": "AR_SIZE",
                   "name": "AR",
                   "values": [
                       {
                           "name": "42 AR",
                           "struct": {
                               "number": 42.0,
                               "unit": "AR"
                           }
                       }
                   ]
               },
               {
                   "id": "M_US_SIZE",
                   "name": "US-M",
                   "values": [
                       {
                           "name": "9,5 US",
                           "struct": {
                               "number": 9.5,
                               "unit": "US"
                           }
                       }
                   ]
               }
           ]
       }
   ]
}
```

  

Exemplo para criar uma tabela de medidas personalizada usando intervalos de medidas:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d
{
   "names": {
       "MLA": "Guia de test para rangos niños"
   },
   "domain_id": "SNEAKERS_TEST",
   "site_id": "MLA",
   "attributes": [
       {
           "id": "GENDER",
           "values": [
               {
                   "id": "339667",
                   "name": "Niños"
               }
           ]
       }
   ],
   "main_attribute": {
       "attributes": [
           {
               "site_id": "MLA",
               "id": "MANUFACTURER_SIZE"
           }
       ]
   },
   "rows": [
       {
           "attributes": [
               {
                   "id": "MANUFACTURER_SIZE",
                   "values": [
                       {
                           "name": "3 US"
                       }
                   ]
               },
               {
                   "id": "FOOT_LENGTH",
                   "values": [
                       {
                           "name": "10 cm"
                       }
                   ]
               },
               {
                   "id": "FOOT_LENGTH_TO",
                   "values": [
                       {
                           "name": "13 cm"
                       }
                   ]
               }
           ]
       },
       {
           "attributes": [
               {
                   "id": "MANUFACTURER_SIZE",
                   "values": [
                       {
                           "name": "4 US"
                       }
                   ]
               },
               {
                   "id": "FOOT_LENGTH",
                   "values": [
                       {
                           "name": "15 cm"
                       }
                   ]
               },
               {
                   "id": "FOOT_LENGTH_TO",
                   "values": [
                       {
                           "name": "20 cm"
                       }
                   ]
               }
           ]
       }
   ]
}' https://api.mercadolibre.com/catalog/charts
```

  

Algumas considerações sobre os atributos das tabelas de medidas:

- **manufacturer\_size**: é opcional e representa a medida da marca ou do fabricante.
- **size**: calcula-se apenas conforme a regra que tenha a tabela de medidas e representará o tamanho principal que será visualizado na publicação (na coluna principal).
- **foot\_length y foot\_length\_to**: atributos utilizados para criar intervalos de medidas dentro da especificação de uma fila da tabela e medidas.

Nota:

Para atributos do tipo **number\_unit** (como **FOOT\_LENGTH**, **WAIST\_CIRCUMFERENCE**, entre outros), sempre inclua o objeto **struct** junto ao campo **name**. Omiti-lo pode causar inconsistências ao salvar os valores:  
  
**Correto:**  
`{"name": "48 cm", "struct": {"number": 48, "unit": "cm"}}`

A primeira coluna de uma tabela de medidas, determinará o que vai no picker (detalhe descritivo do tamanho). Esta coluna pode ser determinada pelo vendedor para alterar o que queremos mostrar como uma descrição do tamanho.

  

No caso das tabelas de medidas estândar e de marca, a coluna de detalhes (picker) será predefinida carregadas por site.

  

Por exemplo, o vendedor indicou que seu tamanho principal devem ser do tipo US\_SIZE, portanto a coluna SIZE é calculada de acordo com o que o vendedor indicou.

  
![]( https://http2.mlstatic.com/storage/developers-site-cms-admin/234952426618-Captura-de-Pantalla-2022-12-27-a-la-s--12.25.54.png)   
  

Exemplo do front de uma publicação com uma tabela de medidas associada.

  
![]( https://http2.mlstatic.com/storage/developers-site-cms-admin/234952699926-Captura-de-Pantalla-2022-12-27-a-la-s--12.21.15.png)   

Cada quadro azul (picker) no caso da imagem "9 US" faz referência as medidas designadas pelo vendedor como principais.

  

## Criar tabela em domínios TOPS and BOTTOMS

Importante:

Para as categorias de TOPS and BOTTOMS, apenas podem ser criadas publicações a partir de tabela de medida de tipo personalizado **(SPECIFIC)**.  
A partir de fevereiro de 2024 poderá criar a tabela de medidas  [especificando atributos de medidas de roupas](https://developers.mercadolivre.com.br/pt_br/gerenciar-tabela-de-medida?nocache=true#Criar-tabelas-com-medidas-de-roupas), como, por exemplo, comprimento da roupa, largura da roupa, costura interna da roupa, entre outros. Segundo a necessidade de cada vendedor.

Para domínios de [TOPS e BOTTOMS](https://developers.mercadolivre.com.br/pt_br/primeiros-pasos?nocache=true#Dominios-dispon%C3%ADveis), como, por exemplo: calças, camisas, vestidos, entre outros. Incluímos atributos do tipo de dados **value\_type: "list"** uma **Lista**, que contém um conjunto de valores predeterminados pelo Mercado Livre para especificar certos atributos de uma tabela de medida personalizada. adicionalmente, você encontrará a tag **multivalued** que permitirá criar a guia com um ou mais valores específicos dentro da lista para cada linha, exemplo: você verá que o tamanho Small inclui os valores da lista de tamanhos de 26 a 30 (26, 27, 28, 29, 30), enquanto o tamanho Large corresponde a um único valor de tamanho 40.

  
![]( https://http2.mlstatic.com/storage/developers-site-cms-admin/228204174762-Captura-de-Pantalla-2023-03-15-a-la-s--14.56.49.png)
  
  

Nos domínios **TOPS and BOTTOMS você só pode usar guias de tipo SPECIFIC**, ou guias personalizadas especificadas por cada vendedor.
  
Ao [consultar a ficha técnica da tabela de medida](https://developers.mercadolivre.com.br/pt_br/primeiros-pasos?nocache=true#Consultar-ficha-tecnica) verá no resultado um tipo de dado list que determina uma Lista, este atributo indicará os possíveis valores que pode tomar, tanto seu **value\_id** como seu **value\_name**.

  

Exemplo de criação de uma tabela de medidas personalizada, com medidas corporais, por uma Lista:

```
curl -L -X POST 'https://api.mercadolibre.com/catalog/charts' -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json' -d '{
   "names": {
       "MLB": "Tabela TOPS and BOTTOMS de teste"
   },
   "domain_id": "PANTS_TEST",
   "site_id": "MLB",
   "attributes": [
       {
           "id": "GENDER",
           "values": [
               {
                   "name": "Feminino"
               }
           ]
       }
   ],
   "main_attribute": {
       "attributes": [
           {
               "site_id": "MLB",
               "id": "SIZE"
           }
       ]
   },
   "rows": [
       {
           "attributes": [
               {
                   "id": "SIZE",
                   "values": [
                       {
                           "name": "Small"
                       }
                   ]
               },
               {
                   "id": "PANTS_TEST_FILTRABLE_SIZES",
                   "values": [
                       {
                           "name": "34"
                       },
                       {
                           "name": "36"
                       },
                       {
                           "name": "38"
                       },
                       {
                           "name": "40"
                       }
                   ]
               },
               {
                   "id": "WAIST_CIRCUMFERENCE_FROM",
                   "values": [
                       {
                           "name": "82 cm"
                       }
                   ]
               },
               {
                   "id": "HIP_CIRCUMFERENCE_FROM",
                   "values": [
                       {
                           "name": "90 cm"
                       }
                   ]
               },
               {
                   "id": "LENGTH_FROM_WAIST_TO_ANKLE_FROM",
                   "values": [
                       {
                           "name": "104 cm"
                       }
                   ]
               },
               {
                   "id": "LENGTH_FROM_INSEAM_TO_ANKLE_FROM",
                   "values": [
                       {
                           "name": "107 cm"
                       }
                   ]
               },
               {
                   "id": "THIGH_CIRCUMFERENCE_FROM",
                   "values": [
                       {
                           "name": "45 cm"
                       }
                   ]
               }
           ]
       },
       {
           "attributes": [
               {
                   "id": "SIZE",
                   "values": [
                       {
                           "name": "Medium"
                       }
                   ]
               },
               {
                   "id": "PANTS_TEST_FILTRABLE_SIZES",
                   "values": [
                       {
                           "id": "3259454"
                       },
                       {
                           "id": "3189154"
                       },
                       {
                           "id": "3189158"
                       }
                   ]
               },
               {
                   "id": "WAIST_CIRCUMFERENCE_FROM",
                   "values": [
                       {
                           "name": "86 cm"
                       }
                   ]
               },
               {
                   "id": "HIP_CIRCUMFERENCE_FROM",
                   "values": [
                       {
                           "name": "93 cm"
                       }
                   ]
               },
               {
                   "id": "LENGTH_FROM_WAIST_TO_ANKLE_FROM",
                   "values": [
                       {
                           "name": "108 cm"
                       }
                   ]
               },
               {
                   "id": "LENGTH_FROM_INSEAM_TO_ANKLE_FROM",
                   "values": [
                       {
                           "name": "110 cm"
                       }
                   ]
               },
               {
                   "id": "THIGH_CIRCUMFERENCE_FROM",
                   "values": [
                       {
                           "name": "47 cm"
                       }
                   ]
               }
           ]
       },
       {
           "attributes": [
               {
                   "id": "SIZE",
                   "values": [
                       {
                           "name": "Large"
                       }
                   ]
               },
               {
                   "id": "PANTS_TEST_FILTRABLE_SIZES",
                   "values": [
                       {
                           "name": "52"
                       }
                   ]
               },
               {
                   "id": "WAIST_CIRCUMFERENCE_FROM",
                   "values": [
                       {
                           "name": "88 cm"
                       }
                   ]
               },
               {
                   "id": "HIP_CIRCUMFERENCE_FROM",
                   "values": [
                       {
                           "name": "111 cm"
                       }
                   ]
               },
               {
                   "id": "LENGTH_FROM_WAIST_TO_ANKLE_FROM",
                   "values": [
                       {
                           "name": "113 cm"
                       }
                   ]
               },
               {
                   "id": "LENGTH_FROM_INSEAM_TO_ANKLE_FROM",
                   "values": [
                       {
                           "name": "107 cm"
                       }
                   ]
               },
               {
                   "id": "THIGH_CIRCUMFERENCE_FROM",
                   "values": [
                       {
                           "name": "49 cm"
                       }
                   ]
               }
           ]
       }
   ]
}'
```

Resposta da criação de uma tabela de medidas com medidas corporais por uma Lista:

```
{
   "id": "526618",
   "names": {
       "MLB": "Tabela TOPS and BOTTOMS de teste"
   },
   "domain_id": "PANTS_TEST",
   "site_id": "MLB",
   "type": "SPECIFIC",
   "seller_id": 819780659,
   "main_attribute_id": "SIZE",
   "attributes": [
       {
           "id": "GENDER",
           "name": "Gênero",
           "values": [
               {
                   "name": "Feminino"
               }
           ]
       }
   ],
   "rows": [
       {
           "id": "526618:1",
           "attributes": [
               {
                   "id": "SIZE",
                   "name": "Tamanho",
                   "values": [
                       {
                           "name": "Small"
                       }
                   ]
               },
               {
                   "id": "SIZE",
                   "name": "Tamanho da marca",
                   "values": [
                       {
                           "name": "Small"
                       }
                   ]
               },
               {
                   "id": "PANTS_TEST_FILTRABLE_SIZES",
                   "name": "Tamanho do filtro",
                   "values": [
                       {
                           "id": "3189130",
                           "name": "34"
                       },
                       {
                           "id": "3259450",
                           "name": "36"
                       },
                       {
                           "id": "3259451",
                           "name": "38"
                       },
                       {
                           "id": "3189142",
                           "name": "40"
                       }
                   ]
               },
               {
                   "id": "WAIST_CIRCUMFERENCE_FROM",
                   "name": "Contorno da cintura de",
                   "values": [
                       {
                           "name": "82 cm",
                           "struct": {
                               "number": 82.0,
                               "unit": "cm"
                           }
                       }
                   ]
               },
               {
                   "id": "HIP_CIRCUMFERENCE_FROM",
                   "name": "Contorno do quadril de",
                   "values": [
                       {
                           "name": "90 cm",
                           "struct": {
                               "number": 90.0,
                               "unit": "cm"
                           }
                       }
                   ]
               },
               {
                   "id": "LENGTH_FROM_WAIST_TO_ANKLE_FROM",
                   "name": "Largo de la cintura al tobillo desde",
                   "values": [
                       {
                           "name": "104 cm",
                           "struct": {
                               "number": 104.0,
                               "unit": "cm"
                           }
                       }
                   ]
               },
               {
                   "id": "LENGTH_FROM_INSEAM_TO_ANKLE_FROM",
                   "name": "Largo de la entrepierna al tobillo desde",
                   "values": [
                       {
                           "name": "107 cm",
                           "struct": {
                               "number": 107.0,
                               "unit": "cm"
                           }
                       }
                   ]
               },
               {
                   "id": "THIGH_CIRCUMFERENCE_FROM",
                   "name": "Contorno del muslo desde",
                   "values": [
                       {
                           "name": "45 cm",
                           "struct": {
                               "number": 45.0,
                               "unit": "cm"
                           }
                       }
                   ]
               }
           ]
       },
       {
           "id": "526618:2",
           "attributes": [
               {
                   "id": "SIZE",
                   "name": "Tamanho",
                   "values": [
                       {
                           "name": "Medium"
                       }
                   ]
               },
               {
                   "id": "SIZE",
                   "name": "Tamanho da marca",
                   "values": [
                       {
                           "name": "Medium"
                       }
                   ]
               },
               {
                   "id": "PANTS_TEST_FILTRABLE_SIZES",
                   "name": "Tamanho do filtro",
                   "values": [
                       {
                           "id": "3259454",
                           "name": "44"
                       },
                       {
                           "id": "3189154",
                           "name": "46"
                       },
                       {
                           "id": "3189158",
                           "name": "48"
                       }
                   ]
               },
               {
                   "id": "WAIST_CIRCUMFERENCE_FROM",
                   "name": "Contorno da cintura de",
                   "values": [
                       {
                           "name": "86 cm",
                           "struct": {
                               "number": 86.0,
                               "unit": "cm"
                           }
                       }
                   ]
               },
               {
                   "id": "HIP_CIRCUMFERENCE_FROM",
                   "name": "Contorno do quadril de",
                   "values": [
                       {
                           "name": "93 cm",
                           "struct": {
                               "number": 93.0,
                               "unit": "cm"
                           }
                       }
                   ]
               },
               {
                   "id": "LENGTH_FROM_WAIST_TO_ANKLE_FROM",
                   "name": "Largo de la cintura al tobillo desde",
                   "values": [
                       {
                           "name": "108 cm",
                           "struct": {
                               "number": 108.0,
                               "unit": "cm"
                           }
                       }
                   ]
               },
               {
                   "id": "LENGTH_FROM_INSEAM_TO_ANKLE_FROM",
                   "name": "Largo de la entrepierna al tobillo desde",
                   "values": [
                       {
                           "name": "110 cm",
                           "struct": {
                               "number": 110.0,
                               "unit": "cm"
                           }
                       }
                   ]
               },
               {
                   "id": "THIGH_CIRCUMFERENCE_FROM",
                   "name": "Contorno del muslo desde",
                   "values": [
                       {
                           "name": "47 cm",
                           "struct": {
                               "number": 47.0,
                               "unit": "cm"
                           }
                       }
                   ]
               }
           ]
       },
       {
           "id": "526618:3",
           "attributes": [
               {
                   "id": "SIZE",
                   "name": "Tamanho",
                   "values": [
                       {
                           "name": "Large"
                       }
                   ]
               },
               {
                   "id": "SIZE",
                   "name": "Tamanho da marca",
                   "values": [
                       {
                           "name": "Large"
                       }
                   ]
               },
               {
                   "id": "PANTS_TEST_FILTRABLE_SIZES",
                   "name": "Tamanho do filtro",
                   "values": [
                       {
                           "id": "4146158",
                           "name": "52"
                       }
                   ]
               },
               {
                   "id": "WAIST_CIRCUMFERENCE_FROM",
                   "name": "Contorno da cintura de",
                   "values": [
                       {
                           "name": "88 cm",
                           "struct": {
                               "number": 88.0,
                               "unit": "cm"
                           }
                       }
                   ]
               },
               {
                   "id": "HIP_CIRCUMFERENCE_FROM",
                   "name": "Contorno do quadril de",
                   "values": [
                       {
                           "name": "111 cm",
                           "struct": {
                               "number": 111.0,
                               "unit": "cm"
                           }
                       }
                   ]
               },
               {
                   "id": "LENGTH_FROM_WAIST_TO_ANKLE_FROM",
                   "name": "Largo de la cintura al tobillo desde",
                   "values": [
                       {
                           "name": "113 cm",
                           "struct": {
                               "number": 113.0,
                               "unit": "cm"
                           }
                       }
                   ]
               },
               {
                   "id": "LENGTH_FROM_INSEAM_TO_ANKLE_FROM",
                   "name": "Largo de la entrepierna al tobillo desde",
                   "values": [
                       {
                           "name": "107 cm",
                           "struct": {
                               "number": 107.0,
                               "unit": "cm"
                           }
                       }
                   ]
               },
               {
                   "id": "THIGH_CIRCUMFERENCE_FROM",
                   "name": "Contorno del muslo desde",
                   "values": [
                       {
                           "name": "49 cm",
                           "struct": {
                               "number": 49.0,
                               "unit": "cm"
                           }
                       }
                   ]
               }
           ]
       }
   ]
}
```

Considere que

- Os valores recibidos dentro do atributo **list**, serão validdos pela Lista que Mercado Livre dispõe na ficha técnica, caso envie um valor que não esteja dentro desta lista, retornará um error do tipo **value\_is\_not\_in\_the\_list**.

```
{
   "error": "chart_validation_error",
   "message": "Chart validation errors found",
   "status": 400,
   "errors": [
       {
           "code": "value_is_not_in_the_list",
           "message": "Value 88 in attribute FILTRABLE_SIZE is incorrect",
           "cell": {
               "attribute_id": "FILTRABLE_SIZE",
               "row": {
                   "id": null,
                   "main_attribute": {
                       "id": "SIZE",
                       "value": "46"
                   }
               }
           }
       }
   ]
}
```

Nota:

Para atributos do tipo **list** (como **FILTRABLE\_SIZE**), o campo **id** do valor é obrigatório e deve ser obtido do response de `technical_specs?section=grids`. Enviar apenas o **name** pode causar erros de validação do tipo `value_is_not_in_the_list`.  
  
**Incorreto:**  
`{"id": "FILTRABLE_SIZE", "values": [{"name": "9-12 meses"}]}`  
  
**Correto:**  
`{"id": "FILTRABLE_SIZE", "values": [{"id": "12917813", "name": "9-12 meses"}]}`

- Para especificar o campo de tipo list, envie **value\_id** ou o **value\_name**, caso envie ambos parâmetros o value\_id tem maior relevância que **value\_name** .

## Criar tabelas com medidas de roupas

Important:

A partir de fevereiro de 2024, apenas para os domínios de TOPS and BOTTOMS, você poderá criar a tabela de medidas permitindo que o vendedor especifique medidas de roupas.   
Para testes, habilitamos o domínio de PANTS\_TEST em todos os sites **apenas para o gênero "Feminino"** com a nova configuração.

Apenas para os domínios de TOPS and BOTTOMS, após [consultar a ficha técnica da tabela de medidas](https://developers.mercadolivre.com.br/pt_br/primeiros-pasos#Consultar-ficha-tecnica) e reconhecer que atributos tem a tag de CLOTHING\_MEASURE você poderá criar a tabela de medidas apenas especificando medidas de roupas.

  

Considere que:

- Você deve especificar o campo "**measure\_type**" e seus possíveis valores: BODY\_MEASURE, CLOTHING\_MEASURE ou MIXED\_MEASURE. Este campo faz referência ao tipo de medida que o vendedor especificará na tabela de medidas. Uma vez criada a tabela de medidas, **este campo não poderá ser modificado**.
- Uma mesma tabela de medidas poderá ter medida de roupas e corporais ao mesmo tempo utilizando o campo "measure\_type" MIXED\_MEASURE.
- Caso não envie o campo "**measure\_type**" por funcionamento a tabela de medidas será de medidas corporais ou BODY\_MEASURE e todas as [validações](https://developers.mercadolivre.com.br/pt_br/validacao-tabela-de-medidas#Validaciones-ao-criar-uma-tabelade-medidas) serão a partir deste tipo de medida.
    

  Exemplo de criação de uma tabela de medidas personalizada, com medidas de roupas:

  ```
  curl -L -X POST 'https://api.mercadolibre.com/catalog/charts' -H 'Authorization: Bearer  $ACCESS_TOKEN' -H 'Content-Type: application/json' -d '{
     "names": {
         "MLB": "Tabela de teste de calças com as medidas da peça"
     },
     "domain_id": "PANTS_TEST",
     "site_id": "MLB",
     "measure_type": "CLOTHING_MEASURE",
     "attributes": [
         {
             "id": "GENDER",
             "values": [
                 {
                     "name": "Feminino"
                 }
             ]
         }
     ],
     "main_attribute": {
         "attributes": [
             {
                 "site_id": "MLB",
                 "id": "SIZE"
             }
         ]
     },
     "rows": [
         {
             "attributes": [
                 {
                     "id": "SIZE",
                     "values": [
                         {
                             "name": "46"
                         }
                     ]
                 },
                 {
                     "id": "PANTS_TEST_FILTRABLE_SIZES",
                     "values": [
                         {
                             "name": "S"
                         }
                     ]
                 },
                 {
                     "id": "GARMENT_LENGTH_FROM",
                     "name": "Comprimento da roupa de",
                     "values": [
                         {
                             "name": "12 cm"
                         }
                     ]
                 },
                 {
                     "id": "GARMENT_WAIST_WIDTH_FROM",
                     "name": "Largura da cintura da roupa de",
                     "values": [
                         {
                             "name": "30 cm"
                         }
                     ]
                 },
                 {
                     "id": "GARMENT_HIP_WIDTH_FROM",
                     "name": "Largura do quadril da roupa de",
                     "values": [
                         {
                             "name": "40 cm"
                         }
                     ]
                 },
                 {
                     "id": "GARMENT_THIGH_WIDTH_FROM",
                     "name": "Largura da coxa da roupa de",
                     "values": [
                         {
                             "name": "22 cm"
                         }
                     ]
                 },
                 {
                     "id": "GARMENT_INSEAM_LENGTH_FROM",
                     "name": "Comprimento da costura interna da roupa de",
                     "values": [
                         {
                             "name": "11 cm"
                         }
                     ]
                 },
                 {
                     "id": "GARMENT_FRONT_RISE_FROM",
                     "name": "Foto frontal da roupa de",
                     "values": [
                         {
                             "name": "13 cm"
                         }
                     ]
                 }
             ]
         }
     ]
  }'
  ```

    

  ## Consultar tabela de medidas

  Você pode consultar uma tabela de medidas específica enviando o ID da tabela de medidas por meio do recurso**/catalog/charts/$chart\_id**.

  Chamada:

  ```
  curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d {...} https://api.mercadolibre.com/catalog/charts/$CHART_ID
  ```

  Exemplo:

  ```
  curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog/charts/232382
  ```

  Resposta

  ```
   {
     "id": "232382",
     "names": {
         "MLC": "Tabla de tallas Sandalias Niña"
     },
     "domain_id": "SANDALS_AND_CLOGS",
     "site_id": "MLC",
     "type": "SPECIFIC",
     "seller_id": 12345667,
     "main_attribute_id": "MANUFACTURER_SIZE",
     "attributes": [
         {
             "id": "GENDER",
             "name": "Género",
             "values": [
                 {
                     "id": "339668",
                     "name": "Niñas"
                 }
             ]
         }
     ],
     "rows": [
         {
             "id": "569686:1",
             "attributes": [
                 {
                     "id": "SIZE",
                     "name": "Talla",
                     "values": [
                         {
                             "name": "17"
                         }
                     ]
                 },
                 {
                     "id": "FOOT_LENGTH",
                     "name": "Largo del pie",
                     "values": [
                         {
                             "name": "10.9 cm",
                             "struct": {
                                 "number": 10.9,
                                 "unit": "cm"
                             }
                         }
                     ]
                 },
                 {
                     "id": "MANUFACTURER_SIZE",
                     "name": "Talle de marca",
                     "values": [
                         {
                             "name": "17"
                         }
                     ]
                 }
             ]
         },
         {
             "id": "569686:2",
             "attributes": [
                 {
                     "id": "SIZE",
                     "name": "Talla",
                     "values": [
                         {
                             "name": "18"
                         }
                     ]
                 },
                 {
                     "id": "FOOT_LENGTH",
                     "name": "Largo del pie",
                     "values": [
                         {
                             "name": "11.5 cm",
                             "struct": {
                                 "number": 11.5,
                                 "unit": "cm"
                             }
                         }
                     ]
                 },
                 {
                     "id": "MANUFACTURER_SIZE",
                     "name": "Talle de marca",
                     "values": [
                         {
                             "name": "18"
                         }
                     ]
                 }
             ]
         },
         {
             "id": "569686:3",
             "attributes": [
                 {
                     "id": "SIZE",
                     "name": "Talla",
                     "values": [
                         {
                             "name": "19"
                         }
                     ]
                 },
                 {
                     "id": "FOOT_LENGTH",
                     "name": "Largo del pie",
                     "values": [
                         {
                             "name": "12.2 cm",
                             "struct": {
                                 "number": 12.2,
                                 "unit": "cm"
                             }
                         }
                     ]
                 },
                 {
                     "id": "MANUFACTURER_SIZE",
                     "name": "Talle de marca",
                     "values": [
                         {
                             "name": "19"
                         }
                     ]
                 }
             ]
         },
         {
             "id": "569686:4",
             "attributes": [
                 {
                     "id": "SIZE",
                     "name": "Talla",
                     "values": [
                         {
                             "name": "20"
                         }
                     ]
                 },
                 {
                     "id": "FOOT_LENGTH",
                     "name": "Largo del pie",
                     "values": [
                         {
                             "name": "12.9 cm",
                             "struct": {
                                 "number": 12.9,
                                 "unit": "cm"
                             }
                         }
                     ]
                 },
                 {
                     "id": "MANUFACTURER_SIZE",
                     "name": "Talle de marca",
                     "values": [
                         {
                             "name": "20"
                         }
                     ]
                 }
             ]
         }
  }
  ```

    

  ## Adicionar filas na tabela de medidas

  Também será possível criar ou adicionar uma fila na tabela de medidas já criadasem necessidade de modificar toda a tabela. Basta realizar um POST no recurso **/catalog/charts/$chart\_id/rows** e incluir a fila correspondente.

    

  Chamada:

  ```
  curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d {...} https://api.mercadolibre.com/catalog/charts/$CHART_ID/rows
  ```

  Exemplo para adicionar uma fila em uma tabelas de medida do tipo BRAND o STANDARD:

  ```
  curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d

  '{
     "sites": ["MLA", "CBT"], // Aplica si type = BRAND | STANDARD
     "attributes": [{
       "id": "UK_SIZE",
       "values": [{
         "name": "44"
       }]
     },{
       "id": "AR_SIZE",
       "values": [{
         "name": "44"
       }]
     }
  }'
  https://api.mercadolibre.com/catalog/charts/4/rows
  ```

  Exemplo para adicionar uma fila em uma tabela de medida do tipo SPECIFIC:

  ```
  curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d

  '{
     "attributes": [{
       "id": "AR_SIZE",
       "values": [{
         "name": "43 AR"
       }]
     },{
       "id": "FOOT_LENGTH",
       "values": [{
         "name": "22 cm"
       }]
     }]
  }'
  https://api.mercadolibre.com/catalog/charts/4/rows
  ```

  ## Modificar fila na tabela de medida

  Além de criar ou adicionar uma fila na tabela de medida, poderá modificar as já existentes. Realizando um PUT no recurso **/catalog/charts/$chart\_id/rows/$row\_id** e editando a fila correspondente, só se aplica aos casos em que você deseja adicionar informações extras, como no exemplo em que FOOT\_LENGTH é adicionado.

  Importante:

  Não poderá editar o tamanho principal **(main\_attribute)** de cada linha **(row)** e também não poderá excluir linhas.

    

  Chamada:

  ```
  curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d {...} https://api.mercadolibre.com/catalog/charts/$CHART_ID/rows/$ROW_ID
  ```

  Exemplo:

  ```
  curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d

  '{
      "attributes": [
          {
              "id": "FOOT_LENGTH",
              "values": [
                  {
                     "id": "FOOT_LENGTH",
                     "values": [
                         {
                             "name": "10 cm"
                         }
                     ]
                 },
                 {
                     "id": "FOOT_LENGTH_TO",
                     "values": [
                         {
                             "name": "13 cm"
                         }
                     ]
                 }
              ]
          }
      ]
  }'
  https://api.mercadolibre.com/catalog/charts/569686/rows/1
  ```

    

  ## Modificar tabela de medida

  Em uma tabela de medidas criada anteriormente, só é possível modificar o campo **nome**. Se tiver cometido um erro ao criar a tabela de medidas, por exemplo, nos tamanhos principais ou na atribuição de gênero, a  [tabela de medidas deverá ser recriada](https://developers.mercadolivre.com.br/pt_br/gerenciar-tabela-de-medida?nocache=true#Criar-tabela-de-medida-personalizada).

  Importante:

  Ao modificar, você não poderá editar o **main\_attribute** da tabela, como o valor do tamanho principal da linha **(row)** e os atributos gerais. **As tabelas de medidas não podem ser excluídas**.

  Chamada:

  ```
  curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -d {...} https://api.mercadolibre.com/catalog/charts/$CHART_ID
  ```

  Ejemplo:

  ```
  curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -d
  '{
    "names": {
     "MLA": "Guía de talles de calzado de hombre"
            }
  }'
  https://api.mercadolibre.com/catalog/charts/5
  ```

  ## Associar uma tabela de medidas a um item

  Para atribuir uma tabela de medidas a publicações nos domínios exigidos, você terá que realizar um POST aos itens, enviando os novos atributos do tipo **GRID\_ID** e **GRID\_ROW\_ID**, o que permitirá que você se refira ao **(SIZE\_GRID\_ID)** a tabela de medidas a qual desejamos associar o item ou variação e **(SIZE\_GRID\_ROW\_ID)** em referência à linha na tabela de medida.

    

  Exemplo de associação de uma tabela de medidas, para uma publicação sem variações, onde o atributo SIZE\_GRID\_ROW\_ID vai para o nível dos atributos da publicação:

  ```
  curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d
  '{
      "title": "ITEM DE TEST MODA - NO OFERTAR",
      "pictures": [
          {
              "secure_url": "https://http2.mlstatic.com/D_783501-MLB20327737026_062015-O.jpg",
              "url": "http://http2.mlstatic.com/D_783501-MLB20327737026_062015-O.jpg",
              "quality": "",
              "id": "783501-MLB20327737026_062015"
          }
      ],
      "price": 30000,
      "currency_id": "ARS",
      "available_quantity": 5,
      "catalog_listing": false,
      "attributes": [
          {
              "id": "ITEM_CONDITION",
              "value_id": "2230284"
          },
          {
              "id": "BRAND",
              "value_id": "14671",
              "value_name" : "Nike"
          },
          {
              "id": "LINE",
              "value_id": "289533",
              "value_name": "Air Max"
          },
          {
              "id": "MODEL",
              "value_id": "27030",
              "value_name": "AP"
          },
          {
              "id": "GENDER",
              "value_id": "339665",
              "value_name": "Mujer"
          },
          {
              "id": "AGE_GROUP",
              "value_id": "6725189",
              "value_name": "Adultos"
          },
          {
              "id": "SIZE_GRID_ID",
              "value_id": "11273930",
              "value_name":"26008"
          },
          {
              "id": "STYLE",
              "value_id": "6694772",
              "value_name": "Deportivo"
          },
          {
              "id": "RECOMMENDED_SPORTS",
              "value_id": "6694768",
              "value_name": "Running"
          },
          {
              "id": "EXTERIOR_MATERIALS",
              "value_id": "5017538",
              "value_name": "Cuero sintético"
          },
          {
              "id": "OUTSOLE_MATERIALS",
              "value_id": "930364",
              "value_name": "Goma"
          },
          {
              "id": "FOOTWEAR_TECHNOLOGIES",
              "value_id": "8668190",
              "value_name": "Air"
          },
          {
              "id": "FOOTWEAR_TYPE",
              "value_id": "517583",
              "value_name": "Zapatilla"
          },
          {
              "id": "COLOR",
              "value_id": null,
              "value_name": "Blanco/Blanco/Platino metalizado/Platino puro"
          },
          {
              "id": "SIZE_GRID_ROW_ID",
              "value_id": "11286240",
              "value_name": "26008:1"
          }
      ],
      "catalog_product_id": "MLA18565233",
      "category_id": "MLA455855",
      "listing_type_id": "gold_pro"
  }'
  https://api.mercadolibre.com/items
  ```

  Exemplo de associação de uma tabela de medidas, para uma publicação com variações, onde o atributo **SIZE\_GRID\_ROW\_ID** vai para o nível de atributo de cada uma das variações da publicação:

  ```
  curl -L -X POST 'https://api.mercadolibre.com/items' -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json' -d '{
     "title": "Tênis Unissex Eros Olympikus Test No Ofertar",
     "category_id": "MLB23332",
     "price": 349.9,
     "currency_id": "BRL",
     "available_quantity": 6,
     "buying_mode": "buy_it_now",
     "condition": "new",
     "listing_type_id": "gold_special",
     "pictures": [
         {
             "source": "http://http2.mlstatic.com/D_686163-MLB51823676081_102022-O.jpg"
         },
         {
             "source": "http://http2.mlstatic.com/D_945109-MLB51823569653_102022-O.jpg"
         }
     ],
     "attributes": [
         {
             "id": "BRAND",
             "value_name": "Olympikus"
         },
         {
             "id": "GENDER",
             "value_name": "Homem"
         },
         {
             "id": "MODEL",
             "value_name": "EROS"
         },
         {
             "id": "SIZE_GRID_ID",
             "value_name": "210058"
         }
     ],
     "variations": [
         {
             "available_quantity": 5,
             "price": 349.9,
             "attribute_combinations": [
                 {
                     "id": "COLOR",
                     "value_name": "BRANCO-SAFFRON"
                 },
                 {
                     "id": "SIZE",
                     "value_name": "36 BR"
                 }
             ],
             "picture_ids": [
                 "https://storage.googleapis.com/vetorapp0.appspot.com/BATA-5227/3065770-3011_1665670601935.jpg",
                 "https://storage.googleapis.com/vetorapp0.appspot.com/BATA-5227/3065770-3011_1665670605879.jpg",
                 "https://storage.googleapis.com/vetorapp0.appspot.com/BATA-5227/3065770-3011_1665670608926.jpg",
                 "https://storage.googleapis.com/vetorapp0.appspot.com/BATA-5227/3065770-3011_1665670611911.jpg",
                 "https://storage.googleapis.com/vetorapp0.appspot.com/BATA-5227/3065770-3011_1665670614401.jpg"
             ],
             "attributes": [
                 {
                     "id": "EAN",
                     "value_name": "9003065700244"
                 },
                 {
                     "id": "SELLER_SKU",
                     "value_name": "9003065700244"
                 },
                 {
                     "id": "SIZE_GRID_ROW_ID",
                     "value_name": "210058:4"
                 }
             ]
         },
         {
             "available_quantity": 2,
             "price": 349.9,
             "attribute_combinations": [
                 {
                     "id": "COLOR",
                     "value_name": "BRANCO-SAFFRON"
                 },
                 {
                     "id": "SIZE",
                     "value_name": "37 BR",
                     "value_id": "11375309"
                 }
             ],
             "picture_ids": [
                 "https://storage.googleapis.com/vetorapp0.appspot.com/BATA-5227/3065770-3011_1665670601935.jpg",
                 "https://storage.googleapis.com/vetorapp0.appspot.com/BATA-5227/3065770-3011_1665670605879.jpg",
                 "https://storage.googleapis.com/vetorapp0.appspot.com/BATA-5227/3065770-3011_1665670608926.jpg",
                 "https://storage.googleapis.com/vetorapp0.appspot.com/BATA-5227/3065770-3011_1665670611911.jpg",
                 "https://storage.googleapis.com/vetorapp0.appspot.com/BATA-5227/3065770-3011_1665670614401.jpg"
             ],
             "attributes": [
                 {
                     "id": "EAN",
                     "value_name": "9003065700060"
                 },
                 {
                     "id": "SELLER_SKU",
                     "value_name": "9003065700060"
                 },
                 {
                     "id": "SIZE_GRID_ROW_ID",
                     "value_name": "210058:5"
                 }
             ]
         }
     ]
  }'
  ```

  ## Eliminar Tabela de Medidas sem uso

  Considere excluir apenas guias de tamanho que não estejam vinculadas a nenhum item.

  **Chamada:**

  ```
  curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' 'https://api.mercadolibre.com/catalog/charts/$CHART_ID'
  ```

  **Exemplo:**

  ```
  curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' 'https://api.mercadolibre.com/catalog/charts/124125'
  ```

  **Resposta:**

  ```
  { 
        "message": "Before removing the size chart, we'll check that it isn't linked to any listing.   
  If it's still there after 24 hours, it means it's linked to one or more listings and you'll have to unlink it to remove it"
  }
  ```

  A Tabela de Medidas não é excluída imediatamente, mas é realizada uma verificação para garantir que não esteja relacionado a nenhum item ativo, conforme indicado na mensagem de sucesso da API.

  Para saber se a Tabela de Medidas foi excluída com sucesso, é necessário [consultar o seu status](/pt_br/gerenciar-tabela-de-medida#:~:text=%5D%0A%7D%27-,Consultar%20tabela%20de%20medidas,-Voc%C3%AA%20pode%20consultar) 24 horas após a solicitação da exclusão.

    

  Ao verificar se a Tabela de Medidas está vinculada a um item ativo, o “chart\_status” será atualizado para **INACTIVE**.  
  Caso seja detectado que ainda está em uso, ele não será excluído e o “chart\_status” será mantido no status **ACTIVE**.

    

  Esses status só serão visíveis ao visualizar uma Tabela de Medidas que está sendo removida ou cuja remoção foi solicitada.

  Para garantir a correta eliminação, é necessário desvincular a guia de tamanhos de todos os itens, [atualizando a Guia de Tamanhos e suas variações](/pt_br/produto-sincronizacao-de-publicacoes).

    

  Próximo [Validação da tabela de medidas](https://developers.mercadolivre.com.br/pt_br/validacao-tabela-de-medidas?nocache=true).

Conteúdos
