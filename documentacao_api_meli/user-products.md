# User Products

Fonte: https://developers.mercadolivre.com.br/user-products

Documentação do Mercado Livre

Confira todas as informações necessárias sobre as APIs Mercado Livre.

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Última atualização em 17/06/2026

## User Products

Importante:

Você poderá realizar testes solicitando a ambientação dos seus usuários de TEST através do seguinte [formulário](https://docs.google.com/forms/d/e/1FAIpQLSfC3RVMKKDrTU0vVVOC_TsbidG_ImvKMLggkB3004hrr0eMqw/viewform).

User Product, abreviado como UP é um novo conceito no Mercado Livre que visa permitir ao vendedor escolher diferentes condições de venda para cada variação de um mesmo produto.

No modelo anterior de publicações de um vendedor, era possível criar variações que agrupavam diferentes opções do mesmo produto, como uma camisa em várias cores ou tamanhos. Essas variações permitiam oferecer produtos relacionados dentro da mesma publicação. No entanto, esse modelo tinha várias limitações:

- Não era possível estabelecer diferentes preços por variação.
- Não é possível configurar diferentes formas de entrega por variantes.
- Não era possível aplicar promoções ou parcelamento específico por variação.

Nosso objetivo é adotar um novo modelo que resolva esses problemas e unifique a experiência, desacoplando as condições de venda para permitir diferenças em cada variação e assim expandir as publicações.  
A partir disso, surge a ideia de criar "User Products" (Produtos de Usuário), onde as iniciativas a serem trabalhadas serão:

- [Preço por variação.](/pt_br/preco-variacao)
- [Estoque distribuído.](/pt_br/estoque-distribuido)
- [Estoque multi-origem.](/pt_br/estoque-multi-origem)

Esse enfoque permitirá oferecer uma maior flexibilidade na configuração das publicações, permitindo preços e gestão de estoque específicos para cada variação, o que melhorará a experiência do comprador e a eficiência nas operações de venda.

  

## Conceitos importantes

Para compreender o modelo de User Product (UP), é fundamental considerar os seguintes conceitos:

1. Item:
2. É a representação da publicação de um produto que um comprador visualiza na plataforma.
3. Contém informações relativas às condições de venda (preço, parcelas, etc.).
4. Cada item possui um identificador único (item\_id) associado.
  
5. User Product (UP):
6. Representa um produto físico que um vendedor possui e oferta através da plataforma.
7. Um UP descreve o produto da forma mais específica possível (nível de variação).
8. Cada UP possui um identificador único (user\_product\_id) atribuído automaticamente pelo sistema.
9. Pode estar associado a um ou mais ítens. Exemplo: um iPhone vermelho (o UP) pode estar no item1 em 3 parcelas e no item2 com outro preço diferente.
10. Todo UP poderá ser visualizado no Mercado Livre por meio de uma User Products Page (UPP).
  
11. Família:
12. É autogerada com base nas informações dos produtos.
13. Cada UP está relacionado a uma família (family\_id), e cada família agrupa vários UPs.
14. Os itens da mesma família terão o mesmo family\_name e serão representados como pickers diferentes na UPP. Os pickers são as opções oferecidas a um comprador para adquirir um produto, incluindo diferentes condições de venda e atributos, como a cor.
15. Para agrupar User Products em uma família, são considerados os atributos marcados como **PARENT\_PK**, que devem ter os mesmos valores em todos os produtos da família. Os atributos **CHILD\_PK** e os customizados apenas contribuem com seu id e nome para o cálculo, permitindo que seus valores variem entre produtos da mesma família. Os atributos read\_only não são considerados. Assim, uma família reúne produtos com características principais iguais e permite variações.
16. Os campos utilizados para definir uma família são:
    - Name (caso tenha family\_name, priorizamos o family\_name em relação ao name)
    - Domain\_id
    - User\_id
    - Attributes:
      1. PARENT\_PK
      2. CHILD\_PK
      3. Custom Attributes
      4. Item Condition\*Não são considerados os atributos child\_pk e parent\_pk que sejam read\_only para gerar a família
17. A modificação dos itens através do [PUT ao recurso /items](/pt_br/produto-sincronizacao-de-publicacoes), que se refere às características do User Product, será replicada pelo Mercado Livre de forma assíncrona em todos os itens associados ao mesmo User Product. Os campos do item que são sincronizados são:

- title
- family\_name
- attributes
- pictures
- domain\_id
- catalog\_product\_id
- condition
- available\_quantity

18. Para itens de moda, a
    [tabela de medidas](/pt_br/gerenciar-tabela-de-medida) será compartilhada pela variação (User products) e suas condições de vendas (ítens).

  

A seguir, para exemplificar os conceitos mencionados anteriormente, apresentamos uma comparação entre uma publicação no modelo anterior vs o endgame com User Products.

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/191319306066-brasil-comparativo-up.png)  

