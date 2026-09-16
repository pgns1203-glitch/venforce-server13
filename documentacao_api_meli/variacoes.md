# Variações

Fonte: https://developers.mercadolivre.com.br/variacoes

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 29/12/2025

## Variações

Importante:

A partir de 14 de dezembro de 2022, o máximo de variações permitidas (**max\_variations\_allowed**) por categoria será 100. Exceto categorias de Moda, Acessórios para celulares e Autopartes que terão um limite de 250. Além disso, todas as variações existentes poderão ser editadas.

Neste guia você encontrará o que fazer para publicar o mesmo modelo de Calçados, mas em Cores e Tamanhos diferentes. Com variações, você poderá contar na mesma publicação todas as variantes do item, mantendo estoque diferencial para cada uma. No pedido de compra você verá a cor e o tamanho escolhidos pelo comprador. Saiba mais sobre o [importancia de adicionar variações](https://vendedores.mercadolivre.com.br/nota/aprenda-a-adicionar-variacoes/).

## Benefícios

- O comprador pode ver dentro de um mesmo anúncio as diferentes variações e a disponibilidade de cada uma.
- Diminui as consultas entre comprador e vendedor.
- Na ordem de compra aparecerá a cor e o tamanho escolhido pelo comprador, facilitando o processo de pós-venda e evitando reclamações.
- Permite maior controle e organização do estoque.

## Considerações

- Você poderá enviar o código de estoque (SKU) para cada variação. A maneira correta de carregar o SKU é no atributo do item. Este atributo é o SELLER\_SKU deixando o campo seller\_custom\_field para uso interno pelo vendedor e sem ter relação entre os dois campos.
- Atualmente, os dois campos no recurso de /orders estão disponíveis como no recurso de /items e eles não são combináveis.
- Sempre que o item tiver o atributo SELLER\_SKU, tanto em /itens quanto em /orders, o valor do atributo será visualizado. Você sempre deve carregar o valor no atributo para que ele seja considerado.
- O preço deverá ser o mesmo para cada variação. Embora via API é permitido colocar diferentes preços para cada variação, na VIP só será visualizado o preço mais alto e também será considerado no momento do pagamento.

  

## Anunciar produtos com variações

Para anunciar produtos com variações, você deve escolher a categoria em que quiser anunciar; pode identificá-la quando o campo attribute\_types conter variations. Depois, você deverá consultar a API de atributos e identificar os atributos segundo os quais seus produtos podem variar através da tag allow\_variations. Esse tipo de atributo deve ser carregado na seção attribute\_combinations, dentro de variações, temdo en mente que você debe carregar o mesmo para todas as variações.

Além disso, lembre que você pode enviar a propriedade attributes para cada variação, especificando características do produto próprias de cada variante do seu produto. Os atributos disponíveis nesta seção serão identificados na API pela tag variation\_attribute. Por exemplo, se você estiver vendendo um celular em diversas cores, e cada um deles tiver seu código de barras, poderá carregá-lo para cada variante na seção attributes.

Notas:

- Para saber quais são os atributos obrigatórios de uma variação, devem ser procurados aqueles contendo a tag required = true, se houver uma categoria allow variation mas sem atributos com esta tag, quer dizer que podem ser criados produtos sem variações.  
- Atualmente, os atributos com a tag variation\_attribute não são mostrados na VIP, mas estarão disponíveis no futuro. Convidamos você a começar a completá-los a fim de se preparar para as novas funcionalidades relacionadas com esses atributos!  
- Vamos supor que você quer vender um ventilador variando as cores Marrom e Preto, mas também carregar o código de barras (EAN); para isso, você terá que ir para a API de atributos dessa categoria e corroborar se os atributos Cor e EAN têm as tags allow\_variations e variation\_attribute respectivamente.

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/MLA126186/attributes
```

REsposta

```
[
  {
    "id": "BRAND",
    "name": "Marca",
    "tags": {
      "fixed": true
    },
    "value_type": "string",
    "value_max_length": 60,
    "values": [
      {
        "id": "5601",
        "name": "BGH"
      }
    ],
    "attribute_group_id": "MAIN",
    "attribute_group_name": "Atributos Principales"
  },
  {
    "id": "COLOR",
    "name": "Color",
    "tags": {
      "allow_variations": true,
      "hidden": true
    },
    "type": "color",
    "value_type": "list",
    "values": [
      {
        "id": "52049",
        "name": "Negro",
        "metadata": {
          "rgb": "000000"
        }
      },
      {
        "id": "51993",
        "name": "Rojo",
        "metadata": {
          "rgb": "FF0000"
        }
      },
      {
        "id": "52035",
        "name": "Violeta",
        "metadata": {
          "rgb": "9F00FF"
        }
      },
      {
        "id": "52028",
        "name": "Azul",
        "metadata": {
          "rgb": "1717FF"
        }
      },
      {
        "id": "52005",
        "name": "Marrón",
        "metadata": {
          "rgb": "A0522D"
        }
      },
      {
        "id": "52051",
        "name": "Gris oscuro",
        "metadata": {
          "rgb": "666666"
        }
      },
      {
        "id": "52000",
        "name": "Naranja",
        "metadata": {
          "rgb": "FF8C00"
        }
      },
      {
        "id": "52014",
        "name": "Verde",
        "metadata": {
          "rgb": "0DA600"
        }
      },
      {
        "id": "51994",
        "name": "Rosa",
        "metadata": {
          "rgb": "FCB1BE"
        }
      },
      {
        "id": "283164",
        "name": "Dorado",
        "metadata": {
          "rgb": "FFD700"
        }
      },
      {
        "id": "52007",
        "name": "Amarillo",
        "metadata": {
          "rgb": "FFED00"
        }
      },
      {
        "id": "52053",
        "name": "Plateado",
        "metadata": {
          "rgb": "CBCFD0"
        }
      },
      {
        "id": "283165",
        "name": "Gris claro",
        "metadata": {
          "rgb": "E1E1E1"
        }
      },
      {
        "id": "52021",
        "name": "Celeste",
        "metadata": {
          "rgb": "83DDFF"
        }
      },
      {
        "id": "52055",
        "name": "Blanco",
        "metadata": {
          "rgb": "FFFFFF"
        }
      },
      {
        "id": "51998",
        "name": "Bordó",
        "metadata": {
          "rgb": "830500",
          "parent_id": "51993"
        }
      },
      {
        "id": "51996",
        "name": "Terracota",
        "metadata": {
          "rgb": "C63633",
          "parent_id": "51993"
        }
      },
      {
        "id": "283149",
        "name": "Coral",
        "metadata": {
          "rgb": "FA8072",
          "parent_id": "51993"
        }
      },
      {
        "id": "283148",
        "name": "Coral claro",
        "metadata": {
          "rgb": "F9AC95",
          "parent_id": "51993"
        }
      },
      {
        "id": "52047",
        "name": "Violeta oscuro",
        "metadata": {
          "rgb": "4E0087",
          "parent_id": "52035"
        }
      },
      {
        "id": "283162",
        "name": "Índigo",
        "metadata": {
          "rgb": "7A64C6",
          "parent_id": "52035"
        }
      },
      {
        "id": "52038",
        "name": "Lila",
        "metadata": {
          "rgb": "CC87FF",
          "parent_id": "52035"
        }
      },
      {
        "id": "52036",
        "name": "Lavanda",
        "metadata": {
          "rgb": "D9D2E9",
          "parent_id": "52035"
        }
      },
      {
        "id": "52033",
        "name": "Azul oscuro",
        "metadata": {
          "rgb": "013267",
          "parent_id": "52028"
        }
      },
      {
        "id": "283161",
        "name": "Azul marino",
        "metadata": {
          "rgb": "0F5299",
          "parent_id": "52028"
        }
      },
      {
        "id": "52031",
        "name": "Azul acero",
        "metadata": {
          "rgb": "6FA8DC",
          "parent_id": "52028"
        }
      },
      {
        "id": "52029",
        "name": "Azul claro",
        "metadata": {
          "rgb": "DCECFF",
          "parent_id": "52028"
        }
      },
      {
        "id": "283155",
        "name": "Marrón oscuro",
        "metadata": {
          "rgb": "5D3806",
          "parent_id": "52005"
        }
      },
      {
        "id": "283154",
        "name": "Marrón claro",
        "metadata": {
          "rgb": "AF8650",
          "parent_id": "52005"
        }
      },
      {
        "id": "283153",
        "name": "Suela",
        "metadata": {
          "rgb": "FAEBD7",
          "parent_id": "52005"
        }
      },
      {
        "id": "52001",
        "name": "Beige",
        "metadata": {
          "rgb": "F5F3DC",
          "parent_id": "52005"
        }
      },
      {
        "id": "283152",
        "name": "Chocolate",
        "metadata": {
          "rgb": "9B3F14",
          "parent_id": "52000"
        }
      },
      {
        "id": "283151",
        "name": "Naranja oscuro",
        "metadata": {
          "rgb": "D2691E",
          "parent_id": "52000"
        }
      },
      {
        "id": "283150",
        "name": "Naranja claro",
        "metadata": {
          "rgb": "FDAF20",
          "parent_id": "52000"
        }
      },
      {
        "id": "52003",
        "name": "Piel",
        "metadata": {
          "rgb": "FFE4C4",
          "parent_id": "52000"
        }
      },
      {
        "id": "52019",
        "name": "Verde oscuro",
        "metadata": {
          "rgb": "003D00",
          "parent_id": "52014"
        }
      },
      {
        "id": "283158",
        "name": "Verde musgo",
        "metadata": {
          "rgb": "3F7600",
          "parent_id": "52014"
        }
      },
      {
        "id": "283157",
        "name": "Verde limón",
        "metadata": {
          "rgb": "73E129",
          "parent_id": "52014"
        }
      },
      {
        "id": "52015",
        "name": "Verde claro",
        "metadata": {
          "rgb": "9FF39F",
          "parent_id": "52014"
        }
      },
      {
        "id": "52042",
        "name": "Fucsia",
        "metadata": {
          "rgb": "FF00EC",
          "parent_id": "51994"
        }
      },
      {
        "id": "283163",
        "name": "Rosa chicle",
        "metadata": {
          "rgb": "FF51A8",
          "parent_id": "51994"
        }
      },
      {
        "id": "52045",
        "name": "Rosa pálido",
        "metadata": {
          "rgb": "D06EA8",
          "parent_id": "51994"
        }
      },
      {
        "id": "52043",
        "name": "Rosa claro",
        "metadata": {
          "rgb": "FADBE2",
          "parent_id": "51994"
        }
      },
      {
        "id": "52012",
        "name": "Dorado oscuro",
        "metadata": {
          "rgb": "BF9000",
          "parent_id": "52007"
        }
      },
      {
        "id": "52010",
        "name": "Ocre",
        "metadata": {
          "rgb": "EACB53",
          "parent_id": "52007"
        }
      },
      {
        "id": "283156",
        "name": "Caqui",
        "metadata": {
          "rgb": "F0E68C",
          "parent_id": "52007"
        }
      },
      {
        "id": "52008",
        "name": "Crema",
        "metadata": {
          "rgb": "FFFFE0",
          "parent_id": "52007"
        }
      },
      {
        "id": "52024",
        "name": "Azul petróleo",
        "metadata": {
          "rgb": "1E6E7F",
          "parent_id": "52021"
        }
      },
      {
        "id": "283160",
        "name": "Turquesa",
        "metadata": {
          "rgb": "40E0D0",
          "parent_id": "52021"
        }
      },
      {
        "id": "52022",
        "name": "Agua",
        "metadata": {
          "rgb": "E0FFFF",
          "parent_id": "52021"
        }
      },
      {
        "id": "283159",
        "name": "Cyan",
        "metadata": {
          "rgb": "00FFFF",
          "parent_id": "52021"
        }
      }
    ],
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "PACKAGE_HEIGHT",
    "name": "Altura del paquete",
    "tags": {
      "hidden": true,
      "read_only": true,
      "variation_attribute": true
    },
    "value_type": "number_unit",
    "value_max_length": 60,
    "allowed_units": [
      {
        "id": "mm",
        "name": "mm"
      },
      {
        "id": "cm",
        "name": "cm"
      },
      {
        "id": "in",
        "name": "in"
      },
      {
        "id": "pulgadas",
        "name": "pulgadas"
      },
      {
        "id": "ft",
        "name": "ft"
      },
      {
        "id": "m",
        "name": "m"
      },
      {
        "id": "km",
        "name": "km"
      }
    ],
    "default_unit": "mm",
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "PACKAGE_WIDTH",
    "name": "Ancho del paquete",
    "tags": {
      "hidden": true,
      "read_only": true,
      "variation_attribute": true
    },
    "value_type": "number_unit",
    "value_max_length": 60,
    "allowed_units": [
      {
        "id": "mm",
        "name": "mm"
      },
      {
        "id": "cm",
        "name": "cm"
      },
      {
        "id": "in",
        "name": "in"
      },
      {
        "id": "pulgadas",
        "name": "pulgadas"
      },
      {
        "id": "ft",
        "name": "ft"
      },
      {
        "id": "m",
        "name": "m"
      },
      {
        "id": "km",
        "name": "km"
      }
    ],
    "default_unit": "mm",
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "TURNTABLE",
    "name": "Bandeja Giratoria",
    "tags": {
    },
    "value_type": "boolean",
    "values": [
      {
        "id": "242084",
        "name": "No",
        "metadata": {
          "value": false
        }
      },
      {
        "id": "242085",
        "name": "Sí",
        "metadata": {
          "value": true
        }
      }
    ],
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "NUMBER_OF_PROGRAMS",
    "name": "Cantidad de Programas",
    "tags": {
      "hidden": true
    },
    "value_type": "number",
    "value_max_length": 60,
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "VOLUME_CAPACITY",
    "name": "Capacidad",
    "tags": {
    },
    "value_type": "number_unit",
    "value_max_length": 60,
    "allowed_units": [
      {
        "id": "l",
        "name": "l"
      },
      {
        "id": "cc",
        "name": "cc"
      },
      {
        "id": "ft³",
        "name": "ft³"
      },
      {
        "id": "ml",
        "name": "ml"
      },
      {
        "id": "mm³",
        "name": "mm³"
      }
    ],
    "default_unit": "l",
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "CONVECTION",
    "name": "Convección",
    "tags": {
    },
    "value_type": "boolean",
    "values": [
      {
        "id": "242084",
        "name": "No",
        "metadata": {
          "value": false
        }
      },
      {
        "id": "242085",
        "name": "Sí",
        "metadata": {
          "value": true
        }
      }
    ],
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "TURNTABLE_DIAMETER",
    "name": "Diámetro de Bandeja Giratoria",
    "tags": {
      "hidden": true
    },
    "value_type": "number_unit",
    "value_max_length": 60,
    "allowed_units": [
      {
        "id": "mm",
        "name": "mm"
      },
      {
        "id": "cm",
        "name": "cm"
      },
      {
        "id": "ft",
        "name": "ft"
      },
      {
        "id": "in",
        "name": "in"
      },
      {
        "id": "km",
        "name": "km"
      },
      {
        "id": "m",
        "name": "m"
      },
      {
        "id": "pulgadas",
        "name": "pulgadas"
      }
    ],
    "default_unit": "mm",
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "EAN",
    "name": "EAN",
    "tags": {
      "hidden": true,
      "multivalued": true,
      "variation_attribute": true
    },
    "type": "product_identifier",
    "value_type": "string",
    "value_max_length": 60,
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "FREQUENCY",
    "name": "Frecuencia",
    "tags": {
      "hidden": true
    },
    "value_type": "number_unit",
    "value_max_length": 60,
    "allowed_units": [
      {
        "id": "hz",
        "name": "hz"
      },
      {
        "id": "ghz",
        "name": "ghz"
      },
      {
        "id": "khz",
        "name": "khz"
      },
      {
        "id": "mhz",
        "name": "mhz"
      },
      {
        "id": "rpm",
        "name": "rpm"
      }
    ],
    "default_unit": "hz",
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "MICROWAVE_FUNCTIONS",
    "name": "Funciones",
    "tags": {
      "hidden": true,
      "multivalued": true
    },
    "value_type": "string",
    "value_max_length": 60,
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "GRILL",
    "name": "Grill",
    "tags": {
    },
    "value_type": "boolean",
    "values": [
      {
        "id": "242084",
        "name": "No",
        "metadata": {
          "value": false
        }
      },
      {
        "id": "242085",
        "name": "Sí",
        "metadata": {
          "value": true
        }
      }
    ],
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "GTIN",
    "name": "GTIN",
    "tags": {
      "hidden": true,
      "multivalued": true,
      "variation_attribute": true
    },
    "type": "product_identifier",
    "value_type": "string",
    "value_max_length": 60,
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "JAN",
    "name": "JAN",
    "tags": {
      "hidden": true,
      "variation_attribute": true
    },
    "type": "product_identifier",
    "value_type": "string",
    "value_max_length": 60,
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "LINE",
    "name": "Línea",
    "tags": {
      "hidden": true
    },
    "value_type": "string",
    "value_max_length": 60,
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "PACKAGE_LENGTH",
    "name": "Longitud del paquete",
    "tags": {
      "hidden": true,
      "read_only": true,
      "variation_attribute": true
    },
    "value_type": "number_unit",
    "value_max_length": 60,
    "allowed_units": [
      {
        "id": "mm",
        "name": "mm"
      },
      {
        "id": "cm",
        "name": "cm"
      },
      {
        "id": "in",
        "name": "in"
      },
      {
        "id": "pulgadas",
        "name": "pulgadas"
      },
      {
        "id": "ft",
        "name": "ft"
      },
      {
        "id": "m",
        "name": "m"
      },
      {
        "id": "km",
        "name": "km"
      }
    ],
    "default_unit": "mm",
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "DIMENSIONS",
    "name": "Medidas",
    "tags": {
    },
    "value_type": "string",
    "value_max_length": 60,
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "MODEL",
    "name": "Modelo",
    "tags": {
    },
    "value_type": "string",
    "value_max_length": 60,
    "attribute_group_id": "MAIN",
    "attribute_group_name": "Atributos Principales"
  },
  {
    "id": "ALPHANUMERIC_MODEL",
    "name": "Modelo Alfanumérico",
    "tags": {
      "hidden": true
    },
    "value_type": "string",
    "value_max_length": 60,
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "DETAILED_MODEL",
    "name": "Modelo Detallado",
    "tags": {
      "hidden": true
    },
    "value_type": "string",
    "value_max_length": 60,
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "MPN",
    "name": "MPN",
    "tags": {
      "hidden": true,
      "multivalued": true,
      "variation_attribute": true
    },
    "type": "product_identifier",
    "value_type": "string",
    "value_max_length": 60,
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "POWER_LEVELS",
    "name": "Niveles de Potencia",
    "tags": {
      "hidden": true
    },
    "value_type": "number",
    "value_max_length": 60,
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "PACKAGE_WEIGHT",
    "name": "Peso del paquete",
    "tags": {
      "hidden": true,
      "read_only": true,
      "variation_attribute": true
    },
    "value_type": "number_unit",
    "value_max_length": 60,
    "allowed_units": [
      {
        "id": "mcg",
        "name": "mcg"
      },
      {
        "id": "mg",
        "name": "mg"
      },
      {
        "id": "g",
        "name": "g"
      },
      {
        "id": "oz",
        "name": "oz"
      },
      {
        "id": "lb",
        "name": "lb"
      },
      {
        "id": "kg",
        "name": "kg"
      }
    ],
    "default_unit": "mcg",
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "POWER",
    "name": "Potencia",
    "tags": {
    },
    "value_type": "number_unit",
    "value_max_length": 60,
    "allowed_units": [
      {
        "id": "w",
        "name": "w"
      },
      {
        "id": "btu/h",
        "name": "btu/h"
      },
      {
        "id": "cv",
        "name": "cv"
      },
      {
        "id": "fg",
        "name": "fg"
      },
      {
        "id": "hp",
        "name": "hp"
      },
      {
        "id": "kcal/h",
        "name": "kcal/h"
      },
      {
        "id": "kw",
        "name": "kw"
      },
      {
        "id": "mw",
        "name": "mw"
      },
      {
        "id": "tfr",
        "name": "tfr"
      },
      {
        "id": "va",
        "name": "va"
      }
    ],
    "default_unit": "w",
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "GRILL_POWER",
    "name": "Potencia de Grill",
    "tags": {
      "hidden": true
    },
    "value_type": "number_unit",
    "value_max_length": 60,
    "allowed_units": [
      {
        "id": "w",
        "name": "w"
      },
      {
        "id": "btu/h",
        "name": "btu/h"
      },
      {
        "id": "cv",
        "name": "cv"
      },
      {
        "id": "fg",
        "name": "fg"
      },
      {
        "id": "hp",
        "name": "hp"
      },
      {
        "id": "kcal/h",
        "name": "kcal/h"
      },
      {
        "id": "kw",
        "name": "kw"
      },
      {
        "id": "mw",
        "name": "mw"
      },
      {
        "id": "tfr",
        "name": "tfr"
      },
      {
        "id": "va",
        "name": "va"
      }
    ],
    "default_unit": "w",
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "MIRRORED_DOOR",
    "name": "Puerta Espejada",
    "tags": {
      "hidden": true
    },
    "value_type": "boolean",
    "values": [
      {
        "id": "242084",
        "name": "No",
        "metadata": {
          "value": false
        }
      },
      {
        "id": "242085",
        "name": "Sí",
        "metadata": {
          "value": true
        }
      }
    ],
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "PROGRAMMABLE_KEYS",
    "name": "Teclas Programables",
    "tags": {
      "hidden": true
    },
    "value_type": "boolean",
    "values": [
      {
        "id": "242084",
        "name": "No",
        "metadata": {
          "value": false
        }
      },
      {
        "id": "242085",
        "name": "Sí",
        "metadata": {
          "value": true
        }
      }
    ],
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "MICROWAVE_TYPE",
    "name": "Tipo",
    "tags": {
    },
    "value_type": "list",
    "values": [
      {
        "id": "289784",
        "name": "De Apoyo"
      },
      {
        "id": "289785",
        "name": "De Embutir"
      }
    ],
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "CHILD_SAFETY_LOCK",
    "name": "Traba de Seguridad para Niños",
    "tags": {
      "hidden": true
    },
    "value_type": "boolean",
    "values": [
      {
        "id": "242084",
        "name": "No",
        "metadata": {
          "value": false
        }
      },
      {
        "id": "242085",
        "name": "Sí",
        "metadata": {
          "value": true
        }
      }
    ],
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "UPC",
    "name": "UPC",
    "tags": {
      "hidden": true,
      "multivalued": true,
      "variation_attribute": true
    },
    "type": "product_identifier",
    "value_type": "string",
    "value_max_length": 60,
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  },
  {
    "id": "VOLTAGE",
    "name": "Voltaje",
    "tags": {
      "hidden": true
    },
    "value_type": "list",
    "values": [
      {
        "id": "198812",
        "name": "110V / 220V"
      },
      {
        "id": "198813",
        "name": "220V"
      },
      {
        "id": "198814",
        "name": "110V"
      }
    ],
    "attribute_group_id": "DFLT",
    "attribute_group_name": "Otros"
  }
]
```

Depois de checar a configuração na API de atributos, você deverá criar um JSON de anúncio como o seguinte.

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -d
{  
   "listing_type_id":"gold_special",
   "pictures":[  
      {  
         "id":"553111-MLA20482692355_112015"
      }
   ],
   "title":"Item de testeo",
   "available_quantity":4,
   "category_id":"MLA378496",
   "buying_mode":"buy_it_now",
   "currency_id":"ARS",
   "condition":"not_specified",
   "site_id":"MLA",
   "price":100,
   "variations":[  
      {  
         "attribute_combinations":[  
            {  
               "name":"Color",
               "value_id":"52049",
               "value_name":"Negro"
            }
         ],
         "price":100,
         "available_quantity":4,
         "attributes":[  
            {  
               "id":"EAN",
               "value_name":"4006381333931"
            }
         ],
         "sold_quantity":0,
         "picture_ids":[  
            "553111-MLA20482692355_112015"
         ]
      },
      {  
         "attribute_combinations":[  
            {  
               "name":"Color",
               "value_id":"52005",
               "value_name":"Marrón"
            }
         ],
         "price":100,
         "available_quantity":4,
         "attributes":[  
            {  
               "id":"EAN",
               "value_name":"9780471117094"
            }
         ],
         "sold_quantity":0,
         "picture_ids":[  
            "553111-MLA20482692355_112015"
         ]
      }
   ]
}
http://api.mercadolibre.com/items
```

Resposta

```
{  
   "id":"MLA657381404",
   "site_id":"MLA",
   "title":"Item De Testeo",
   "subtitle":null,
   "seller_id":222576250,
   "category_id":"MLA378496",
   "official_store_id":null,
   "price":100,
   "base_price":100,
   "original_price":null,
   "currency_id":"ARS",
   "initial_quantity":8,
   "available_quantity":8,
   "sold_quantity":0,
   "buying_mode":"buy_it_now",
   "listing_type_id":"gold_special",
   "start_time":"2017-03-10T21:18:09.588Z",
   "stop_time":"2037-03-05T21:18:09.588Z",
   "end_time":"2037-03-05T21:18:09.588Z",
   "expiration_time":"2017-05-29T21:18:09.651Z",
   "condition":"not_specified",
   "permalink":"http://articulo.mercadolibre.com.ar/MLA-657381404-item-de-testeo-_JM",
   "thumbnail":"http://mla-s2-p.mlstatic.com/553111-MLA20482692355_112015-I.jpg",
   "secure_thumbnail":"https://mla-s2-p.mlstatic.com/553111-MLA20482692355_112015-I.jpg",
   "pictures":[  
      {  
         "id":"553111-MLA20482692355_112015",
         "url":"http://mla-s2-p.mlstatic.com/553111-MLA20482692355_112015-O.jpg",
         "secure_url":"https://mla-s2-p.mlstatic.com/553111-MLA20482692355_112015-O.jpg",
         "size":"320x320",
         "max_size":"320x320",
         "quality":""
      }
   ],
   "video_id":null,
   "descriptions":[  

   ],
   "accepts_mercadopago":true,
   "non_mercado_pago_payment_methods":[  

   ],
   "shipping":{  
      "mode":"not_specified",
      "local_pick_up":false,
      "free_shipping":false,
      "methods":[  

      ],
      "dimensions":null,
      "tags":[  
         "me2_available"
      ],
      "logistic_type":"not_specified"
   },
   "international_delivery_mode":"none",
   "seller_address":{  
      "id":189626559,
      "comment":"",
      "address_line":"santa fe 1000",
      "zip_code":"1641",
      "city":{  
         "id":"",
         "name":"Acassuso"
      },
      "state":{  
         "id":"AR-B",
         "name":"Buenos Aires"
      },
      "country":{  
         "id":"AR",
         "name":"Argentina"
      },
      "latitude":-34.4817565,
      "longitude":-58.5056779,
      "search_location":{  
         "neighborhood":{  
            "id":"TUxBQkFDQTMyNzNa",
            "name":"Acassuso"
         },
         "city":{  
            "id":"TUxBQ1NBTjg4ZmJk",
            "name":"San Isidro"
         },
         "state":{  
            "id":"TUxBUEdSQWU4ZDkz",
            "name":"Bs.As. G.B.A. Norte"
         }
      }
   },
   "seller_contact":null,
   "location":{  

   },
   "geolocation":{  
      "latitude":-34.4817565,
      "longitude":-58.5056779
   },
   "coverage_areas":[  

   ],
   "attributes":[  
      {  
         "id":"FAN_TYPE",
         "name":"Tipo de Ventilador",
         "value_id":"291719",
         "value_name":"De Techo",
         "attribute_group_id":"DFLT",
         "attribute_group_name":"Otros"
      },
      {  
         "id":"BRAND",
         "name":"Marca",
         "value_id":"86416",
         "value_name":"Eiffel",
         "attribute_group_id":"MAIN",
         "attribute_group_name":"Atributos Principales"
      }
   ],
   "warnings":[  

   ],
   "listing_source":"",
   "variations":[  
      {  
         "id":14979332589,
         "attribute_combinations":[  
            {  
               "id":"COLOR",
               "name":"Color",
               "value_id":"52049",
               "value_name":"Negro"
            }
         ],
         "price":100,
         "available_quantity":4,
         "sold_quantity":0,
         "picture_ids":[  
            "553111-MLA20482692355_112015"
         ],
         "seller_custom_field":null,
         "catalog_product_id":null,
         "attributes":[  
            {  
               "id":"EAN",
               "name":"EAN",
               "value_id":null,
               "value_name":"4006381333931"
            }
         ]
      },
      {  
         "id":14979332592,
         "attribute_combinations":[  
            {  
               "id":"COLOR",
               "name":"Color",
               "value_id":"52005",
               "value_name":"Marrón"
            }
         ],
         "price":100,
         "available_quantity":4,
         "sold_quantity":0,
         "picture_ids":[  
            "553111-MLA20482692355_112015"
         ],
         "seller_custom_field":null,
         "catalog_product_id":null,
         "attributes":[  
            {  
               "id":"EAN",
               "name":"EAN",
               "value_id":null,
               "value_name":"9780471117094"
            }
         ]
      }
   ],
   "status":"active",
   "sub_status":[  

   ],
   "tags":[  
      "immediate_payment"
   ],
   "warranty":null,
   "catalog_product_id":null,
   "domain_id":null,
   "seller_custom_field":null,
   "parent_item_id":null,
   "differential_pricing":null,
   "deal_ids":[  

   ],
   "automatic_relist":false,
   "date_created":"2017-03-10T21:18:09.763Z",
   "last_updated":"2017-03-10T21:18:09.763Z"
}
```

Notas:

- Há propriedades obrigatórias a serem enviadas em cada variação. Elas são: price, available\_quantity, pictures e attribute\_combinations.  
- A quantidade máxima de imagens que podem ser enviadas por variação é definida pelo campo max\_pictures\_per\_item\_var na API de Categorias, exemplo: https://api.mercadolibre.com/categories/MLA1577  
- Os attribute\_combinations de todas as variações devem conter os mesmos atributos, mas combinações de valores não devem se repetir.   
- Se você enviar um atributo que não pertece à categoria, será ignorado, o qual pode gerar que duas variações fiquem com os mesmos atributos e apresentar variações duplicadas.  
- Você pode adicionar um atributo com a tag allow\_variations na propriedade attributes do item.  
- Você pode adicionar um atributo com a tag variation\_attribute na propriedade attributes do produto.

**Exemplo:**

- Se você quer utilizar o tamanho 46 e ele não está entre os valores possíveis para o atributo Tamanho da categoria MLU185734, mesmo assim, pode utilizá-lo como "value\_name": "46", como mostrado abaixo:

```
	"variations": [{
		"attribute_combinations": [{
			"id": "103000",
			"value_id": "4883e91",
                        "value_struct": null,
                        "values": [
                        {
                            "id": "4883e91",
                            "name": null,
                            "struct": null
                        }
                        ]
		}, {
			"id": "11000",
			"value_id": "10295e4",
                        "values": [
                        {
                            "id": "10295e4",
                            "name": null,
                            "struct": null
                        }
                        ]
		}],
		"available_quantity": 17,
		"price": 1299.0,
		"seller_custom_field": "611111",
		"picture_ids": ["https://s-media-cache-ak0.pinimg.com/736x/63/9c/a0/639ca03b5ca79e73002b4f2d4776d03b.jpg"
		]
	}, {
		"attribute_combinations": [{
			"id": "103000",
			"value_id": "86e5356",
                        "values": [
                        {
                            "id": "86e5356",
                            "name": null,
                            "struct": null
                        }
                        ]     
		}, {
			"id": "11000",
			"value_id": "10295e4",
                        "values": [
                        {
                            "id": "10295e4",
                            "name": null,
                            "struct": null
                        }
                        ]
		}],
		"available_quantity": 12,
		"price": 1299.0,
		"seller_custom_field": "6131111",
		"picture_ids": ["https://s-media-cache-ak0.pinimg.com/736x/63/9c/a0/639ca03b5ca79e73002b4f2d4776d03b.jpg"
			]
	}, {
		"attribute_combinations": [{
			"id": "103000",
			"value_name": "46",
                        "values": [
                        {
                            "id": null,
                            "name": "46",
                            "struct": null
                        }
                        ]     
		}, {
			"id": "11000",
			"value_id": "10295e4",
                        "values": [
                        {
                            "id": "10295e4",
                            "name": null,
                            "struct": null
                        }
                        ]
		}],
		"available_quantity": 21,
		"price": 1299.0,
		"seller_custom_field": "611111",
		"picture_ids": ["https://s-media-cache-ak0.pinimg.com/736x/63/9c/a0/639ca03b5ca79e73002b4f2d4776d03b.jpg"
			]
	}]
```

Para maiores informações, sugerimos revisar a documentação de [Atributos](../pt_br/atributos/).

  

## Atributos requeridos

Agora quando realice um novo anúncio, deverá ler o tag “required:true” para identificar os atributos que são requeridos por categoria.

Importante:

Caso o atributo requerido não seja enviado, você receberá como resposta o seguinte erro (400 item.attributes.missing\_required – Não foi enviado o atributo requerido).

```
{
	"message": "Validation error",
	"error": "validation_error",
	"status": 400,
	"cause": [{
		"code": "item.attributes.missing_required",
		"message": "One or more required attributes are not present in the item. Check the attribute is present in the attributes list or in the variations attributes_combination or attributes."
	}]
}
```

Notas:

- No caso que o atributo não seja requerido, o tag required não aparecerá.

## Consultar variações

Parabéns, você já anunciou seu produto com variações! Agora vamos lhe ensinar as duas formas que existem para consultá-las. Uma delas é olhando a seção variations nas informações do produto:

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA658778048?attributes=variations
```

Resposta:

```
{
    "variations": [
        {
            "id": 15093610263,
            "attribute_combinations": [
                {
                    "id": "COLOR",
                    "name": "Color",
                    "value_id": "52000",
                    "value_name": "Naranja"
                }
            ],
            "price": 100,
            "available_quantity": 4,
            "sold_quantity": 0,
            "picture_ids": [
                "553111-MLA20482692355_112015"
            ],
            "seller_custom_field": null,
            "catalog_product_id": null
        }
    ]
}
```

Ou com a seguinte chamada, com a qual a resposta anterior será diretamente filtrada para mostrar apenas as variações:

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/variations
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA658778048/variations
```

Resposta:

```
[
  {
    "id": 15092589430,
    "attribute_combinations": [
      {
        "id": "COLOR",
        "name": "Color",
        "value_id": "52005",
        "value_name": "Marrón"
      }
    ],
    "price": 100,
    "available_quantity": 4,
    "sold_quantity": 0,
    "picture_ids": [
      "553111-MLA20482692355_112015"
    ],
    "seller_custom_field": null,
    "catalog_product_id": null
  },
  {
    "id": 15092589427,
    "attribute_combinations": [
      {
        "id": "COLOR",
        "name": "Color",
        "value_id": "52049",
        "value_name": "Negro"
      }
    ],
    "price": 100,
    "available_quantity": 4,
    "sold_quantity": 0,
    "picture_ids": [
      "553111-MLA20482692355_112015"
    ],
    "seller_custom_field": null,
    "catalog_product_id": null
  }
]
```

Quando você já tiver os Ids de cada variação, uma forma de consultar uma em particular é adicionando variation\_id no final da chamada anterior, como é mostrado a seguir.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID/variations/$VARIATION_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA658778048/variations/15092589430
```

Resposta

```
{
  "id": 15092589430,
  "attribute_combinations": [
    {
      "id": "COLOR",
      "name": "Color",
      "value_id": "52028",
      "value_name": "Celeste Oscuro"
    }
  ],
  "price": 100,
  "available_quantity": 4,
  "sold_quantity": 0,
  "picture_ids": [
    "553111-MLA20482692355_112015",
    "629425-MLA25446587248_032017"
  ],
  "seller_custom_field": null,
  "catalog_product_id": null,
  "attributes": [
    {
      "id": "EAN",
      "name": "EAN",
      "value_id": null,
      "value_name": "7794940000796"
    },
    {
      "id": "UPC",
      "name": "UPC",
      "value_id": null,
      "value_name": "7792931000015"
    }
  ]
}
```

Nota:

Para ver a propriedade attributes dentro de cada variação, terá que adicionar o parâmetro include\_attributes=all à URL de consulta.

Exemplo:

```
https://api.mercadolibre.com/items/MLA640992661?include_attributes=all
```

Nota:

No caso que deseje consultar o seller custom field deverá enviar o parâmetro "include\_attributes=all" na chamada (https://api.mercadolibre.com/items/MLA000000?include\_attributes=all).

## Adicionar novas variações

Se você adicionou uma nova variante do seu produto ao estoque já anunciado, poderá adicionar uma nova variação.

Muito bem! Você poderá ver anunciada a nova variante no produto. Outra forma de adicionar uma variação é fazer um PUT no produto, listando na propriedade variations os Ids das variações já existentes, bem como a variação a ser criada.

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json' -d
{
    "attribute_combinations": [
       {
          "id": "COLOR",
          "value_id": "52035"
        }
    ],
    "price": 100,
    "available_quantity": 10,
    "sold_quantity": 0,
    "picture_ids": [
      "553111-MLA20482692355_112015"
    ]
  }
https://api.mercadolibre.com/items/MLA658778048/variations
```

## Modificar variações

Agora que você já aprendeu a anunciar e consultar produtos com variações, pode acontecer que, em algum momento, tenha que realizar alterações a fim de atualizar estoque, preços, adicionar variantes do seu produto ou alterar o valor de algum atributo anunciado. Seguindo o exemplo de fãs, mostramos anteriormente como publicar um fã que varia de acordo com a cor. Agora imagine que, além de variar por cor, você deseja que ele varie por voltagem, para isso você deve fazer um PUT, como no exemplo abaixo, enviando todas as variações e adicionando o atributo Voltage no campo attribute\_combinations de cada variação.

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json' -d
{
"variations": [
    {
      "id": 15092589430,
      "attribute_combinations": [
        {
          "id": "COLOR",
          "value_id": "52005"
        },
        {
          "id": "VOLTAGE",
          "value_id": "198812"
        }
      ]
    },
    {
      "id": 15093506680,
      "attribute_combinations": [
        {
          "id": "COLOR",
          "value_id": "52035"
        },
        {
          "id": "VOLTAGE",
          "value_id": "198813"
        }
      ]
    }
  ]
}
https://api.mercadolibre.com/items/MLA658778048
```

Também pode ocorrer que você deseje alterar ou eliminar um atributo pelo qual varia seu item, para realizar essa ação você deverá verificar que as variantes a modificar não possuam vendas.

Nota:

Para variantes com vendas unicamente será possível adicionar novos atributos sem alterar nem eliminar os existentes.   
Tomando como exemplo ventiladores, vamos supor que seus ventiladores já não variam por voltagem e, ao mesmo tempo, seu ventilador cor lilás, na verdade é lilás escuro, para fazer essas mudanças você terá que fazer um PUT, como o do exemplo a seguir, encaminhando todas as variantes com o atributo voltagem com value id e value name null para ser apagado e, por sua vez, a variante que corresponde à cor lilás com o value\_name alterado para lilás escuro.

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json' -d 
{
"variations": [
    {
      "id": 15092589430,
      "attribute_combinations": [
        {
          "id": "COLOR",
          "value_id": "52005",
          "value_name": null,
          "value_struct": null,
          "values": [
           {
               "id": "52005",
               "name": null,
               "struct": null
           }
          ]
        },
        {
          "id": "VOLTAGE",
          "value_id": null,
          "value_name": null,
          "value_struct": null,
          "values": [
           {
               "id": null,
               "name": null,
               "struct": null
           }
          ]
        }
      ]
    },
    {
      "id": 15093506680,
      "attribute_combinations": [
        {
          "id": "COLOR",
          "value_id": "52035",
          "value_name": "Violeta Oscuro",
          "value_struct": null,
          "values": [
           {
               "id": "52035",
               "name": "Violeta Oscuro",
               "struct": null
           }
          ]
        },
        {
          "id": "VOLTAGE",
          "value_id": null,
          "value_name": null,
          "value_struct": null,
          "values": [
           {
               "id": null,
               "name": null,
               "struct": null
           }
          ]
         }
      ]
    }
  ]
}
https://api.mercadolibre.com/items/MLA658778048
```

Resposta:

```
[
 {
   "id": 15092589430,
   "attribute_combinations": [
     {
       "id": "COLOR",
       "name": "Color",
       "value_id": "52005",
       "value_name": "Marrón",
       "value_struct": null,
       "values": [
           {
               "id": "52005",
               "name": "Marrón",
               "struct": null
           }
       ]
     }
   ],
   "price": 100,
   "available_quantity": 4,
   "sold_quantity": 0,
   "picture_ids": [
     "553111-MLA20482692355_112015",
     "629425-MLA25446587248_032017"
   ],
   "seller_custom_field": null,
   "catalog_product_id": null,
   "attributes": [
     {
       "id": "EAN",
       "name": "EAN",
       "value_id": null,
       "value_name": "7794940000796",
       "value_struct": null,
       "values": [
           {
               "id": null,
               "name": "7794940000796",
               "struct": null
           }
       ]
     },
     {
       "id": "UPC",
       "name": "UPC",
       "value_id": null,
       "value_name": "7792931000015",
       "value_struct": null,
       "values": [
           {
               "id": null,
               "name": "7792931000015",
               "struct": null
           }
       ]
     }
   ]
 },{
   "id": 15093506680,
   "attribute_combinations": [
     {
       "id": "COLOR",
       "name": "Color",
       "value_id": "52035",
       "value_name": "Violeta Oscuro",
       "value_struct": null,
       "values": [
           {
               "id": "52035",
               "name": "Violeta Oscuro",
               "struct": null
           }
       ]
     }
   ],
   "price": 100,
   "available_quantity": 4,
   "sold_quantity": 0,
   "picture_ids": [
     "553111-MLA20482692355_112015",
     "629425-MLA25446587248_032017"
   ],
   "seller_custom_field": null,
   "catalog_product_id": null,
   "attributes": [
     {
       "id": "EAN",
       "name": "EAN",
       "value_id": null,
       "value_name": "7794940000796",
       "value_struct": null,
       "values": [
           {
               "id": null,
               "name": "7794940000796",
               "struct": null
           }
       ]
     },
     {
       "id": "UPC",
       "name": "UPC",
       "value_id": null,
       "value_name": "7792931000015",
       "value_struct": null,
       "values": [
           {
               "id": null,
               "name": "7792931000015",
               "struct": null
           }
       ]
     }
   ]
 }
]
```

Nota:

Sempre que quiser alterar uma variante, você deverá enviar o ID. Caso você não o envie, a variante será apagada e será criada uma nova com as informações incluídas no request, assim desaparecerá todo o histórico de vendas ou gerará um erro se não estiverem preenchidos todos os campos necessários para sua criação.

Exemplo:

Temos as variantes a seguir:

```
"variations": [
        {
            "id": 30078896884,
            "attribute_combinations": [
                {
                    "id": "COLOR",
                    "name": "Color",
                    "value_id": "52014",
                    "value_name": "Verde",
                    "value_struct": null,
                    "values": [
                      {
                               "id": "52014",
                               "name": "Verde",
                               "struct": null
                      }
                    ]
                },
                {
                    "id": "SIZE",
                    "name": "Talle",
                    "value_id": null,
                    "value_name": "M",
                    "value_struct": null,
                    "values": [
                      {
                               "id": null,
                               "name": "M",
                               "struct": null
                      }
                    ]
                }
            ],
            "price": 47.81,
            "available_quantity": 2
        },
        
{
            "id": 30078896888,
            "attribute_combinations": [
                {
                    "id": "COLOR",
                    "name": "Color",
                    "value_id": "52014",
                    "value_name": "Verde",
                    "value_struct": null,
                    "values": [
                      {
                               "id": "52014",
                               "name": "Verde",
                               "struct": null
                      }
                    ]                  
                },
                {
                    "id": "SIZE",
                    "name": "Talle",
                    "value_id": null,
                    "value_name": " L",
                    "value_struct": null,
                    "values": [
                      {
                               "id": null,
                               "name": "L",
                               "struct": null
                      }
                    ]
                }
            ],
            "price": 47.81,
            "available_quantity": 2
        }
    ]
```

Se você quiser alterar a variante 30078896888 e não enviar seu id, como no exemplo a seguir:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d 
{
	"variations": [{
			"id": 30078896884
		},
		{
			"attribute_combinations": [{
					"id": "COLOR",
					"name": "Color",
					"value_id": "52014",
					"value_name": "Verde",
					"value_struct": null,
					"values": [{
						"id": "52014",
						"name": "Verde",
						"struct": null
					}]
				},
				{
					"id": "SIZE",
					"name": "Talle",
					"value_id": null,
					"value_name": "L",
					"value_struct": null,
					"values": [{
						"id": null,
						"name": "L",
						"struct": null
					}]
				}
			],
			"price": 47.81,
			"available_quantity": 8 - & gt;Se pretende modificar el stock
		}
	]
}
https://api.mercadolibre.com/items/$ITEM_ID
```

O request fará com que a variante 30078896888 seja apagada (devido a que seu ID não foi enviado) e será criada uma nova variante com a cor verde e o tamanho “L” (que não terá relação com a variante apagada, apesar de ter os mesmos atributos). A maneira correta de realizar a operação é:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d
{
	"variations": [{
			"id": 30078896884
		},
		{
			"id": 30078896888,
			"available_quantity": 8 - > Se pretende modificar el stock
		}
	]
}
https://api.mercadolibre.com/items/$ITEM_ID
```

## Adicionar ou modificar atributos próprios de cada variação

Além disso, é possível que, a qualquer momento, você queira adicionar mais atributos próprios de uma ou diversas variações em particular. Ainda no exemplo de Ventiladores, até agora, cada variação tem as informações do código de barras (EAN). Vamos supor que agora temos as informações de outro código de barras, o UPC para algumas variações, e queremos adicioná-lo. Para isso há duas opções: fazer um PUT, como no exemplo abaixo, enviando todas as variações mas adicionando o campo attributes nas variações em que queremos adicionar o atributo UPC.

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json' -d
{
	"variations": [{
			"id": 23217493044
		},
		{
			"id": 23217493049,
			"attributes": [{
				"id": "PACKAGE_HEIGHT",
				"value_name": "25 cm"
			}, {
				"id": "PACKAGE_WIDTH",
				"value_name": "17 cm"
			}, {
				"id": "SELLER_SKU",
				"value_name": "Prueba3_xxx"
			}]
		}
	]
}
https://api.mercadolibre.com/items/MLM623075370
```

Resposta

```
{
    "id": "MLM623075370",
    "site_id": "MLM",
    "title": "Item De Prueba - No Ofertar",
    "subtitle": null,
    "seller_id": 310695640,
    "category_id": "MLM174913",
    "official_store_id": null,
    "price": 1,
    "base_price": 1,
    "original_price": null,
    "currency_id": "MXN",
    "initial_quantity": 2,
    "available_quantity": 2,
    "sold_quantity": 0,
    "sale_terms": [],
    "buying_mode": "buy_it_now",
    "listing_type_id": "gold_pro",
    "start_time": "2018-04-24T16:43:02.000Z",
    "historical_start_time": "2018-04-24T16:43:02.000Z",
    "stop_time": "2038-04-19T04:00:00.000Z",
    "end_time": "2038-04-19T04:00:00.000Z",
    "expiration_time": "2018-07-13T17:01:35.847Z",
    "condition": "new",
    "permalink": "http://articulo.mercadolibre.com.mx/MLM-623075370-item-de-prueba-no-ofertar-_JM",
    "thumbnail": "http://mlm-s1-p.mlstatic.com/965478-MLM27243332493_042018-I.jpg",
    "secure_thumbnail": "https://mlm-s1-p.mlstatic.com/965478-MLM27243332493_042018-I.jpg",
    "pictures": [
        {
            "id": "965478-MLM27243332493_042018",
            "url": "http://mlm-s1-p.mlstatic.com/965478-MLM27243332493_042018-O.jpg",
            "secure_url": "https://mlm-s1-p.mlstatic.com/965478-MLM27243332493_042018-O.jpg",
            "size": "500x500",
            "max_size": "1000x1000",
            "quality": ""
        }
    ],
    "video_id": null,
    "descriptions": [],
    "accepts_mercadopago": true,
    "non_mercado_pago_payment_methods": [],
    "shipping": {
        "mode": "not_specified",
        "local_pick_up": true,
        "free_shipping": false,
        "methods": [],
        "dimensions": null,
        "tags": [],
        "logistic_type": "not_specified",
        "store_pick_up": false
    },
    "international_delivery_mode": "none",
    "seller_address": {
        "id": 855164029,
        "comment": "",
        "address_line": "Test Address 123",
        "zip_code": "",
        "city": {
            "id": "",
            "name": "Ciudad de Mexico"
        },
        "state": {
            "id": "MX-DIF",
            "name": "Distrito Federal"
        },
        "country": {
            "id": "MX",
            "name": "Mexico"
        },
        "latitude": "",
        "longitude": "",
        "search_location": {
            "neighborhood": {
                "id": "",
                "name": ""
            },
            "city": {
                "id": "",
                "name": ""
            },
            "state": {
                "id": "TUxNUERJUzYwOTQ",
                "name": "Distrito Federal"
            }
        }
    },
    "seller_contact": null,
    "location": {},
    "geolocation": {
        "latitude": "",
        "longitude": ""
    },
    "coverage_areas": [],
    "attributes": [
        {
            "id": "MODEL",
            "name": "Modelo",
            "value_id": null,
            "value_name": "Mosaic",
            "value_struct": null,
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        },
        {
            "id": "BRAND",
            "name": "Marca",
            "value_id": null,
            "value_name": "ROHO",
            "value_struct": null,
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        },
        {
            "id": "ITEM_CONDITION",
            "name": "Condición del ítem",
            "value_id": "2230284",
            "value_name": "Nuevo",
            "value_struct": null,
            "attribute_group_id": "OTHERS",
            "attribute_group_name": "Otros"
        }
    ],
    "warnings": [],
    "listing_source": "",
    "variations": [
        {
            "id": 23217493044,
            "attribute_combinations": [
                {
                    "id": null,
                    "name": "Tamaño",
                    "value_id": null,
                    "value_name": "16\" x 16\" (40 x 40 cm)",
                    "value_struct": null
                }
            ],
            "price": 1,
            "available_quantity": 1,
            "sold_quantity": 0,
            "sale_terms": [],
            "picture_ids": [
                "965478-MLM27243332493_042018"
            ],
            "seller_custom_field": "Datos_interno_variacion_xxxx",
            "catalog_product_id": null,
            "attributes": [
                {
                    "id": "SELLER_SKU",
                    "name": "SKU ",
                    "value_id": null,
                    "value_name": "Prueba-xxx",
                    "value_struct": null
                }
            ]
        },
        {
            "id": 23217493049,
            "attribute_combinations": [
                {
                    "id": null,
                    "name": "Tamaño",
                    "value_id": null,
                    "value_name": "18\" x 18\" (45 x 45 cm)",
                    "value_struct": null
                }
            ],
            "price": 1,
            "available_quantity": 1,
            "sold_quantity": 0,
            "sale_terms": [],
            "picture_ids": [
                "965478-MLM27243332493_042018"
            ],
            "seller_custom_field": "Datos_interno_variacion_xxxx1",
            "catalog_product_id": null,
            "attributes": [
                {
                    "id": "PACKAGE_HEIGHT",
                    "name": "Altura del paquete",
                    "value_id": null,
                    "value_name": "25 cm",
                    "value_struct": {
                        "unit": "cm",
                        "number": 25
                    }
                },
                {
                    "id": "PACKAGE_WIDTH",
                    "name": "Ancho del paquete",
                    "value_id": null,
                    "value_name": "17 cm",
                    "value_struct": {
                        "unit": "cm",
                        "number": 17
                    }
                },
                {
                    "id": "SELLER_SKU",
                    "name": "SKU ",
                    "value_id": null,
                    "value_name": "Prueba3_xxx",
                    "value_struct": null
                }
            ]
        }
    ],
    "status": "active",
    "sub_status": [],
    "tags": [
        "test_item",
        "good_quality_picture",
        "immediate_payment"
    ],
    "warranty": "1 Año de garantia directamente con nosotros contra defectos de fabrica y mal funcionamiento.\n12 meses.",
    "catalog_product_id": null,
    "domain_id": null,
    "seller_custom_field": "Datos_interno_item",
    "parent_item_id": null,
    "differential_pricing": null,
    "deal_ids": [],
    "automatic_relist": false,
    "date_created": "2018-04-24T16:43:02.000Z",
    "last_updated": "2018-04-24T17:01:35.883Z",
    "total_listing_fee"
```

Também pode acontecer que você queira alterar o valor de um atributo próprio de cada variação. Vamos supor que queremos alterar o valor do atributo EAN de uma variação em particular. Para isso deve fazer um PUT, como no exemplo abaixo, especificando a variação que você quer alterar e, no campo attributes, deverá enviar todos os atributos, e para o atributo EAN o campo value\_name modificado.

Ou também pode fazer um PUT, como no exemplo.

Abaixo, para cada variação separadamente.

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json' -d
{
   "variations":[
      {
         "id":"15092589430",
         "attributes":[
            {
               "id":"EAN",
               "name":"EAN",
               "value_name":"7792931000015",
               "value_struct": null,
                    "values": [
                      {
                               "id": null,
                               "name": "7792931000015",
                               "struct": null
                      }
                    ]

            },
            {
               "id":"GTIN",
               "name":"GTIN",
               "value_name":"7792931000015",
               "value_struct": null,
                    "values": [
                      {
                               "id": null,
                               "name": "7792931000015",
                               "struct": null
                      }
                 ]
            }
         ]
      }
   ]
}
https://api.mercadolibre.com/items/MLA658778048
```

Resposta:

```
{
    "id": "MLA658778048",
    "site_id": "MLA",
    "title": "Item De Testeo",
    "subtitle": null,
    "seller_id": 247212006,
    "category_id": "MLA378496",
    "official_store_id": null,
    "price": 100,
    "base_price": 100,
    "original_price": null,
    "currency_id": "ARS",
    "initial_quantity": 4,
    "available_quantity": 4,
    "sold_quantity": 0,
    "buying_mode": "buy_it_now",
    "listing_type_id": "gold_special",
    "start_time": "2017-03-20T15:44:00.000Z",
    "stop_time": "2037-03-15T15:44:00.000Z",
    "end_time": "2037-03-15T15:44:00.000Z",
    "expiration_time": "2017-06-17T14:55:54.306Z",
    "condition": "not_specified",
    "permalink": "http://articulo.mercadolibre.com.ar/MLA-658778048-item-de-testeo-_JM",
    "thumbnail": "http://mla-s2-p.mlstatic.com/553111-MLA20482692355_112015-I.jpg",
    "secure_thumbnail": "https://mla-s2-p.mlstatic.com/553111-MLA20482692355_112015-I.jpg",
    "pictures": [
        {
            "id": "553111-MLA20482692355_112015",
            "url": "http://mla-s2-p.mlstatic.com/553111-MLA20482692355_112015-O.jpg",
            "secure_url": "https://mla-s2-p.mlstatic.com/553111-MLA20482692355_112015-O.jpg",
            "size": "320x320",
            "max_size": "320x320",
            "quality": ""
        },
        {
            "id": "629425-MLA25446587248_032017",
            "url": "http://mla-s2-p.mlstatic.com/629425-MLA25446587248_032017-O.jpg",
            "secure_url": "https://mla-s2-p.mlstatic.com/629425-MLA25446587248_032017-O.jpg",
            "size": "384x500",
            "max_size": "922x1200",
            "quality": ""
        }
    ],
    "video_id": null,
    "descriptions": [],
    "accepts_mercadopago": true,
    "non_mercado_pago_payment_methods": [],
    "shipping": {
        "mode": "not_specified",
        "local_pick_up": false,
        "free_shipping": false,
        "methods": null,
        "dimensions": null,
        "tags": [],
        "logistic_type": "not_specified"
    },
    "international_delivery_mode": "none",
    "seller_address": {
        "id": 265953311,
        "comment": "",
        "address_line": "Test Address 123",
        "zip_code": "1414",
        "city": {
            "id": "",
            "name": "Palermo"
        },
        "state": {
            "id": "AR-C",
            "name": "Capital Federal"
        },
        "country": {
            "id": "AR",
            "name": "Argentina"
        },
        "latitude": "",
        "longitude": "",
        "search_location": {
            "neighborhood": {
                "id": "TUxBQlBBTDI1MTVa",
                "name": "Palermo"
            },
            "city": {
                "id": "TUxBQ0NBUGZlZG1sYQ",
                "name": "Capital Federal"
            },
            "state": {
                "id": "TUxBUENBUGw3M2E1",
                "name": "Capital Federal"
            }
        }
    },
    "seller_contact": null,
    "location": {},
    "geolocation": {
        "latitude": "",
        "longitude": ""
    },
    "coverage_areas": [],
    "attributes": [
        {
            "id": "FAN_TYPE",
            "name": "Tipo de Ventilador",
            "value_id": "291719",
            "value_name": "De Techo",
            "value_struct": null,
            "values": [
             {
                      "id": "291719",
                      "name": "De Techo",
                      "struct": null
             }
             ],
            "attribute_group_id": "DFLT",
            "attribute_group_name": "Otros"
        },
        {
            "id": "HEIGHT_ADJUSTABLE",
            "name": "Altura Regulable",
            "value_id": "242084",
            "value_name": "No",
            "value_struct": null,
            "values": [
             {
                      "id": "242084",
                      "name": "No",
                      "struct": null
             }
             ],
            "attribute_group_id": "DFLT",
            "attribute_group_name": "Otros"
        },
        {
            "id": "LATERAL_OSCILLATION",
            "name": "Oscilación Lateral",
            "value_id": "242084",
            "value_name": "No",
            "value_struct": null,
            "values": [
             {
                      "id": "242084",
                      "name": "No",
                      "struct": null
             }
             ],
            "attribute_group_id": "DFLT",
            "attribute_group_name": "Otros"
        },
        {
            "id": "REMOTE_CONTROL",
            "name": "Control Remoto",
            "value_id": "242084",
            "value_name": "No",
            "value_struct": null,
            "values": [
             {
                      "id": "242084",
                      "name": "No",
                      "struct": null
             }
             ],
            "attribute_group_id": "DFLT",
            "attribute_group_name": "Otros"
        },
        {
            "id": "WITH_LIGHT",
            "name": "Con Luz",
            "value_id": "242084",
            "value_name": "No",
            "value_struct": null,
            "values": [
             {
                      "id": "242084",
                      "name": "No",
                      "struct": null
             }
             ],
            "attribute_group_id": "DFLT",
            "attribute_group_name": "Otros"
        },
        {
            "id": "BRAND",
            "name": "Marca",
            "value_id": "86416",
            "value_name": "Eiffel",
            "value_struct": null,
            "values": [
             {
                      "id": "86416",
                      "name": "Eiffel",
                      "struct": null
             }
             ],
            "attribute_group_id": "MAIN",
            "attribute_group_name": "Atributos Principales"
        }
    ],
    "warnings": [],
    "listing_source": "",
    "variations": [
        {
            "id": 15092589430,
            "attribute_combinations": [
                {
                    "id": "COLOR",
                    "name": "Color",
                    "value_id": "52005",
                    "value_name": "Marrón",
                    "value_struct": null,
                    "values": [
                     {
                               "id": "52005",
                               "name": "Marrón",
                               "struct": null
                     }
                     ]
                },
                {
                    "id": "VOLTAGE",
                    "name": "Voltaje",
                    "value_id": "198812",
                    "value_name": "110V/220V (Bivolt)",
                    "value_struct": null,
                    "values": [
                     {
                               "id": "198812",
                               "name": "110V/220V (Bivolt)",
                               "struct": null
                     }
                     ]

                }
            ],
            "price": 100,
            "available_quantity": 4,
            "sold_quantity": 0,
            "picture_ids": [
                "553111-MLA20482692355_112015",
                "629425-MLA25446587248_032017"
            ],
            "seller_custom_field": null,
            "catalog_product_id": null,
            "attributes": [
                {
                    "id": "GTIN",
                    "name": "GTIN",
                    "value_id": null,
                    "value_name": "7792931000015",
                    "value_struct": null,
                    "values": [
                     {
                               "id": null,
                               "name": "7792931000015",
                               "struct": null
                     }
                     ]
                },
                {
                    "id": "EAN",
                    "name": "EAN",
                    "value_id": null,
                    "value_name": "7792931000015",
                    "value_struct": null,
                    "values": [
                     {
                               "id": null,
                               "name": "7792931000015",
                               "struct": null
                     }
                     ]
                }
            ]
        }
    ],
    "status": "active",
    "sub_status": [],
    "tags": [
        "poor_quality_picture",
        "immediate_payment"
    ],
    "warranty": null,
    "catalog_product_id": null,
    "domain_id": "MLA-FANS",
    "seller_custom_field": null,
    "parent_item_id": null,
    "differential_pricing": null,
    "deal_ids": [],
    "automatic_relist": false,
    "date_created": "2017-03-20T15:44:01.000Z",
    "last_updated": "2017-03-29T14:55:54.337Z"
}
```

Nota:

Caso não quer conservar as imagens anteriores, não devem ser enviadas no Json e serão apagadas automaticamente.

## Modificar preço

Se quiser modeficiar o preço de um item com variações, você deve realizar um PUT enviando o mesmo preço em todos os IDs correspondentes as variáveis.

Nota:

Caso deseje modificar o preço de um item com variações, deverá realizar um PUT enviando o mesmo preço em todos os IDs correspondentes às variações.
Tenha em conta que em caso de enviar preços diferentes receberá um erro na resposta e não será atualizada a informação.
No caso de não enviar todos os IDs das variações, serão apagadas aquelas que não tenham sido enviadas no momento de fazer o PUT.

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json' -d
{
	"variations": [{
			"id": 15092589430,
			"price": 300
		},
		{
			"id": 15092544559,
			"price": 300
		},
		{
			"id": 15091378470,
			"price": 300
		}
	]
}
https://api.mercadolibre.com/items/MLA658778048
```

## Modificar estoque

Como na modificação de preço, só terá que fazer um PUT na API de produtos, incluindo a propriedade variations, listando cada uma delas com seu id e o novo available\_quantity das variações para as quais quiser modificar o estoque.

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json' -d
{
	"variations": [{
		"id": 15092589430,
		"available_quantity": 10
	}]
}
https://api.mercadolibre.com/items/MLA658778048
```

Resposta:

```
{
    "id": "MLA658778048",
    "site_id": "MLA",
    "title": "Item De Testeo",
    "subtitle": null,
    "seller_id": 247212006,
    "category_id": "MLA378496",
    "official_store_id": null,
    "price": 100,
    "base_price": 100,
    "original_price": null,
    "currency_id": "ARS",
    "initial_quantity": 10,
    "available_quantity": 10,
    "sold_quantity": 0,
    "buying_mode": "buy_it_now",
    "listing_type_id": "gold_special",
    "start_time": "2017-03-20T15:44:00.000Z",
    "stop_time": "2037-03-15T15:44:00.000Z",
    "end_time": "2037-03-15T15:44:00.000Z",
    "expiration_time": "2017-06-17T15:00:27.592Z",
    "condition": "not_specified",
    "permalink": "http://articulo.mercadolibre.com.ar/MLA-658778048-item-de-testeo-_JM",
    "thumbnail": "http://mla-s2-p.mlstatic.com/553111-MLA20482692355_112015-I.jpg",
    "secure_thumbnail": "https://mla-s2-p.mlstatic.com/553111-MLA20482692355_112015-I.jpg",
    "pictures": [
        {
            "id": "553111-MLA20482692355_112015",
            "url": "http://mla-s2-p.mlstatic.com/553111-MLA20482692355_112015-O.jpg",
            "secure_url": "https://mla-s2-p.mlstatic.com/553111-MLA20482692355_112015-O.jpg",
            "size": "320x320",
            "max_size": "320x320",
            "quality": ""
        },
        {
            "id": "629425-MLA25446587248_032017",
            "url": "http://mla-s2-p.mlstatic.com/629425-MLA25446587248_032017-O.jpg",
            "secure_url": "https://mla-s2-p.mlstatic.com/629425-MLA25446587248_032017-O.jpg",
            "size": "384x500",
            "max_size": "922x1200",
            "quality": ""
        }
    ],
    "video_id": null,
    "descriptions": [],
    "accepts_mercadopago": true,
    "non_mercado_pago_payment_methods": [],
    "shipping": {
        "mode": "not_specified",
        "local_pick_up": false,
        "free_shipping": false,
        "methods": null,
        "dimensions": null,
        "tags": [],
        "logistic_type": "not_specified"
    },
    "international_delivery_mode": "none",
    "seller_address": {
        "id": 265953311,
        "comment": "",
        "address_line": "Test Address 123",
        "zip_code": "1414",
        "city": {
            "id": "",
            "name": "Palermo"
        },
        "state": {
            "id": "AR-C",
            "name": "Capital Federal"
        },
        "country": {
            "id": "AR",
            "name": "Argentina"
        },
        "latitude": "",
        "longitude": "",
        "search_location": {
            "neighborhood": {
                "id": "TUxBQlBBTDI1MTVa",
                "name": "Palermo"
            },
            "city": {
                "id": "TUxBQ0NBUGZlZG1sYQ",
                "name": "Capital Federal"
            },
            "state": {
                "id": "TUxBUENBUGw3M2E1",
                "name": "Capital Federal"
            }
        }
    },
    "seller_contact": null,
    "location": {},
    "geolocation": {
        "latitude": "",
        "longitude": ""
    },
    "coverage_areas": [],
    "attributes": [
        {
            "id": "FAN_TYPE",
            "name": "Tipo de Ventilador",
            "value_id": "291719",
            "value_name": "De Techo",
            "attribute_group_id": "DFLT",
            "attribute_group_name": "Otros"
        },
        {
            "id": "HEIGHT_ADJUSTABLE",
            "name": "Altura Regulable",
            "value_id": "242084",
            "value_name": "No",
            "attribute_group_id": "DFLT",
            "attribute_group_name": "Otros"
        },
        {
            "id": "LATERAL_OSCILLATION",
            "name": "Oscilación Lateral",
            "value_id": "242084",
            "value_name": "No",
            "attribute_group_id": "DFLT",
            "attribute_group_name": "Otros"
        },
        {
            "id": "REMOTE_CONTROL",
            "name": "Control Remoto",
            "value_id": "242084",
            "value_name": "No",
            "attribute_group_id": "DFLT",
            "attribute_group_name": "Otros"
        },
        {
            "id": "WITH_LIGHT",
            "name": "Con Luz",
            "value_id": "242084",
            "value_name": "No",
            "attribute_group_id": "DFLT",
            "attribute_group_name": "Otros"
        },
        {
            "id": "BRAND",
            "name": "Marca",
            "value_id": "86416",
            "value_name": "Eiffel",
            "attribute_group_id": "MAIN",
            "attribute_group_name": "Atributos Principales"
        }
    ],
    "warnings": [],
    "listing_source": "",
    "variations": [
        {
            "id": 15092589430,
            "attribute_combinations": [
                {
                    "id": "COLOR",
                    "name": "Color",
                    "value_id": "52005",
                    "value_name": "Marrón"
                },
                {
                    "id": "VOLTAGE",
                    "name": "Voltaje",
                    "value_id": "198812",
                    "value_name": "110V/220V (Bivolt)"
                }
            ],
            "price": 100,
            "available_quantity": 10,
            "sold_quantity": 0,
            "picture_ids": [
                "629425-MLA25446587248_032017"
            ],
            "seller_custom_field": null,
            "catalog_product_id": null,
            "attributes": [
                {
                    "id": "EAN",
                    "name": "EAN",
                    "value_id": null,
                    "value_name": "7792931000015"
                },
                {
                    "id": "UPC",
                    "name": "UPC",
                    "value_id": null,
                    "value_name": "7792931000015"
                }
            ]
        }
    ],
    "status": "active",
    "sub_status": [],
    "tags": [
        "poor_quality_picture",
        "immediate_payment"
    ],
    "warranty": null,
    "catalog_product_id": null,
    "domain_id": "MLA-FANS",
    "seller_custom_field": null,
    "parent_item_id": null,
    "differential_pricing": null,
    "deal_ids": [],
    "automatic_relist": false,
    "date_created": "2017-03-20T15:44:01.000Z",
    "last_updated": "2017-03-29T15:00:27.650Z"
}
```

## Trabalhar com imagens em variações

Para que as diferentes imagens de cada variação fiquem visíveis, é importante levar em conta que o atributo que as determina é aquele que tem a tag defines\_picture: true. Todas as variações que compartilharem o mesmo valor no atributo com a tag define\_picture devem SEMPRE ter as mesmas imagens.

Exemplo:

- vermelho/32 e vermelho/28 devem ter as mesmas imagens
- vermelho/32 e verde /32 devem ter imagens diferentes

Ou seja:

- Todas as variações com o mesmo valor no atributo com a tag "defines\_picture" devem ter as mesmas imagens.
- Todas as variações com diferente valor no atributo com a tag "defines\_picture" devem ter imagens diferentes.
- Todas as variações devem ter uma imagem associada.
- Levando em conta os pontos acima, você também conseguirá que as imagens em miniatura sejam corretamente visualizada.

## Modificar imagens

Se você quiser adicionar uma imagem a uma variação existente, deberá enviar a URL ou o picture\_id, caso a imagem já estiver carregada, na lista de pictures geral do produto e na de pictures da variação. Ao mesmo tempo, como a atualização será realizada sobre o recurso de produtos, é importante você enviar os IDs de cada variação existente no JSON. Caso contrário, a API interpretará que você não quer conservá-las no anúncio.

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json' -d
{
	"pictures": [{
			"source": "http://www.apertura.com/export/sites/revistaap/img/Tecnologia/Logo_ML_NUEVO.jpg_33442984.jpg"
		},
		{
			"source": "http://static.ellahoy.es/ellahoy/fotogallery/1200X0/371265/falda-plisada-rosa.jpg"
		},
		{
			"id": "553111-MLA20482692355_112015"
		},
		{
			"id": "629425-MLA25446587248_032017"
		}
	],
	"variations": [{
			"id": 18200178910,
			"picture_ids": [
				"http://static.ellahoy.es/ellahoy/fotogallery/1200X0/371265/falda-plisada-rosa.jpg",
				"553111-MLA20482692355_112015"
			]
		},
		{
			"id": 18200178913,
			"picture_ids": [
				"http://www.apertura.com/export/sites/revistaap/img/Tecnologia/Logo_ML_NUEVO.jpg_33442984.jpg",
				"629425-MLA25446587248_032017"
			]
		}
	]
}
https://api.mercadolibre.com/items/MLA658778048
```

Resposta:

```
{
    "id": "MLA689372871",
    "site_id": "MLA",
    "title": "Test Item - No Ofertar",
    "subtitle": null,
    "seller_id": 235461680,
    "category_id": "MLA374515",
    "official_store_id": null,
    "price": 200,
    "base_price": 200,
    "original_price": null,
    "currency_id": "ARS",
    "initial_quantity": 2,
    "available_quantity": 2,
    "sold_quantity": 0,
    "sale_terms": [],
    "buying_mode": "buy_it_now",
    "listing_type_id": "gold_special",
    "start_time": "2017-10-26T13:03:44.000Z",
    "historical_start_time": "2017-10-26T13:03:44.000Z",
    "stop_time": "2037-10-21T13:03:44.000Z",
    "end_time": "2037-10-21T13:03:44.000Z",
    "expiration_time": "2018-01-14T16:32:57.725Z",
    "condition": "new",
    "permalink": "http://articulo.mercadolibre.com.ar/MLA-689372871-test-item-no-ofertar-_JM",
    "thumbnail": "http://mla-s1-p.mlstatic.com/942947-MLA26244780225_102017-I.jpg",
    "secure_thumbnail": "https://mla-s1-p.mlstatic.com/942947-MLA26244780225_102017-I.jpg",
    "pictures": [
        {
            "id": "942947-MLA26244780225_102017",
            "url": "http://mla-s1-p.mlstatic.com/942947-MLA26244780225_102017-O.jpg",
            "secure_url": "https://mla-s1-p.mlstatic.com/942947-MLA26244780225_102017-O.jpg",
            "size": "500x228",
            "max_size": "625x285",
            "quality": ""
        },
        {
            "id": "837548-MLA26244864461_102017",
            "url": "http://www.mercadolibre.com/jm/img?s=STC&v=O&f=proccesing_image_es.jpg",
            "secure_url": "https://www.mercadolibre.com/jm/img?s=STC&v=O&f=proccesing_image_es.jpg",
            "size": "500x500",
            "max_size": "500x500",
            "quality": ""
        },
        {
            "id": "553111-MLA20482692355_112015",
            "url": "http://mla-s2-p.mlstatic.com/553111-MLA20482692355_112015-O.jpg",
            "secure_url": "https://mla-s2-p.mlstatic.com/553111-MLA20482692355_112015-O.jpg",
            "size": "320x320",
            "max_size": "320x320",
            "quality": ""
        },
        {
            "id": "629425-MLA25446587248_032017",
            "url": "http://mla-s2-p.mlstatic.com/629425-MLA25446587248_032017-O.jpg",
            "secure_url": "https://mla-s2-p.mlstatic.com/629425-MLA25446587248_032017-O.jpg",
            "size": "384x500",
            "max_size": "922x1200",
            "quality": ""
        }
    ],
    "video_id": null,
    "descriptions": [
        {
            "id": "MLA689372871-1476963486"
        }
    ],
    "accepts_mercadopago": true,
    "non_mercado_pago_payment_methods": [],
    "shipping": {
        "mode": "not_specified",
        "local_pick_up": false,
        "free_shipping": false,
        "methods": [],
        "dimensions": null,
        "tags": [
            "me2_available"
        ],
        "logistic_type": "not_specified",
        "store_pick_up": false
    },
    "international_delivery_mode": "none",
    "seller_address": {
        "id": 206175834,
        "comment": "",
        "address_line": "sssss 111",
        "zip_code": "5000",
        "city": {
            "id": "",
            "name": "Cordoba"
        },
        "state": {
            "id": "AR-X",
            "name": "Córdoba"
        },
        "country": {
            "id": "AR",
            "name": "Argentina"
        },
        "latitude": -32.8224655,
        "longitude": -63.8666332,
        "search_location": {
            "neighborhood": {
                "id": "",
                "name": ""
            },
            "city": {
                "id": "TUxBQ0NBUGNiZGQx",
                "name": "Córdoba"
            },
            "state": {
                "id": "TUxBUENPUmFkZGIw",
                "name": "Córdoba"
            }
        }
    },
    "seller_contact": null,
    "location": {},
    "geolocation": {
        "latitude": -32.8224655,
        "longitude": -63.8666332
    },
    "coverage_areas": [],
    "attributes": [
        {
            "id": "GENDER",
            "name": "Género",
            "value_id": "female",
            "value_name": "Mujer",
            "value_struct": null,
            "attribute_group_id": "DFLT",
            "attribute_group_name": "Otros"
        },
        {
            "id": "Season",
            "name": "Season",
            "value_id": "Season-All-Season",
            "value_name": "All-Season",
            "value_struct": null,
            "attribute_group_id": "DFLT",
            "attribute_group_name": "Otros"
        }
    ],
    "warnings": [],
    "listing_source": "",
    "variations": [
        {
            "id": 18200178910,
            "attribute_combinations": [
                {
                    "id": "83000",
                    "name": "Color Primario",
                    "value_id": "92028",
                    "value_name": "Blanco",
                    "value_struct": null
                },
                {
                    "id": "93000",
                    "name": "Talle",
                    "value_id": "101994",
                    "value_name": "S",
                    "value_struct": null
                }
            ],
            "price": 200,
            "available_quantity": 1,
            "sold_quantity": 0,
            "sale_terms": [],
            "picture_ids": [
                "837548-MLA26244864461_102017",
                "553111-MLA20482692355_112015"
            ],
            "seller_custom_field": null,
            "catalog_product_id": null,
            "attributes": []
        },
        {
            "id": 18200178913,
            "attribute_combinations": [
                {
                    "id": "83000",
                    "name": "Color Primario",
                    "value_id": "91994",
                    "value_name": "Rosa",
                    "value_struct": null
                },
                {
                    "id": "93000",
                    "name": "Talle",
                    "value_id": "101995",
                    "value_name": "M",
                    "value_struct": null
                }
            ],
            "price": 200,
            "available_quantity": 1,
            "sold_quantity": 0,
            "sale_terms": [],
            "picture_ids": [
                "942947-MLA26244780225_102017",
                "629425-MLA25446587248_032017"
            ],
            "seller_custom_field": null,
            "catalog_product_id": null,
            "attributes": []
        }
    ],
    "status": "active",
    "sub_status": [],
    "tags": [
        "test_item",
        "only_html_description",
        "good_quality_thumbnail",
        "unknown_quality_picture",
        "immediate_payment"
    ],
    "warranty": null,
    "catalog_product_id": null,
    "domain_id": null,
    "seller_custom_field": null,
    "parent_item_id": null,
    "differential_pricing": null,
    "deal_ids": [],
    "automatic_relist": false,
    "date_created": "2017-10-26T13:03:44.000Z",
    "last_updated": "2017-10-26T16:32:57.945Z",
    "total_listing_fee": null
}
```

Nota:

Caso você não queira conservar as imagens anteriores, não envie no JSON e elas serão automaticamente desvinculadas.

## Remover variações

Caso você queira remover uma variação, poderá fazê-lo como no exemplo abaixo.

Exemplo:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA599099879/variations/10449631060
```

Resposta:

```
{
    "id": "MLA658778048",
    "site_id": "MLA",
    "title": "Item De Testeo",
    "subtitle": null,
    "seller_id": 247212006,
    "category_id": "MLA378496",
    "official_store_id": null,
    "price": 300,
    "base_price": 300,
    "original_price": null,
    "currency_id": "ARS",
    "initial_quantity": 8,
    "available_quantity": 8,
    "sold_quantity": 0,
    "buying_mode": "buy_it_now",
    "listing_type_id": "gold_special",
    "start_time": "2017-03-20T15:44:00.000Z",
    "stop_time": "2037-03-15T15:44:00.000Z",
    "end_time": "2037-03-15T15:44:00.000Z",
    "expiration_time": "2017-06-17T15:03:02.000Z",
    "condition": "not_specified",
    "permalink": "http://articulo.mercadolibre.com.ar/MLA-658778048-item-de-testeo-_JM",
    "thumbnail": "http://mla-s2-p.mlstatic.com/553111-MLA20482692355_112015-I.jpg",
    "secure_thumbnail": "https://mla-s2-p.mlstatic.com/553111-MLA20482692355_112015-I.jpg",
    "pictures": [
        {
            "id": "553111-MLA20482692355_112015",
            "url": "http://mla-s2-p.mlstatic.com/553111-MLA20482692355_112015-O.jpg",
            "secure_url": "https://mla-s2-p.mlstatic.com/553111-MLA20482692355_112015-O.jpg",
            "size": "320x320",
            "max_size": "320x320",
            "quality": ""
        },
        {
            "id": "629425-MLA25446587248_032017",
            "url": "http://mla-s2-p.mlstatic.com/629425-MLA25446587248_032017-O.jpg",
            "secure_url": "https://mla-s2-p.mlstatic.com/629425-MLA25446587248_032017-O.jpg",
            "size": "384x500",
            "max_size": "922x1200",
            "quality": ""
        }
    ],
    "video_id": null,
    "descriptions": [],
    "accepts_mercadopago": true,
    "non_mercado_pago_payment_methods": [],
    "shipping": {
        "mode": "not_specified",
        "local_pick_up": false,
        "free_shipping": false,
        "methods": null,
        "dimensions": null,
        "tags": [],
        "logistic_type": "not_specified"
    },
    "international_delivery_mode": "none",
    "seller_address": {
        "id": 265953311,
        "comment": "",
        "address_line": "Test Address 123",
        "zip_code": "1414",
        "city": {
            "id": "",
            "name": "Palermo"
        },
        "state": {
            "id": "AR-C",
            "name": "Capital Federal"
        },
        "country": {
            "id": "AR",
            "name": "Argentina"
        },
        "latitude": "",
        "longitude": "",
        "search_location": {
            "neighborhood": {
                "id": "TUxBQlBBTDI1MTVa",
                "name": "Palermo"
            },
            "city": {
                "id": "TUxBQ0NBUGZlZG1sYQ",
                "name": "Capital Federal"
            },
            "state": {
                "id": "TUxBUENBUGw3M2E1",
                "name": "Capital Federal"
            }
        }
    },
    "seller_contact": null,
    "location": {},
    "geolocation": {
        "latitude": "",
        "longitude": ""
    },
    "coverage_areas": [],
    "attributes": [
        {
            "id": "FAN_TYPE",
            "name": "Tipo de Ventilador",
            "value_id": "291719",
            "value_name": "De Techo",
            "attribute_group_id": "DFLT",
            "attribute_group_name": "Otros"
        },
        {
            "id": "HEIGHT_ADJUSTABLE",
            "name": "Altura Regulable",
            "value_id": "242084",
            "value_name": "No",
            "attribute_group_id": "DFLT",
            "attribute_group_name": "Otros"
        },
        {
            "id": "LATERAL_OSCILLATION",
            "name": "Oscilación Lateral",
            "value_id": "242084",
            "value_name": "No",
            "attribute_group_id": "DFLT",
            "attribute_group_name": "Otros"
        },
        {
            "id": "REMOTE_CONTROL",
            "name": "Control Remoto",
            "value_id": "242084",
            "value_name": "No",
            "attribute_group_id": "DFLT",
            "attribute_group_name": "Otros"
        },
        {
            "id": "WITH_LIGHT",
            "name": "Con Luz",
            "value_id": "242084",
            "value_name": "No",
            "attribute_group_id": "DFLT",
            "attribute_group_name": "Otros"
        },
        {
            "id": "BRAND",
            "name": "Marca",
            "value_id": "86416",
            "value_name": "Eiffel",
            "attribute_group_id": "MAIN",
            "attribute_group_name": "Atributos Principales"
        }
    ],
    "warnings": [],
    "listing_source": "",
    "variations": [
        {
            "id": 15092589430,
            "attribute_combinations": [
                {
                    "id": "COLOR",
                    "name": "Color",
                    "value_id": "52005",
                    "value_name": "Marrón"
                },
                {
                    "id": "VOLTAGE",
                    "name": "Voltaje",
                    "value_id": "198812",
                    "value_name": "110V/220V (Bivolt)"
                }
            ],
            "price": 300,
            "available_quantity": 8,
            "sold_quantity": 0,
            "picture_ids": [
                "629425-MLA25446587248_032017"
            ],
            "seller_custom_field": null,
            "catalog_product_id": null,
            "attributes": [
                {
                    "id": "EAN",
                    "name": "EAN",
                    "value_id": null,
                    "value_name": "7792931000015"
                },
                {
                    "id": "UPC",
                    "name": "UPC",
                    "value_id": null,
                    "value_name": "7792931000015"
                }
            ]
        }
    ],
    "status": "active",
    "sub_status": [],
    "tags": [
        "poor_quality_picture",
        "immediate_payment"
    ],
    "warranty": null,
    "catalog_product_id": null,
    "domain_id": "MLA-FANS",
    "seller_custom_field": null,
    "parent_item_id": null,
    "differential_pricing": null,
    "deal_ids": [],
    "automatic_relist": false,
    "date_created": "2017-03-20T15:44:01.000Z",
    "last_updated": "2017-03-29T15:04:20.999Z"
}
```

Outra forma de remover variações é enviar um PUT para a API de produtos com a propriedade variations, listando somente os Ids das variações que quer manter.

Exemplo:

```
curl -X DELETE -H 'Authorization: Bearer $ACCESS_TOKEN' -H 'Content-Type: application/json' https://api.mercadolibre.com/items/MLA658778048/variations/15092589430
```

## Característica personalizada

Embora para grande quantidade de categorias são identificados atributos pelos quais você pode variar seu produto, é provável que você precise gerar variantes com características personalizadas não definidas na API de atributos por categoria. Por exemplo, um vendedor de capas para celulares pode querer variar seu produto segundo o “Design” a fim de oferecer em um mesmo anúncio as variantes Flamingo, Crocodilo e Coruja. Como a categoria não tem esse atributo disponível, podemos enviar a característica personalizada no attribute\_combinations da variação.

  

### Considerações

- No momento de anunciar um produto com características personalizadas, você deverá se certificar de que os atributos na categoria em que quiser publicar são diferentes daqueles que você quer adicionar.
- Além disso, deverá ter em conta que só poderá variar o seu produto por uma única característica personalizada.
- As características personalizadas deverão estar dentro da seção attribute\_combinations em variations.

  

## Anunciar ou modificar produtos com variações com caracteristicas personalizadas

Adicionar ou modificar os atributos personalizados é igual que com os definidos na API de atributos por categoria; você só deve especificar o name do atributo e o value\_name do valor a ser carregado. Lembre de ser consistente com o name definido para o atributo, e modifique seu value\_name da mesma forma em que faria com qualquer outro. O name do atributo é o que os compradores verão na VIP. Para o exemplo anterior, o name que utilizaremos é “Design”.

Exemplo:

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN'  -H 'Content-Type: application/json' -d
{
	"variations": [{
			"attribute_combinations": [{
				"name": "Diseño",
				"value_name": "Buho",
				"value_struct": null,
				"values": [{
					"id": null,
					"name": "Buho",
					"struct": null
				}]
			}],
			"price": 100,
			"available_quantity": 10
		},
		{
			"attribute_combinations": [{
				"name": "Diseño",
				"value_name": "Flamenco",
				"value_struct": null,
				"values": [{
					"id": null,
					"name": "Flamenco",
					"struct": null
				}]
			}],
			"price": 100,
			"available_quantity": 10
		},
		{
			"attribute_combinations": [{
				"name": "Diseño",
				"value_name": "Cocodrilo",
				"value_struct": null,
				"values": [{
					"id": null,
					"name": "Cocodrilo",
					"struct": null
				}]
			}],
			"price": 100,
			"available_quantity": 10
		}
	]
}
https://api.mercadolibre.com/items/MLA658778048
```

Resposta:

```
{
  "id": "MLA658778048",
  "site_id": "MLA",
  "title": "Item De Testeo",
  "subtitle": null,
  "seller_id": 247212006,
  "category_id": "MLA378496",
  "official_store_id": null,
  "price": 100,
  "base_price": 100,
  "original_price": null,
  "currency_id": "ARS",
  "initial_quantity": 30,
  "available_quantity": 30,
  "sold_quantity": 0,
  "buying_mode": "buy_it_now",
  "listing_type_id": "gold_special",
  "start_time": "2017-03-20T15:44:00.000Z",
  "stop_time": "2037-03-15T15:44:00.000Z",
  "end_time": "2037-03-15T15:44:00.000Z",
  "expiration_time": "2017-06-26T16:55:52.935Z",
  "condition": "not_specified",
  "permalink": "http://articulo.mercadolibre.com.ar/MLA-658778048-item-de-testeo-_JM",
  "thumbnail": "http://mla-s2-p.mlstatic.com/553111-MLA20482692355_112015-I.jpg",
  "secure_thumbnail": "https://mla-s2-p.mlstatic.com/553111-MLA20482692355_112015-I.jpg",
  "pictures": [
    {
      "id": "553111-MLA20482692355_112015",
      "url": "http://mla-s2-p.mlstatic.com/553111-MLA20482692355_112015-O.jpg",
      "secure_url": "https://mla-s2-p.mlstatic.com/553111-MLA20482692355_112015-O.jpg",
      "size": "320x320",
      "max_size": "320x320",
      "quality": ""
    },
    {
      "id": "629425-MLA25446587248_032017",
      "url": "http://mla-s2-p.mlstatic.com/629425-MLA25446587248_032017-O.jpg",
      "secure_url": "https://mla-s2-p.mlstatic.com/629425-MLA25446587248_032017-O.jpg",
      "size": "384x500",
      "max_size": "922x1200",
      "quality": ""
    }
  ],
  "video_id": null,
  "descriptions": [],
  "accepts_mercadopago": true,
  "non_mercado_pago_payment_methods": [],
  "shipping": {
    "mode": "not_specified",
    "local_pick_up": false,
    "free_shipping": false,
    "methods": null,
    "dimensions": null,
    "tags": [],
    "logistic_type": "not_specified"
  },
  "international_delivery_mode": "none",
  "seller_address": {
    "id": 265953311,
    "comment": "",
    "address_line": "Test Address 123",
    "zip_code": "1414",
    "city": {
      "id": "",
      "name": "Palermo"
    },
    "state": {
      "id": "AR-C",
      "name": "Capital Federal"
    },
    "country": {
      "id": "AR",
      "name": "Argentina"
    },
    "latitude": "",
    "longitude": "",
    "search_location": {
      "neighborhood": {
        "id": "TUxBQlBBTDI1MTVa",
        "name": "Palermo"
      },
      "city": {
        "id": "TUxBQ0NBUGZlZG1sYQ",
        "name": "Capital Federal"
      },
      "state": {
        "id": "TUxBUENBUGw3M2E1",
        "name": "Capital Federal"
      }
    }
  },
  "seller_contact": null,
  "location": {},
  "geolocation": {
    "latitude": "",
    "longitude": ""
  },
  "coverage_areas": [],
  "attributes": [
    {
      "id": "FAN_TYPE",
      "name": "Tipo de Ventilador",
      "value_id": "291719",
      "value_name": "De Techo",
      "attribute_group_id": "DFLT",
      "attribute_group_name": "Otros"
    },
    {
      "id": "HEIGHT_ADJUSTABLE",
      "name": "Altura Regulable",
      "value_id": "242084",
      "value_name": "No",
      "attribute_group_id": "DFLT",
      "attribute_group_name": "Otros"
    },
    {
      "id": "REMOTE_CONTROL",
      "name": "Control Remoto",
      "value_id": "242084",
      "value_name": "No",
      "attribute_group_id": "DFLT",
      "attribute_group_name": "Otros"
    },
    {
      "id": "WITH_LIGHT",
      "name": "Con Luz",
      "value_id": "242084",
      "value_name": "No",
      "attribute_group_id": "DFLT",
      "attribute_group_name": "Otros"
    },
    {
      "id": "BRAND",
      "name": "Marca",
      "value_id": "86416",
      "value_name": "Eiffel",
      "attribute_group_id": "MAIN",
      "attribute_group_name": "Atributos Principales"
    }
  ],
  "warnings": [],
  "listing_source": "",
  "variations": [
    {
      "id": 15311871917,
      "attribute_combinations": [
        {
          "id": null,
          "name": "Diseño",
          "value_id": null,
          "value_name": "Buho"
        }
      ],
      "price": 100,
      "available_quantity": 10,
      "sold_quantity": 0,
      "picture_ids": [],
      "seller_custom_field": null,
      "catalog_product_id": null,
      "attributes": []
    },
    {
      "id": 15313572235,
      "attribute_combinations": [
        {
          "id": null,
          "name": "Diseño",
          "value_id": null,
          "value_name": "Flamenco"
        }
      ],
      "price": 100,
      "available_quantity": 10,
      "sold_quantity": 0,
      "picture_ids": [],
      "seller_custom_field": null,
      "catalog_product_id": null,
      "attributes": []
    },
    {
      "id": 15313572237,
      "attribute_combinations": [
        {
          "id": null,
          "name": "Diseño",
          "value_id": null,
          "value_name": "Cocodrilo"
        }
      ],
      "price": 100,
      "available_quantity": 10,
      "sold_quantity": 0,
      "picture_ids": [],
      "seller_custom_field": null,
      "catalog_product_id": null,
      "attributes": []
    }
  ],
  "status": "active",
  "sub_status": [],
  "tags": [
    "poor_quality_picture",
    "immediate_payment"
  ],
  "warranty": null,
  "catalog_product_id": null,
  "domain_id": "MLA-FANS",
  "seller_custom_field": null,
  "parent_item_id": null,
  "differential_pricing": null,
  "deal_ids": [],
  "automatic_relist": false,
  "date_created": "2017-03-20T15:44:01.000Z",
  "last_updated": "2017-04-07T16:55:52.996Z"
}
```

Conteúdos
