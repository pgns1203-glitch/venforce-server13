# Atributos

Fonte: https://developers.mercadolivre.com.br/atributos

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 08/06/2026

## Atributos

## Consultar atributos

Lembre que os atributos variam dependendo da [categoria](https://developers.mercadolivre.com.br/pt_br/categorizacao-de-produtos) e você poderá consultá-los através da seguinte chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/$CATEGORY_ID/attributes
```

Exemplo:

```
[
 {
   "id": "HEADPHONE_FORMAT",
   "name": "Formato",
   "tags": {
     "fixed": true
   },
   "value_type": "list",
   "values": [
     {
       "id": "182349",
       "name": "In-Ear"
     }
   ],
   "attribute_group_id": "DFLT",
   "attribute_group_name": "Otros"
 },
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
       "id": "15438",
       "name": "Shure"
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
   "id": "WIRELESS_RANGE",
   "name": "Alcance Inalámbrico",
   "tags": {
     "hidden": true
   },
   "value_type": "number_unit",
   "value_max_length": 60,
   "allowed_units": [
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
       "id": "mm",
       "name": "mm"
     },
     {
       "id": "pulgadas",
       "name": "pulgadas"
     }
   ],
   "default_unit": "cm",
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
   "id": "BLUETOOTH",
   "name": "Bluetooth",
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
   "id": "BATTERY_LIFE",
   "name": "Duración de la Batería",
   "tags": {
     "hidden": true
   },
   "value_type": "number_unit",
   "value_max_length": 60,
   "allowed_units": [
     {
       "id": "h",
       "name": "h"
     },
     {
       "id": "años",
       "name": "años"
     },
     {
       "id": "d",
       "name": "d"
     },
     {
       "id": "m",
       "name": "m"
     },
     {
       "id": "meses",
       "name": "meses"
     },
     {
       "id": "ms",
       "name": "ms"
     },
     {
       "id": "s",
       "name": "s"
     }
   ],
   "default_unit": "h",
   "attribute_group_id": "DFLT",
   "attribute_group_name": "Otros"
 },
 {
   "id": "EAN",
   "name": "EAN",
   "tags": {
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
   "id": "GTIN",
   "name": "GTIN",
   "tags": {
     "hidden": true,
     "multivalued": true,
     "variation_attribute": true
     "conditional_required": true
   },
   "type": "product_identifier",
   "value_type": "string",
   "value_max_length": 60,
   "attribute_group_id": "DFLT",
   "attribute_group_name": "Otros"
 },
 {
   "id": "IMPEDANCE",
   "name": "Impedancia",
   "tags": {
     "hidden": true
   },
   "value_type": "number_unit",
   "value_max_length": 60,
   "allowed_units": [
     {
       "id": "ω",
       "name": "ω"
     }
   ],
   "default_unit": "ω",
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
   "id": "CABLE_LENGTH",
   "name": "Longitud del Cable",
   "tags": {
     "hidden": true
   },
   "value_type": "number_unit",
   "value_max_length": 60,
   "allowed_units": [
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
       "id": "mm",
       "name": "mm"
     },
     {
       "id": "pulgadas",
       "name": "pulgadas"
     }
   ],
   "default_unit": "cm",
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
   "id": "MICROPHONE_INCLUDED",
   "name": "Micrófono Incluido",
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
   "id": "WIRELESS_CAPABILITY",
   "name": "Recepción Inalámbrica",
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
   "id": "FREQUENCY_RESPONSE",
   "name": "Respuesta en Frecuencia",
   "tags": {
     "hidden": true
   },
   "value_type": "string",
   "value_max_length": 60,
   "attribute_group_id": "DFLT",
   "attribute_group_name": "Otros"
 },
 {
   "id": "SENSITIVITY",
   "name": "Sensibilidad",
   "tags": {
     "hidden": true
   },
   "value_type": "number_unit",
   "value_max_length": 60,
   "allowed_units": [
     {
       "id": "db",
       "name": "db"
     }
   ],
   "default_unit": "db",
   "attribute_group_id": "DFLT",
   "attribute_group_name": "Otros"
 },
 {
   "id": "MEMORY_SIZE",
   "name": "Tamaño Efectivo de Memoria",
   "tags": {
     "hidden": true
   },
   "value_type": "number_unit",
   "value_max_length": 60,
   "allowed_units": [
     {
       "id": "gb",
       "name": "gb"
     },
     {
       "id": "gib",
       "name": "gib"
     },
     {
       "id": "kb",
       "name": "kb"
     },
     {
       "id": "kib",
       "name": "kib"
     },
     {
       "id": "mb",
       "name": "mb"
     },
     {
       "id": "mib",
       "name": "mib"
     },
     {
       "id": "tb",
       "name": "tb"
     },
     {
       "id": "tib",
       "name": "tib"
     }
   ],
   "default_unit": "gb",
   "attribute_group_id": "DFLT",
   "attribute_group_name": "Otros"
 },
 {
   "id": "HEADPHONES_TYPE",
   "name": "Tipo",
   "tags": {
     "hidden": true
   },
   "value_type": "string",
   "value_max_length": 60,
   "attribute_group_id": "DFLT",
   "attribute_group_name": "Otros"
 },
 {
   "id": "TYPE_COUPLING",
   "name": "Tipo de Acoplamiento",
   "tags": {
     "hidden": true
   },
   "value_type": "string",
   "value_max_length": 60,
   "suggested_values": [
     {
       "id": "114209",
       "name": "Supraaural"
     },
     {
       "id": "114210",
       "name": "Intraural"
     },
     {
       "id": "114208",
       "name": "Circumaural"
     }
   ],
   "attribute_group_id": "DFLT",
   "attribute_group_name": "Otros"
 },
 {
   "id": "DIAPHRAGM_UNIT",
   "name": "Unidad de Diafragma",
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
   "id": "UPC",
   "name": "UPC",
   "tags": {
     "multivalued": true,
     "variation_attribute": true
   },
   "type": "product_identifier",
   "value_type": "string",
   "value_max_length": 60,
   "attribute_group_id": "DFLT",
   "attribute_group_name": "Otros"
 }
]
```

## Tipos de atributos possíveis

Existem diversos tipos de atributos; deles vão depender os valores que poderão suportar. O tipo de um atributo pode ser visualizado acessando a API de atributos dessa categoria e consultando o campo value\_type. Os tipos possíveis são:

**string**

Você pode preencher atributos como esse com texto livre, incluindo letras e números indistintamente.  
**Considerações:** para este tipo de atributos sugerimos uma lista de valores conhecidos; mesmo assim, você também pode adicionar novos atributos que não façam parte dessa lista. Para o caso de valores novos só deverá enviar o name, mas para valores conhecidos pode fazê-lo enviando tanto o id como o name. Veja os valores sugeridos na API!

**number**

Estes atributos são somente preenchidos com valores numéricos.  
**Considerações:** para este tipo de atributos sugerimos uma lista de valores conhecidos; mesmo assim, você também pode adicionar novos atributos que não façam parte dessa lista. Para o caso de valores novos só deverá enviar o name, mas para valores conhecidos pode fazê-lo enviando tanto o id como o name. Veja os valores sugeridos na API!

**number\_unit**

São atributos formados por um valor numérico e mais uma unidade. Na API de atributos você pode ver as unidades disponíveis para esse atributo. 

**Considerações:** no momento de realizar ou modificar uma postagem, o formato desses atributos será validado, corroborando que este seja respeitado. Para todos os tipos de atributos acima, o campo value\_max\_length indica o número máximo de caracteres a ser carregado no valor do atributo.

**boolean**

Permite somente dois valores, um positivo e outro negativo.

**Considerações:** é necessário enviar o id do valor; você pode consultá-lo na API de atributos.

**list**

Na propriedade value são elencados os valores possíveis que este atributo pode tomar, sempre haverá pelo menos um.

**Considerações:** para carregar um atributo, só precisa o value\_name de um dos valores possíveis. Incentivamos você a ver os valores permitidos na API!

  

## Comportamentos especiais

Na propriedade tags são especificados comportamentos particulares do atributo. Abaixo são listados os possíveis valores que podem ser incluídos, junto com a descrição do comportamento.

- **allow\_variations**: esta TAG permite que os atributos sejam attributes\_combinations. Atualmente, as variações não são criadas automaticamente, deixando o atributo na seção para a qual é enviado no PUT/POST. Se você quiser mais informações sobre como adicioná-los, convidamos a ler a documentação sobre [variações](../../pt_br/variacoes/).
- **defines\_picture**: indica que o atributo define a foto. Por exemplo, Cor em sapatos. Utilizando esta tag será interpretado o modo em que os diferentes componentes nos fluxos devem ser mostrados.
  Lembre que este comportamento é somente aplicável para atributos que suportam variações.
- **fixed**: indica que há um valor fixo para a categoria e todos os itens postados nesta seção terão esse valor. Por exemplo, se você está vendendo um Micro-ondas na categoria MLB232411 correspondente a Micro-ondas -> Outras Marcas -> 18 Litros, esta possui o atributo VOLUMEN\_CAPACITY com os valores 18 Litros, 20 Litros, etc., mas sabemos que para essa categoria o valor adequado para o atributo é 18 Litros, por isso não é necessário que você envie no momento da postagem porque nós vamos preenchê-lo automaticamente.
- **hidden:** os atributos com esta propriedade não são exibidos no fluxo de vendas pelo front-end, mas podem ser carregados via API.
- **used\_hidden:** Esta tag sugere que o atributo é oculto e utilizado em contextos específicos relacionados a produtos usados ou recondicionados.
- **new\_hidden:** Da mesma forma, esta tag indica que o atributo é oculto e está relacionado a produtos novos.
- **inferred**: há um valor inferido para o atributo. Este valor não é modificável. Por exemplo: na categoria iPhone em telefones celulares, o atributo LINE com o valor do iPhone é fixo e infere-se que a marca é Apple.
- **multivalued:** los atributos pueden completarse con más de un valor, separándolos por comas.
- **others**: essa tag é para uso interno.
- **product\_pk**: essa tag serve para reconhecer os atributos que fazem parte da pk de um produto. A partir dele, podemos identificar um produto do catálogo.
- **read\_only**: esta tag é de uso interno. Os atributos com esta tag não podem ser carregados nem modificados por vendedores.
- **required**: será necessário informar o atributo para as publicações de um item tradicional.
- **restricted\_values**: essa tag é para uso interno.
- **variation\_attributee**: se o item contém variações, este atributo pode ser postado com um valor diferente para cada variação. Por exemplo, para qualquer postagem de eletrônica que tiver variações por cor, os códigos de identificação de produto podem ser carregados para cada variação. Embora o item não tenha variações, um valor poderá ser carregado para este atributo.
- **new\_required**: é necessário informar o atributo para a publicação do item, sempre que a condição do item for nova.
- **conditional\_required**: antes de publicar, deve-se verificar se o atributo é obrigatório para publicar ou se está dentro das exceções, realizando um POST para [o recurso /attributes/conditional](https://developers.mercadolivre.com.br/pt_br/atributos?nocache=true#Atributos-obrigatorios-por-condicao) todas as informações do item.
- **catalog\_listing\_required**: obrigatório para enviar uma publicação tradicional ao catálogo. Se este valor for igual a TRUE, será necessário adicionar o atributo ao fazer o optin/envio ao catálogo.

## Atributos obrigatórios

Importante:

Para uniformizar as condições de venda em domínios de venda a granel como pavimentos, revestimentos e outros, ao publicar ou modificar publicações deverá enviar os atributos obrigatórios **Unidade de Vendas** (**SALES\_UNIT**) e **Rendimento** (**YIELD\_OF\_SALES\_UNIT**). [Consulte os domínios que serão impactados](https://www.mercadolivre.com.br/ajuda/30901).

Com o novo recurso /categories/$CATEGORY\_ID/technical\_specs/input você poderá saber quais são os atributos necessários em cada categoria, para que você possa completa-lo antes e evitar que suas publicações sejam penalizadas. Poderá indentificar os atributos que são obrigatórios com o tag "required" para não perder sua posição nas listas.

Chamada:

```
curl -X GET  -H 'Authorization: Bearer $ACCESS_TOKEN'  https://api.mercadolibre.com/categories/$CATEGORY_ID/technical_specs/input
```

Exemplo

```
curl -X GET  -H 'Authorization: Bearer $ACCESS_TOKEN'  https://api.mercadolibre.com/categories/MLA1002/technical_specs/input
```

Resposta:

```
{
  "groups": [
    {
      "id": "MAIN",
      "label": "Características principales",
      "relevance": 1,
      "ui_config": {
      },
      "components": [
        {
          "component": "COMBO",
          "label": "Marca",
          "ui_config": {
            "allow_custom_value": true,
            "allow_filtering": true
          },
          "attributes": [
            {
              "id": "BRAND",
              "name": "Marca",
              "value_type": "string",
              "value_max_length": 255,
              "tags": [
                "catalog_required",
                "required"
              ],
              "values": [
                {
                  "id": "20262",
                  "name": "AOC"
                },
                {
                  "id": "27499",
                  "name": "Admiral"
                },
                {
                  "id": "3",
                  "name": "Philips"
                },
                {
                  "id": "9838",
                  "name": "Pioneer"
                },
                {
                  "id": "21980",
                  "name": "RCA"
                },
                {
                  "id": "206",
                  "name": "Samsung"
                },
             
              "hierarchy": "PARENT_PK",
              "relevance": 1
            }
          ],
          "unified_units": [
          ]
        },
        {
          "component": "TEXT_INPUT",
          "label": "GTIN-14",
          "ui_config": {
            "allow_custom_value": false,
            "allow_filtering": false
          },
          "attributes": [
            {
              "id": "GTIN14",
              "name": "GTIN-14",
              "value_type": "string",
              "value_max_length": 255,
              "tags": [
                "vip_hidden",
                "hidden",
                "multivalued",
                "used_hidden",
                "variation_attribute",
                "validate"
              ],
              "hierarchy": "PRODUCT_IDENTIFIER",
              "relevance": 2
            }
          ],
          "unified_units": [
          ]
        }
      ]
    }
  ]
}
```

Notas:

- Os atributos marcados como requeridos no recurso /categories/$CATEGORY\_ID/attributes são obrigatórios no momento da publicação, caso não estejam presentes, retornaremos um erro.  
- Os atributos marcados como obrigatórios neste novo recurso e não presentes em /categories/$CATEGORY\_ID/attributes, afetarão apenas o posicionamento nas listagens. Lembre-se de que, para identificar itens que já estão perdendo exposição, verifique a tag incomplete\_technical\_specs.

Com o recurso /categories/$CATEGORY\_ID/technical\_specs/output você poderá mostrar os seus produtos e como vai se visualizar em Mercado Libre, dessa maneira suas publicações ficaram organizadas com a mesma ficha técnica.

Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/$CATEGORY_ID/technical_specs/output
```

Exemplo:

```
curl -X GET  -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/MLA1002/technical_specs/output
```

Resposta:

```
{
  "main_title": "Características Principales",
  "groups": [
    {
      "id": "MAIN",
      "label": "Características principales",
      "relevance": 1,
      "ui_config": {
      },
      "components": [
        {
          "component": "TEXT_OUTPUT",
          "label": "Marca",
          "ui_config": {
          },
          "attributes": [
            {
              "id": "BRAND",
              "name": "Marca",
              "value_type": "string"
            }
          ]
        },
                      {
          "component": "BOOLEAN_OUTPUT",
          "label": "Es",
          "ui_config": {
          },
          "attributes": [
            {
              "id": "IS_PORTABLE",
              "name": "Portátil",
              "value_type": "boolean"
            }
          ]
        },
        {
          "component": "TEXT_OUTPUT",
          "label": "Origen",
          "ui_config": {
          },
          "attributes": [
            {
              "id": "ORIGIN",
              "name": "Origen",
              "value_type": "string"
            }
          ]
        },
        {
          "component": "TEXT_OUTPUT",
          "label": "Resolución máxima",
          "ui_config": {
          },
          "attributes": [
            {
              "id": "MAX_RESOLUTION",
              "name": "Resolución máxima",
              "value_type": "string"
            }
          ]
        },
        {
          "component": "NUMBER_UNIT_OUTPUT",
          "label": "Ángulo de visión horizontal",
          "ui_config": {
          },
          "attributes": [
            {
              "id": "HORIZONTAL_VIEWING_ANGLE",
              "name": "Ángulo de visión horizontal",
              "value_type": "number_unit"
            }
          ]
        },
        {
          "component": "NUMBER_UNIT_OUTPUT",
          "label": "Ángulo de visión vertical",
          "ui_config": {
          },
          "attributes": [
            {
              "id": "VERTICAL_VIEWING_ANGLE",
              "name": "Ángulo de visión vertical",
              "value_type": "number_unit"
            }
          ]
        },
        {
          "component": "TEXT_OUTPUT",
          "label": "Relación de aspecto",
          "ui_config": {
          },
          "attributes": [
            {
              "id": "ASPECT_RATIO",
              "name": "Relación de aspecto",
              "value_type": "string"
            }
          ]
        },
        {
          "component": "TEXT_OUTPUT",
          "label": "Relación de contraste",
          "ui_config": {
          },
          "attributes": [
            {
              "id": "CONTRAST_RATIO",
              "name": "Relación de contraste",
              "value_type": "string"
            }
          ]
        },
        {
          "component": "NUMBER_UNIT_OUTPUT",
          "label": "Brillo",
          "ui_config": {
          },
          "attributes": [
            {
              "id": "BRIGHTNESS",
              "name": "Brillo",
              "value_type": "number_unit"
            }
          ]
        },
         ]
        }
      ]
    }
  ]
}
```

  

### Atributos obrigatórios por condição

Importante:

Esse recurso está disponível apenas para Argentina, Brasil e México.

Consultando ao **/categories/$CATEGORY\_ID/attributes/conditional** você pode validar se os atributos que têm a tag **"conditional\_required"** são necessários para sua publicação. Para fazer isso você deve enviar todas as informações do item que deseja publicar.

Chamada:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/$CATEGORY_ID/attributes/conditional
```

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/MLA403656/attributes/conditional
{
   "title": "Item de test Cerveza Patagonia - No Ofertar",
   "category_id": "MLA403656",
   "price": 900,
   "currency_id": "ARS",
   "available_quantity": 10,
   "buying_mode": "buy_it_now",
   "condition": "new",
   "listing_type_id": "gold_special",
   "description": {
       "plain_text": "Descripción con Texto Plano \n"
   },
   "video_id": "YOUTUBE_ID_HERE",
   "sale_terms": [
       {
           "id": "WARRANTY_TYPE",
           "value_name": "Garantía del vendedor"
       },
       {
           "id": "WARRANTY_TIME",
           "value_name": "90 días"
       }
   ],
   "pictures": [
       {
           "source": "http://mla-s2-p.mlstatic.com/968521-MLA20805195516_072016-O.jpg"
       }
   ],
   "attributes": [
       {
           "id": "BEER_STYLE",
           "name": "Estilo de cerveza",
           "value_id": "6443462",
           "value_name": "Pale Ale",
           "value_struct": null,
           "values": [],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "BRAND",
           "name": "Marca",
           "value_id": "2809299",
           "value_name": "Patagonia",
           "value_struct": null,
           "values": [],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "IS_CRAFT_BEER",
           "name": "Es cerveza artesanal",
           "value_id": "242084",
           "value_name": "No",
           "value_struct": null,
           "values": [],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "ITEM_CONDITION",
           "name": "Condición del ítem",
           "value_id": "2230284",
           "value_name": "Nuevo",
           "value_struct": null,
           "values": [],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "PACKAGING_TYPE",
           "name": "Tipo de envase",
           "value_id": "2290293",
           "value_name": "Botella",
           "value_struct": null,
           "values": [],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "SALE_FORMAT",
           "name": "Formato de venta",
           "value_id": "1359391",
           "value_name": "Unidad",
           "value_struct": null,
           "values": [],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "UNITS_PER_PACK",
           "name": "Unidades por pack",
           "value_id": null,
           "value_name": "1",
           "value_struct": null,
           "values": [],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "UNIT_VOLUME",
           "name": "Volumen de la unidad",
           "value_id": "3681798",
           "value_name": "355 mL",
           "value_struct": {},
           "values": [],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       }
   ]
}
```

Resposta com atributos obrigatórios:

```
{ required_attributes: [ { id: "GTIN", "name": "Código universal de producto" } ] }
```

Nota:

Os atributos obrigatórios da resposta, devem ser enviados durante a publicação.

Exemplo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/MLA403656/attributes/conditional
{
   "title": "Item de test Cerveza Artesanal - No Ofertar",
   "category_id": "MLA403656",
   "price": 900,
   "currency_id": "ARS",
   "available_quantity": 10,
   "buying_mode": "buy_it_now",
   "condition": "new",
   "listing_type_id": "gold_special",
   "description": {
       "plain_text": "Descripción con Texto Plano \n"
   },
   "video_id": "YOUTUBE_ID_HERE",
   "sale_terms": [
       {
           "id": "WARRANTY_TYPE",
           "value_name": "Garantía del vendedor"
       },
       {
           "id": "WARRANTY_TIME",
           "value_name": "90 días"
       }
   ],
   "pictures": [
       {
           "source": "http://mla-s2-p.mlstatic.com/968521-MLA20805195516_072016-O.jpg"
       }
   ],
   "attributes": [
       {
           "id": "BEER_STYLE",
           "name": "Estilo de cerveza",
           "value_id": "5893263",
           "value_name": "Stout",
           "value_struct": null,
           "values": [],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "BRAND",
           "name": "Marca",
           "value_id": null,
           "value_name": "artesanal",
           "value_struct": null,
           "values": [],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "IS_CRAFT_BEER",
           "name": "Es cerveza artesanal",
           "value_id": "242085",
           "value_name": "Sí",
           "value_struct": null,
           "values": [],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "IS_NON_ALCOHOLIC_BEER",
           "name": "Es cerveza sin alcohol",
           "value_id": "242084",
           "value_name": "No",
           "value_struct": null,
           "values": [],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "ITEM_CONDITION",
           "name": "Condición del ítem",
           "value_id": "2230284",
           "value_name": "Nuevo",
           "value_struct": null,
           "values": [],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "PACKAGING_TYPE",
           "name": "Tipo de envase",
           "value_id": "2130464",
           "value_name": "Botella retornable",
           "value_struct": null,
           "values": [],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "SALE_FORMAT",
           "name": "Formato de venta",
           "value_id": "1359391",
           "value_name": "Unidad",
           "value_struct": null,
           "values": [],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "UNITS_PER_PACK",
           "name": "Unidades por pack",
           "value_id": null,
           "value_name": "1",
           "value_struct": null,
           "values": [],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       },
       {
           "id": "UNIT_VOLUME",
           "name": "Volumen de la unidad",
           "value_id": "188135",
           "value_name": "1 L",
           "value_struct": {},
           "values": [],
           "attribute_group_id": "OTHERS",
           "attribute_group_name": "Otros"
       }
   ]
}
```

Resposta sem atributos obrigatórios:

```
{ required_attributes: [] }
```

Nota:

Neste caso, não é necessário enviar os atributos que possuem a tag "conditional\_required", pois o item a ser publicado está dentro das exceções.

## Atributos de Dimensões do Pacote

Notas:

- Esses atributos são obrigatórios para vendedores com ME2 nas modalidades cross docking e xd\_drop\_off, embora atualmente não estejam marcados com a tag required nas respostas da API por domínio. Se não forem informados, a API retornará um erro. Essa obrigatoriedade será estendida progressivamente para mais categorias e modalidades.

- Vendedores que operam com **ME1** devem continuar usando o campo atual: **shipping.dimensions**.

Para melhorar a precisão no manuseio e envio dos produtos — permitindo prever o espaço necessário no transporte e oferecer um serviço de envio mais eficiente — foram introduzidos os seguintes atributos de dimensões de pacote, que podem ser adicionados às publicações:

- **SELLER\_PACKAGE\_HEIGHT**: Altura do pacote de envio (valor em cm).
- **SELLER\_PACKAGE\_LENGTH**: Comprimento do pacote de envio (valor em cm).
- **SELLER\_PACKAGE\_WIDTH**: Largura do pacote de envio (valor em cm).
- **SELLER\_PACKAGE\_WEIGHT**: Peso do pacote de envio (valor em g).

**Lembre-se:**Esses atributos devem ser informados em cada publicação. Somente são aceitos centímetros e gramas.

Notas:

- O vendedor declara as dimensões do pacote segundo o conceito largura × altura × comprimento, mas no front-end as três dimensões são ordenadas automaticamente de maior para menor para uma visualização padronizada.

- Isso não afeta o cálculo do custo de frete, já que o volume total do pacote permanece o mesmo.

**Chamada:**

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items
```

**Exemplo:**

```
{
  "attributes": [
    {
      "id": "SELLER_PACKAGE_HEIGHT",
      "value_name": "6 cm"
    },
    {
      "id": "SELLER_PACKAGE_LENGTH",
      "value_name": "31 cm"
    },
    {
      "id": "SELLER_PACKAGE_WIDTH",
      "value_name": "25 cm"
    },
    {
      "id": "SELLER_PACKAGE_WEIGHT",
      "value_name": "214 g"
    }
  ]
}
```

### Erros

A seguir, detalhamos os erros mais comuns ao validar os atributos obrigatórios de dimensões de pacote, junto com suas causas e possíveis soluções.

**1. Está faltando pelo menos um atributo de dimensão**

Esse erro ocorre quando um ou mais atributos obrigatórios não são enviados, mesmo que os demais estejam corretos.

**Solução:** Verifique se os atributos mencionados no erro estão presentes. Todos são obrigatórios.

seller\_package\_height, seller\_package\_length, seller\_package\_width, seller\_package\_weight

```
{
  "department": "pymes",
  "cause_id": 5400,
  "type": "error",
  "code": "item.attribute.missing.seller.package.dimensions",
  "references": ["item.attributes"],
  "message": "The attributes seller_package_height, seller_package_length, seller_package_width, seller_package_weight are all required"
}
```

**2. Formato inválido (por exemplo, uso de decimais)**

Esse erro aparece quando um ou mais atributos estão em formato não aceito, como valores decimais ou unidades incorretas.

**Solução:** Use apenas valores inteiros.

```
{
  "department": "pymes",
  "cause_id": 5402,
  "type": "error",
  "code": "item.attribute.invalid.format.seller.package.dimensions",
  "references": ["item.attributes"],
  "message": "One or more attributes for seller_package_height, seller_package_length, seller_package_width, seller_package_weight are in the wrong format - only integers are accepted for dimensions and weight, with 'cm' as the unit for dimensions and 'g' as the unit for weight. Examples: 10 g, 10 cm"
}
```

**3. Valores inválidos**

Esse erro ocorre quando são informadas dimensões ou pesos que não são realistas, estão fora dos limites aceitos pelo sistema ou estão em formato incorreto.

**Solução:** Verifique se os valores inseridos correspondem às características reais do produto e não são menores que as dimensões mínimas de fábrica. Além disso, certifique-se de utilizar o formato correto para cada unidade.

```
{
  "department": "pymes",
  "cause_id": 5401,
  "type": "error",
  "code": "item.attribute.invalid.seller.package.dimensions",
  "references": [
    "item.attributes"
  ],
  "message": "One or more attributes for seller_package_height, seller_package_length, seller_package_width, seller_package_weight have invalid values"
}
```

### Como identificar itens penalizados

Com o recurso **items/search?** é possível listar, dentro do campo "results", todos os items penalizados que possuem a tag **incomplete\_technical\_specs**. Assim, você identificará os anúncios que estão perdendo exposição nas listagens para melhorar sua qualidade.  
Para conhecer em detalhe, os motivos do porque suas publicações estão perdendo exposição, você deve revisar [os recursos de qualidade](https://developers.mercadolivre.com.br/pt_br/saiba-como-estao-seus-vendedores-em-relacao-carga-de-atributos).

Chamada:

```
curl -X GET  -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/$USER_ID/items/search?tags=incomplete_technical_specs
```

Exemplo:

```
curl -X GET  -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/users/465432224/items/search?tags=incomplete_technical_specs
```

Resposta:

```
{
   "seller_id": "465432224",
   "query": null,
   "paging": {
       "limit": 50,
       "offset": 0,
       "total": 5
   },
   "results": [
       "MLA803174898",
       "MLA803174894",
       "MLA803174788",
       "MLA803174771",
       "MLA803086664"
   ],
   "filters": [],
   "available_filters": [
       {
           "id": "status",
           "name": "Status",
           "values": [
               {
                   "id": "pending",
                   "name": "Inactive items for debt or MercadoLibre policy violation",
                   "results": 0
               },
               {
                   "id": "not_yet_active",
                   "name": "Items newly created or pending activation",
                   "results": 0
               },
               {
                   "id": "programmed",
                   "name": "Items scheduled for future activation",
                   "results": 0
               },
               {
                   "id": "active",
                   "name": "Active items",
                   "results": 0
               },
               {
                   "id": "paused",
                   "name": "Paused Items",
                   "results": 5
               },
               {
                   "id": "closed",
                   "name": "Closed Items",
                   "results": 0
               }
           ]
       },
       {
           "id": "sub_status",
           "name": "Substatus",
           "values": [
               {
                   "id": "deleted",
                   "name": "Deleted substatus",
                   "results": 0
               },
               {
                   "id": "forbidden",
                   "name": "Forbidden substatus",
                   "results": 0
               },
               {
                   "id": "freezed",
                   "name": "Freezed substatus",
                   "results": 0
               },
               {
                   "id": "held",
                   "name": "Held substatus",
                   "results": 0
               },
               {
                   "id": "suspended",
                   "name": "Suspended substatus",
                   "results": 0
               },
               {
                   "id": "waiting_for_patch",
                   "name": "Waiting for patch substatus",
                   "results": 0
               },
               {
                   "id": "warning",
                   "name": "Warning items with MercadoLibre policy violation",
                   "results": 0
               }
           ]
       },
       {
           "id": "buying_mode",
           "name": "Buying Mode",
           "values": [
               {
                   "id": "buy_it_now",
                   "name": "Buy it now",
                   "results": 5
               },
               {
                   "id": "classified",
                   "name": "Classified",
                   "results": 0
               },
               {
                   "id": "auction",
                   "name": "Auction",
                   "results": 0
               }
           ]
       },
       {
           "id": "listing_type_id",
           "name": "Listing type",
           "values": [
               {
                   "id": "gold_pro",
                   "name": "Gold proffesional",
                   "results": 5
               },
               {
                   "id": "gold_special",
                   "name": "Gold special",
                   "results": 0
               },
               {
                   "id": "gold_premium",
                   "name": "Gold premium",
                   "results": 0
               },
               {
                   "id": "gold",
                   "name": "Gold",
                   "results": 0
               },
               {
                   "id": "silver",
                   "name": "Silver",
                   "results": 0
               },
               {
                   "id": "bronze",
                   "name": "Bronze",
                   "results": 0
               },
               {
                   "id": "free",
                   "name": "Free",
                   "results": 0
               }
           ]
       },
       {
           "id": "shipping_free_methods",
           "name": "Shipping free methods",
           "values": [
               {
                   "id": 73328,
                   "results": 3
               }
           ]
       },
       {
           "id": "shipping_tags",
           "name": "Shipping Tags",
           "values": [
               {
                   "id": "mandatory_free_shipping",
                   "results": 3
               },
               {
                   "id": "me2_available",
                   "results": 2
               }
           ]
       },
       {
           "id": "shipping_mode",
           "name": "Shipping Mode",
           "values": [
               {
                   "id": "me2",
                   "results": 3
               },
               {
                   "id": "not_specified",
                   "results": 2
               }
           ]
       },
       {
           "id": "listing_source",
           "name": "Listing Source",
           "values": [
               {
                   "id": "tucarro",
                   "name": "TuCarro",
                   "results": 0
               },
               {
                   "id": "tuinmueble",
                   "name": "TuInmueble",
                   "results": 0
               },
               {
                   "id": "tumoto",
                   "name": "TuMoto",
                   "results": 0
               },
               {
                   "id": "tulancha",
                   "name": "TuLancha",
                   "results": 0
               },
               {
                   "id": "autoplaza",
                   "name": "Autoplaza",
                   "results": 0
               },
               {
                   "id": "autoplaza_ml",
                   "name": "Autoplaza Premium",
                   "results": 0
               }
           ]
       },
       {
           "id": "labels",
           "name": "Others",
           "values": [
               {
                   "id": "few_available",
                   "name": "Items with few availables",
                   "results": 0
               },
               {
                   "id": "with_bids",
                   "name": "Items with bids",
                   "results": 2
               },
               {
                   "id": "without_bids",
                   "name": "Items whithout bids",
                   "results": 3
               },
               {
                   "id": "accepts_mercadopago",
                   "name": "Items with MercadoPago",
                   "results": 5
               },
               {
                   "id": "ending_soon",
                   "name": "Items ending in 20 days or less",
                   "results": 0
               },
               {
                   "id": "with_mercadolibre_envios",
                   "name": "Items with MercadoLibre Envíos",
                   "results": 3
               },
               {
                   "id": "without_mercadolibre_envios",
                   "name": "Items without MercadoLibre Envíos",
                   "results": 2
               },
               {
                   "id": "with_low_quality_image",
                   "name": "Items with low quality image",
                   "results": 0
               },
               {
                   "id": "with_free_shipping",
                   "name": "Items with free shipping",
                   "results": 3
               },
               {
                   "id": "without_free_shipping",
                   "name": "Items with free shipping",
                   "results": 2
               },
               {
                   "id": "with_automatic_relist",
                   "name": "Items with automatic relist",
                   "results": 0
               },
               {
                   "id": "waiting_for_payment",
                   "name": "Items waiting for payment",
                   "results": 0
               },
               {
                   "id": "suspended",
                   "name": "Suspended items",
                   "results": 0
               },
               {
                   "id": "cancelled",
                   "name": "Items cancelled that can not be recovered",
                   "results": 0
               },
               {
                   "id": "being_reviewed",
                   "name": "Items under review",
                   "results": 0
               },
               {
                   "id": "fix_required",
                   "name": "Items waiting for user fix",
                   "results": 0
               },
               {
                   "id": "waiting_for_documentation",
                   "name": "Items waiting for user documentation",
                   "results": 0
               },
               {
                   "id": "without_stock",
                   "name": "Paused items that are out of stock",
                   "results": 0
               },
               {
                   "id": "incomplete_technical_specs",
                   "name": "Items with incomplete technical specs",
                   "results": 5
               },
               {
                   "id": "loyalty_discount_eligible",
                   "name": "Loyalty discount eligible items",
                   "results": 0
               },
               {
                   "id": "with_fbm_contingency",
                   "name": "Items in FBM contingency",
                   "results": 0
               },
               {
                   "id": "with_shipping_self_service",
                   "name": "Items with shipping self service logistic",
                   "results": 0
               }
           ]
       },
       {
           "id": "logistic_type",
           "name": "Logistic Type",
           "values": [
               {
                   "id": "drop_off",
                   "results": 3
               },
               {
                   "id": "not_specified",
                   "results": 2
               }
           ]
       }
   ],
   "orders": [
       {
           "id": "stop_time_asc",
           "name": "Order by stop time ascending"
       }
   ],
   "available_orders": [
       {
           "id": "stop_time_asc",
           "name": "Order by stop time ascending"
       },
       {
           "id": "stop_time_desc",
           "name": "Order by stop time descending"
       },
       {
           "id": "start_time_asc",
           "name": "Order by start time ascending"
       },
       {
           "id": "start_time_desc",
           "name": "Order by start time descending"
       },
       {
           "id": "available_quantity_asc",
           "name": "Order by available quantity ascending"
       },
       {
           "id": "available_quantity_desc",
           "name": "Order by available quantity descending"
       },
       {
           "id": "sold_quantity_asc",
           "name": "Order by sold quantity ascending"
       },
       {
           "id": "sold_quantity_desc",
           "name": "Order by sold quantity descending"
       },
       {
           "id": "price_asc",
           "name": "Order by price ascending"
       },
       {
           "id": "price_desc",
           "name": "Order by price descending"
       },
       {
           "id": "last_updated_desc",
           "name": "Order by lastUpdated descending"
       },
       {
           "id": "last_updated_asc",
           "name": "Order by last updated ascending"
       },
       {
           "id": "total_sold_quantity_asc",
           "name": "Order by total sold quantity ascending"
       },
       {
           "id": {
               "id": "total_sold_quantity_desc",
               "field": "sold_quantity",
               "missing": "_last",
               "order": "desc"
           },
           "name": "Order by total sold quantity descending"
       },
       {
           "id": {
               "id": "inventory_id_asc",
               "field": "inventory_id",
               "missing": "_last",
               "order": "asc"
           },
           "name": "Order by inventory id ascending"
       }
   ]
}
```

## Especificar atributos que não aplicam

Se alguma especificação não aplicar ao produto que você está anunciando, é importante marcá-lo como N/A (não aplica). Para isso, você deve enviar:

- Value\_id ="-1"
- Value\_name ="Null"

No recurso Item, para exibir os atributos N/A, você deve adicionar o parâmetro include\_internal\_attributes=true, pois se a chamada for feita sem ela, os atributos N/A não serão exibidos.  
 Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID?attributes=attributes&include_internal_attributes=true
```

Exemplo

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA0000000?attributes=attributes&include_internal_attributes=true
```

Resposta

```
],
  "attributes": [
    {
      "id": "BRAND",
      "name": "Marca",
      "value_id": "134",
      "value_name": "Winco",
      "value_struct": null,
      "attribute_group_id": "OTHERS",
      "attribute_group_name": "Otros"
    },
    {
      "id": "GTIN",
      "name": "Código universal de producto",
      "value_id": "-1",
      "value_name": null,
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
    },
  {
      "id": "MODEL",
      "name": " Modelo",
      "value_id": null,
      "value_name": "Modelo1",
      "value_struct": null,
      "attribute_group_id": "OTHERS",
    "attribute_group_name": "Otros"
    "attribute_group_name": "Otros"
    },

    {
      "id": "POWER",
      "name": "Potencia",
      "value_id":"-1",
      "value_name":null,
      "value_struct": null    
  }
      "attribute_group_id": "OTHERS",
      "attribute_group_name": "Otros"
    },
```

Se você deseja executar um POST ou PUT, a configuração dos atributos continuará armada da mesma maneira.  
 Ejemplos

  

## Criar anúncios com atributos N/A

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -d '{
 "site_id":"MLA",
 "title":"Item de testeo, por favor no contactar --kc:off",
 "category_id":"MLA125703",
 "price":4000,
 "currency_id":"ARS",
 "buying_mode":"buy_it_now",
 "listing_type_id":"gold_special",
 "condition":"new",
 "available_quantity":10,
"attributes": [{
      "id": "COLOR",
      "value_id": "52049"
    },
    {
      "id": "VOLTAGE",
      "value_name": "198813"
    },
    {
      "id": "DIAMETER",
      "value_id": "-1",
      "value_name": null
    }

 ]
}'
```

## Modificar uma publicação ativa e indicar que um atributo não se aplica (N/A)

```
curl -X PUT -H "Content-Type: application/json" -H "Accept: application/json" -d { "attributes": [{
      "id": "COLOR",
      "value_id": "52049"
    },
    {
      "id": "VOLTAGE",
      "value_name": "198813"
    },
    {
      "id": "DIAMETER",
      "value_id": "-1",
      "value_name": null
    },
    {
      "id": "LATERAL_OSCILLATION",
      "value_id": "242085"
    
    }
  ]
}
```

## Considerações

- Atributos com tag "required:true" não podem ser N/A.
- Se enviar um atributo com value\_id -1, mas o value\_name tem algum valor diferente de null, será ignorado como se ele não tivesse sido enviado. Pois, da API de itens, é conferido que a especificação de N/A também seja enviada e os dois campos são lidos para considerar o valor como N/A.

Por enquanto, se você enviar N/A, só pode ser substituído por um valor (fazendo um PUT não é possível deixar o atributo null).

  

## Exclusões e implicações de comportamentos

| Matriz de exclusões | Required | Fixed | Allow\_variations | Variation\_attribute | Defines\_Picture | Hidden |
| --- | --- | --- | --- | --- | --- | --- |
| Required |  |  |  |  |  | X |
| Fixed |  |  | X | X | X |  |
| Allow\_variations |  | X |  | X |  |  |
| Variation\_attribute |  | X | X |  | X |  |
| Defines\_Picture |  | X |  | X |  |  |
| Hidden | X |  |  |  |  |  |

| Matriz de implicações | Required | Fixed | Allow\_variations | Variation\_attribute | Defines\_Picture | Hidden |
| --- | --- | --- | --- | --- | --- | --- |
| Required |  |  |  |  |  |  |
| Fixed |  |  |  |  |  |  |
| Allow\_variations |  |  |  |  |  |  |
| Variation\_attribute |  |  |  |  |  |  |
| Defines\_Picture |  |  | X |  |  |  |
| Hidden |  |  |  |  |  |  |

## Benefício

As informações do item serão mais completas e terão maior protagonismo mostrando os atributos através de uma ficha técnica em VIP, evitando, assim, perguntas e atritos.

  

## Criar item com atributos

Vamos supor que queremos vender um Micro-ondas mas não conhecemos a marca, o modelo nem a capacidade; primeiramente, devemos determinar em qual categoria queremos postar o anúncio e, depois, consultar quais os atributos dessa categoria:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/categories/MLA125703/attributes
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

Neste exemplo, é possível ver que o atributo BRAND tem a tag fixed para a categoria. Isso acontece porque tendo navegado pela árvore, para procurar a categoria onde publicar o micro-ondas, você já escolheu implicitamente a sua marca.  
Considere que **se o produto não tiver marca própria**, você deve escrever em seu atributo BRAND que é um **produto "genérico"**.  
Depois, analisando os atributos disponíveis, seus tipos e valores sugeridos, só resta montar o JSON do anúncio, incluindo a seção attributes.   
A seguir, mostramos como fazê-lo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN'  -H "Content-Type: application/json" -d '{
 "site_id":"MLA",
 "title":"Item de testeo, por favor no contactar --kc:off",
 "category_id":"MLA125703",
 "price":4000,
 "currency_id":"ARS",
 "buying_mode":"buy_it_now",
 "listing_type_id":"gold_special",
 "condition":"new",
 "available_quantity":10,
 "attributes":[
   {
     "id":"MODEL",
     "value_name":"B228D"
   },
   {
     "id":"VOLUME_CAPACITY",
     "value_name":"28 L"
   }
 ]
}' 'https://api.mercadolibre.com/items'
```

Notas:

- Os atributos podem ser adicionados nos itens a qualquer momento do seu ciclo de vida.  
- Caso o atributo possua uma lista de suggested\_values, você pode enviar um desses valores ou enviar um valor novo.  
- Em caso de atributos de tipo list, você deve enviar somente valores dentro dessa lista.  Basta enviar apenas o value\_id. Porém, se você deseja carregar um valor que não existe na lista, envie-o enviando seu valor personalizado no value\_name, com o value\_id do valor que mais se assemelhe ao seu.  
- Todos os atributos principais são identificados como MAIN no campo attribute\_group\_id, enquanto os atributos secundários serão distinguidos sob outros valores, por exemplo: DELT.  
- Lembre-se de que, nas categorias que contêm cores primária e secundária, excepcionalmente, não será necessário que todas as variações repliquem os dois atributos.

  

## Valores mais utilizados (tops values)

Com este recurso, você poderá saber quais são os valores mais utilizados para um atributo específico de um domínio. Também é possível pesquisar mais, indicando outros valores de atributo, para que apenas os valores que se apliquem à eles sejam listados.  
 Os vendedores poderão usar os valores obtidos para escolher o correto entre eles e melhorar a qualidade das publicações.

  

### Parâmetros obrigatórios

**domain\_id**: ID do domínio ao qual queremos nos referir.  
**attribute\_id**: ID do atributo do qual precisamos conhecer os valores mais usados.

  

### Parâmetros opcionais

**limit**: o limite de resultados solicitados têm no máximo 1000.  
**metric\_type**: métrica pela qual os resultados serão ordenados, em princípio, apenas NOLs (novas publicações nos últimos 90 dias) são suportadas. O único parâmetro no momento é NOL\_90. Novos critérios serão adicionados no futuro. Exemplo: metric\_type = NOL\_90.

  

Para identificar os atributos recomendados e conhecidos, deve executar um POST.

Chamada simple com um único atributo:

```
curl -X POST https://api.mercadolibre.com/catalog_domains/$DOMAIN_ID/attributes/$ATTRIBUTE_ID/top_values
```

Exemplo com um único atributo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_domains/MLA-CELLPHONES/attributes/BRAND/top_values
```

Resposta limitada de marcas registradas para o domínio MLB-CELLPHONES:

```
[
    {
        "id": "9344",
        "name": "Apple",
        "metric": 12189
    },
    {
        "id": "206",
        "name": "Samsung",
        "metric": 10389
    },
    {
        "id": "59387",
        "name": "Xiaomi",
        "metric": 5183
    },
    {
        "id": "2503",
        "name": "Motorola",
        "metric": 4272
    },
    {
        "id": "8784",
        "name": "Huawei",
        "metric": 1203
    },
    {
        "id": "215",
        "name": "LG",
        "metric": 1022
    }
]
```

Chamada com mais de um atributo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_domains/$DOAMAIN_ID/attributes/$ATTRIBUTE_ID/top_values
{
    "known_attributes": [
        {
            "id": "attributes.id",
            "value_id": "attributes.value_id"
        }
    ]
}
```

Nota:

A lista de **known\_attributes** representa o conjunto de atributos que serão levados em consideração para o cálculo de top values.

Exemplo com mais de um atributo:

```
curl -X POST -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/catalog_domains/MLA-CELLPHONES/attributes/MODEL/top_values
{
   "known_attributes": [
       {
           "id": "BRAND",
           "value_id": "206"
       }
   ]
}
```

Resposta limitada de modelos para a marca Samsung no domínio MLB-CELLPHONES:

```
[
    {
        "id": "7693",
        "name": "A50",
        "metric": 517
    },
    {
        "id": "35040",
        "name": "A30",
        "metric": 437
    },
    {
        "id": "8480",
        "name": "A10",
        "metric": 345
    },
    {
        "id": "397729",
        "name": "J2 Prime",
        "metric": 301
    }
]
```

Nota:

Na resposta serão listados todos os valores do atributo selecionado. Esta lista será ordenada pelo campo **metric**, em ordem descendente.

## Modificar e/ou adicionar atributos

Após criado o anúncio, você pode adicionar novos atributos ou modificar os existentes. Vamos supor que você quer modificar o Modelo do Micro-ondas e adicionar a Quantidade de Programas que ele tem. Primeiramente, recomendamos fazer um GET para conhecer os atributos já completados (por exemplo, Modelo).  
 Chamada:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/$ITEM_ID
```

Exemplo:

```
curl -X GET -H 'Authorization: Bearer $ACCESS_TOKEN' https://api.mercadolibre.com/items/MLA0000000
```

Resposta:

```
{
  "id": "MLA0000000",
  "site_id": "MLA",
  "title": "Korg Sintetizador Analogico Monofonico 37 Teclas Ms-20 Mini",
  "subtitle": null,
  "seller_id": 000000,
  "category_id": "MLA3001",
  "official_store_id": null,
  "price": 15150.63,
  "base_price": 15150.63,
  "original_price": null,
  "currency_id": "ARS",
  "initial_quantity": 32,
  "available_quantity": 27,
  "sold_quantity": 5,
  "sale_terms": [
  ],
  "buying_mode": "buy_it_now",
  "listing_type_id": "gold_special",
  "start_time": "2016-06-21T20:59:05.000Z",
  "stop_time": "2036-06-16T20:59:05.000Z",
  "condition": "new",
  "permalink": "http://articulo.mercadolibre.com.ar/MLA-624882373-korg-sintetizador-analogico-monofonico-37-teclas-ms-20-mini-_JM",
  "thumbnail": "http://mla-s2-p.mlstatic.com/777099-MLA26466460545_112017-I.jpg",
  "secure_thumbnail": "https://mla-s2-p.mlstatic.com/777099-MLA26466460545_112017-I.jpg",
  "pictures": [
    {
      "id": "777099-MLA26466460545_112017",
      "url": "http://mla-s2-p.mlstatic.com/777099-MLA26466460545_112017-O.jpg",
      "secure_url": "https://mla-s2-p.mlstatic.com/777099-MLA26466460545_112017-O.jpg",
      "size": "500x297",
      "max_size": "500x297",
      "quality": ""
    },
    {
      "id": "838812-MLA26466460548_112017",
      "url": "http://mla-s2-p.mlstatic.com/838812-MLA26466460548_112017-O.jpg",
      "secure_url": "https://mla-s2-p.mlstatic.com/838812-MLA26466460548_112017-O.jpg",
      "size": "500x167",
      "max_size": "500x167",
      "quality": ""
    },
    {
      "id": "788581-MLA26466460552_112017",
      "url": "http://mla-s2-p.mlstatic.com/788581-MLA26466460552_112017-O.jpg",
      "secure_url": "https://mla-s2-p.mlstatic.com/788581-MLA26466460552_112017-O.jpg",
      "size": "500x262",
      "max_size": "500x262",
      "quality": ""
    },
    {
      "id": "700278-MLA26466460555_112017",
      "url": "http://mla-s2-p.mlstatic.com/700278-MLA26466460555_112017-O.jpg",
      "secure_url": "https://mla-s2-p.mlstatic.com/700278-MLA26466460555_112017-O.jpg",
      "size": "500x169",
      "max_size": "500x169",
      "quality": ""
    },
    {
      "id": "944935-MLA26466456419_112017",
      "url": "http://mla-s2-p.mlstatic.com/944935-MLA26466456419_112017-O.jpg",
      "secure_url": "https://mla-s2-p.mlstatic.com/944935-MLA26466456419_112017-O.jpg",
      "size": "500x210",
      "max_size": "500x210",
      "quality": ""
    },
    {
      "id": "869141-MLA26466456422_112017",
      "url": "http://mla-s2-p.mlstatic.com/869141-MLA26466456422_112017-O.jpg",
      "secure_url": "https://mla-s2-p.mlstatic.com/869141-MLA26466456422_112017-O.jpg",
      "size": "500x500",
      "max_size": "500x500",
      "quality": ""
    },
    {
      "id": "867779-MLA26466456425_112017",
      "url": "http://mla-s2-p.mlstatic.com/867779-MLA26466456425_112017-O.jpg",
      "secure_url": "https://mla-s2-p.mlstatic.com/867779-MLA26466456425_112017-O.jpg",
      "size": "500x500",
      "max_size": "500x500",
      "quality": ""
    },
    {
      "id": "849841-MLA26466456432_112017",
      "url": "http://mla-s2-p.mlstatic.com/849841-MLA26466456432_112017-O.jpg",
      "secure_url": "https://mla-s2-p.mlstatic.com/849841-MLA26466456432_112017-O.jpg",
      "size": "500x500",
      "max_size": "500x500",
      "quality": ""
    },
    {
      "id": "877748-MLA26466456435_112017",
      "url": "http://mla-s2-p.mlstatic.com/877748-MLA26466456435_112017-O.jpg",
      "secure_url": "https://mla-s2-p.mlstatic.com/877748-MLA26466456435_112017-O.jpg",
      "size": "500x500",
      "max_size": "500x500",
      "quality": ""
    }
  ],
  "video_id": "tCRPz6Q70VU",
  "descriptions": [
    {
      "id": "0000000-1123489912"
    }
  ],
  "accepts_mercadopago": true,
  "non_mercado_pago_payment_methods": [
    {
      "id": "MLATB",
      "description": "Transferencia bancaria",
      "type": "G"
    },
    {
      "id": "MLAOT",
      "description": "Tarjeta de crédito",
      "type": "N"
    },
    {
      "id": "MLAMO",
      "description": "Efectivo",
      "type": "G"
    }
  ],
  "shipping": {
    "mode": "not_specified",
    "methods": [
    ],
    "tags": [
    ],
    "dimensions": null,
    "local_pick_up": true,
    "free_shipping": false,
    "logistic_type": "not_specified",
    "store_pick_up": false
  },
  "international_delivery_mode": "none",
  "seller_address": {
    "comment": "",
    "address_line": "",
    "zip_code": "",
    "city": {
      "id": "TUxBQlJFQzkyMTVa",
      "name": "Recoleta"
    },
    "state": {
      "id": "AR-C",
      "name": "Capital Federal"
    },
    "country": {
      "id": "AR",
      "name": "Argentina"
    },
    "search_location": {
      "neighborhood": {
        "id": "TUxBQlJFQzkyMTVa",
        "name": "Recoleta"
      },
      "city": {
        "id": "TUxBQ0NBUGZlZG1sYQ",
        "name": "Capital Federal"
      },
      "state": {
        "id": "TUxBUENBUGw3M2E1",
        "name": "Capital Federal"
      }
    },
    "latitude": -34.598694,
    "longitude": -58.391033,
    "id": 156708999
  },
  "seller_contact": null,
  "location": {
  },
  "geolocation": {
    "latitude": -34.598694,
    "longitude": -58.391033
  },
  "coverage_areas": [
  ],
  "attributes": [
    {
      "id": "AMOUNT_OF_KEYS",
      "name": "Cantidad de teclas",
      "value_id": null,
      "value_name": "37",
      "value_struct": null,
      "attribute_group_id": "DFLT",
      "attribute_group_name": "Otros"
    },
    {
      "id": "DIMENSIONS",
      "name": "Medidas",
      "value_id": null,
      "value_name": "493 × 257 × 208 mm",
      "value_struct": null,
      "attribute_group_id": "DFLT",
      "attribute_group_name": "Otros"
    },
    {
      "id": "WEIGHT",
      "name": "Peso",
      "value_id": null,
      "value_name": "4.8 kg",
      "value_struct": null,
      "attribute_group_id": "DFLT",
      "attribute_group_name": "Otros"
    },
    {
      "id": "BRAND",
      "name": "Marca",
      "value_id": "18163",
      "value_name": "KORG",
      "value_struct": null,
      "attribute_group_id": "MAIN",
      "attribute_group_name": "Principales"
    },
    {
      "id": "MODEL",
      "name": "Modelo",
      "value_id": "522231",
      "value_name": "MS-20 mini",
      "value_struct": null,
      "attribute_group_id": "MAIN",
      "attribute_group_name": "Principales"
    }
  ],
  "warnings": [
  ],
  "listing_source": "",
  "variations": [
  ],
  "status": "active",
  "sub_status": [
  ],
  "tags": [
    "good_quality_thumbnail",
    "good_quality_picture",
    "immediate_payment"
  ],
  "warranty": "null",
  "catalog_product_id": null,
  "domain_id": "MLA-MUSICAL_KEYBOARDS",
  "parent_item_id": null,
  "differential_pricing": null,
  "deal_ids": [
  ],
  "automatic_relist": false,
  "date_created": "2016-06-21T20:59:05.000Z",
  "last_updated": "2017-12-30T16:49:01.000Z"
}
```

**Você terá que carregar esse atributo novamente quando fizer o PUT a fim de não perder as informações.**  Pronto para fazer a atualização? Realize um PUT incluindo os novos atributos, como Quantidade de programas, e mais os que você já tinha (como Modelo).

```
curl -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN' -H "Content-Type: application/json" -H "Accept: application/json" -d "{
   "attributes": [{
       "id": "BRAND"
   },{
       "id": "MODEL",
       "value_name": "B466GT"
   }, {
       "id": "VOLUME_CAPACITY"
   }, {
       "id": "NUMBER_OF_PROGRAMS",
       "value_name": "4"
   }]
} "https://api.mercadolibre.com/items/MLA621092868"
```

## Remover atributos

A forma correta de eliminar o valor do atributo é enviando "null" para os campos "value\_id" e "value\_name". Se somente envia no PUT do JSON os atributos que precisa alterar, os demais não serão eliminados, e continuaram com a informação que foi enviada anteriormente. Caso envie "null" para alguma informação que é obrigatória, será retornado "bad request" com o seguinte código de erro:"code": "item.attributes.deleted\_required" Para fazer a chamada, realize-a seguindo o exemplo: **"code": "item.attributes.deleted\_required"**.

Chamada:

```
curl -H 'Content-Type: application/json' -X PUT -H 'Authorization: Bearer $ACCESS_TOKEN'  https://api.mercadolibre.com/items/MLA20805195516 -d
```

Exemplo:

```
{
  "title": "Item de test - No Ofertar 456",
  "category_id": "MLA126186",
  "price": 10,
  "currency_id": "ARS",
  "available_quantity": 1,
  "buying_mode": "buy_it_now",
  "listing_type_id": "gold_special",
  "condition": "new",
  "description": "Item de test - No Ofertar",
  "video_id": "YOUTUBE_ID_HERE",
  "warranty": "null",
  "pictures": [{
    "source": "http://mla-s2-p.mlstatic.com/968521-MLA20805195516_072016-O.jpg"
  }],
  "attributes": [{
      "id": "COLOR",
      "value_id": "52049"
    },
    {
      "id": "VOLTAGE",
      "value_name": "198813"
    },
    {
      "id": "DIAMETER",
      "value_id": null
      "value_name": null
    }
  ]
}
```

**Seguinte:** [Identificadores de produtos](../../pt_br/identificadores-de-produtos/).

Conteúdos