Baseado no novo modelo, apresentamos um exemplo para uma família e sua composição tanto em User Products (UP) quanto em seus itens e condições de venda:

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/191319306066-brasil-ejemplo-up.png)

Nota:

Nota: Para conhecer como gerenciar o estoque, acesse a documentação de [“Estoque distribuido”.](/pt_br/estoque-distribuido)

  

## FAQs

## Preço por variação

**Que tipo de integradores devem adaptar seus desenvolvimentos a esta iniciativa?**

A iniciativa de Preço por variação e UPtin aplica a todos os integradores que publicam, sincronizam ou inclusive mostram uma lista de publicações para os vendedores.
A iniciativa de Stock Distribuído e Multi Origem aplica para todos os vendedores que publicam, sincronizam ou toman informação das vendas e envios.

  

**Que impacto terei em caso de não implementar a iniciativa?**

Uma vez que os vendedores sejam ativados para começar a publicar no novo modelo de Preço por Variação, caso o integrador não esteja adaptado, **não será possível publicar com o modelo anterior**  (informando title e array de variations).  
Para os integradores que sincronizam ítens, atualizam stock, preço, ou guardam em sua base de dados informação sobre os itens, devem ter em conta a nova estrutura de alteração de stock (a nível de UP) e além disso, receber notificações de alterações pela migração de ítens para manter a consistência de informação em sua base.  
Finalmente, para os integradores que listam publicações, devem considerar atualizar seu front para adaptar a proposta de valor que tem o Mercado Livre com esta iniciativa. Ou seja, agrupar os ítens por família, por user product e atém disso (em casos de publicar ou modificar) permitir que se estabeleçam diferentes condições de venda para cada variação.

  

**Como posso identificar os vendedores que já estão sob o novo modelo de Preço por Variação?**

Através da tag **"user\_product\_seller"** na API /users.

  

**Como posso identificar os itens que já estão no modelo de Preço por Variação?**

Validando se o item possui **family\_name diferente de null**. Isso acontecerá em:

- Itens/Live Listing (LL) que já passaram pelo processo de **UPtin**.
- Novos itens (NOLs) que foram publicados a partir do momento em que ao **vendedor** foi atribuído o tag "user\_product\_seller".

  

**Os itens de catálogo contarão com a tag user\_product\_listing = true?**

Através da tag **"user\_product\_seller"** na API /users.

  

**Como posso testar o fluxo de User Products?**

Para testar os novos fluxos, solicitamos que o façam através deste [formulário](https://docs.google.com/forms/d/e/1FAIpQLSfC3RVMKKDrTU0vVVOC_TsbidG_ImvKMLggkB3004hrr0eMqw/viewform). A cada 7 dias, ativaremos esses novos usuários.

  

**Todos os vendedores serão habilitados para trabalhar com o novo modelo de UP?**

No endgame, todos os sellers estarão habilitados para utilizá-lo. A partir de outubro de 2024, ele será ativado de forma progressiva até que 100% dos sellers estejam ativos em 2025.

  

**Como posso identificar os sellers que já se encontram no novo modelo de UP?**

Através da tag  **"user\_product\_seller."**

  

**Todos os ítens contarão con user\_product\_id, family\_id e family\_name?**

- Antes da ativação da tag "user\_product\_seller": Os Live Listing contarão com **user\_product\_id** e não terão **family\_name**. A relação de **user\_product\_id** e **item\_id** será 1:1.
- Posterior a ativação da tag "user\_product\_seller": se realizará um processo de unificação para ítens mono-variantes e sem variantes, com a finalidade de agrupar os ítens que deverão pertencer ao mesmo **user\_product\_id**, permitindo que um **user\_product\_id** esteja associado a 1 ou mais ítens. Posterior a unificação, os ítens contarão com o atributo **family\_name**.
- Quando o vendedor decide realizar a migração de um ítem multivariante ao novo modelo (UPtin). Neste caso, os novos ítens gerados estarão associados ao mesmo **user\_product\_id** e também contarão com **family\_name**.

  

**Até quando o vendedor poderá publicar no modelo anterior?**

Até a ativação da tag "user\_product\_seller". A partir da ativação, os novos ítens deverão ser criados no novo modelo.

  

**Existe algum endpoint para listar todas as familias de um vendedor?**

Não, atualmente não existe.

  

**Como posso obter todos os itens que correspondem a uma mesma família?**

Realizando as seguintes requisições:

- GET a /items para obter o **user\_product\_id**
- GET a /user-products/$USER\_PRODUCT\_ID para obter o **family\_id**
- GET a /sites/$SITE\_ID/user-products-families/$FAMILY\_ID para obter todos os User Products associados a uma família
- GET a /users/$SELLER\_ID/items/search?user\_product\_id=$USER\_PRODUCT\_ID para obter todos os itens asociados ao user\_product\_id. Pode enviar varios user\_products\_id no parâmetro em forma de lista, exemplo: GET /users/$SELLER\_ID/items/search?user\_product\_id=MLBU1234,MLBU12345

  

**Qual deve ser o tamanho do family\_name inserido pelo vendedor durante a publicação?**

O family\_name que poderá ser inserido deve ser menor ou igual ao “max\_title\_length” do domínio.

  

**É possível atualizar o family\_name?**

Sim, apenas quando nenhuma das condições ainda não tiver vendas. Tenha em conta que em casos de que o ítem esteja associado a um UP com vários ítems, será possível atualizar o family\_name e sincronizará com todos os ítens deste UP.

  

**Ao alterar a condição de venda de uma família, será alterado seu family\_name?**

Não deveria ser alterado, já que o family\_name não está relacionado com as condições de venda (por exemplo, preço e tipo de publicação).

  

**O family\_name será gerenciado pelo integrador? Ou seja Meli não vai alterar o valor deste campo?**

Sim, será responsabilidade do vendedor/integrador. Somente no caso de UPtin, o Mercado Livre criará o family\_name do anúncio.

  

**Posso publicar com atributos tipo custom no modelo de Preço por Variações?**

Sim, é possível publicar adicionando o atributo, exemplo:

```
{
	"attributes": [
		{
			"name": "my-custom-attribute-name",
			"value_name":"my-custom-attribute-value"
		}
	]
}
```

**O recurso /categories continuará funcionando da mesma forma para que possamos consultar os atributos e suas tags? Por exemplo, allow\_variations e variation\_attribute.**

Sim, inclusive, você poderá tomar como referência (não regra) esses atributos para entender qual será o atributo levado para completar do **family\_name** da publicação.

  

**Será possível enviar o array de variations após a ativação de um seller para trabalhar com Preço por Variação?**

Não será possível enviar o array, pois cada uma das variações será uma condição de venda (itens diferentes).

  

## UPtin

**Os itens que estão no modelo anterior migrarão automaticamente para o novo modelo?**

Uma vez que o vendedor seja ativado o modelo de Preço por Variação (tenha a tag "user\_product\_seller"), os itens sem variantes serão migrados automaticamente pelo Mercado Livre para o novo modelo.

  

**Todos os itens são candidatos a migrar para o novo modelo de Preço por Variação?**

Não, é necessário utilizar o [endpoint de elegibilidade](/pt_br/preco-variacao#Elegibilidade-de-itens-uptin) para validar se é possível migrar o item.

  

**O que acontecerá com as informações de vendas das publicações antigas?**

O campo sold\_quantity refletirá as mesmas vendas que o sold\_quantity da variante, entretanto, as ordens antigas permanecerão associadas ao item\_id anterior.

  

## Estoque distribuído e multi origem

**Como convive o novo e o antigo mundo?**

Quando um vendedor é configurado para multiorigem, todos os itens passam a ser gerenciados como multiorigem, sem distinção entre o modelo antigo e o novo.

  

**O mesmo anúncio poderá estar em mais de um armazém (stock\_location) do seller?**

Sim, para os vendedores que tiveram Multiorigem ativo (tag warehouse\_management), será possível distribuir o estoque em suas diferentes stock\_location. Saiba mais sobre como distribuir o estoque na documentação de [Stock Multiorigen.](/pt_br/estoque-multi-origem)

  

**Uma vez que o seller é configurado para multiorigem, como o estoque deve ser distribuído para publicações que ainda estão no modelo antigo?**

Quando o seller estiver em multiorigem, o estoque deve ser gerenciado utilizando o método PUT para seller\_warehouse

  
  

**Siguiente**: [Preço por variação](/pt_br/preco-variacao).

Conteúdos
