# Gerenciar IPs de um aplicativo

Fonte: https://developers.mercadolivre.com.br/gerenciar-ips-de-um-aplicativo

Gestão de aplicações

Consulte as informações essenciais para trabalhar com nossas APIs

![circulos azuis em degrade](https://http2.mlstatic.com/storage/developers-site-cms-admin/DevImgs/230801158836-ImgMS--1-.png)

Documentação do

Você pode usar esta documentação para as seguintes unidades de negócio:

Última atualização em 30/12/2025

## Gerenciar IPs de um aplicativo

Importante:

Essa funcionalidade é exclusiva para integradores withe listeado

Esta documentação tem como objetivo mostrar a funcionalidade disponível no [devcenter](/devcenter/) para gerenciamento e configuração de intervalos de IP que serão permitidos para o consumo de nossas APIs. Descrevendo os possíveis fluxos que um usuário pode executar a partir dessa nova tela.

  

## Gerenciar intervalos de IP

Para entrar nos aplicativos você deve estar logado no [devcenter](/devcenter/) e acessar seu perfil.
Para cada aplicativo integrado, você encontrará um menu despregavel, onde será exibida a opção **Gerenciar intervalos de IP**.

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/239089289886-1.PNG	)   
  

Nota:

Se a **Gerenciar intervalos de IP**não estiver listada, é porque o aplicativo não está habilitado para gerenciar IPs.

  

## Lista de intervalos

Na parte inferior da tela, é mostrada uma lista dos IPs configurados no aplicativo. Na barra de busca, você pode digitar o intervalo que deseja encontrar mais rapidamente: ⁣

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/239089289886-2.PNG)   
  

## Adicionar novo IP

O número de IPs que foram adicionados ao aplicativo e o número de IPs disponíveis são exibidos no lado direito da tela. Se você ainda tiver intervalos disponíveis, a seção para adicionar um novo IP será habilitada.

Existe a possibilidade de adicionar novos IPs de duas formas:

1. Adicionando o IP individualmente.
2. Massivamente, carregando um arquivo com extensão **.csv** com a lista de IPs a serem adicionados.
  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/239089289886-4.PNG)  
  

### Considerações

- Somente IPs v4 ou v6 no formato CIDR (Classles inter-domain routing) são permitidos, um erro é exibido quando o formato não está correto:
  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/239089289886-5.PNG)  
- A validação do número de intervalos de IP disponíveis é realizada tanto no processo individual quanto no processo massivo.
  
  

### Adicionando o IP individualmente

É necessário digitar o novo IP que deseja adicionar, caso não tenha nenhum erro de formato pode clicar no botão **Adicionar**.

  

Será exibida uma mensagem de erro ou êxito, dependendo do resultado do processo:

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/239089289886-6.PNG)  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/239089289886-7.PNG)  
  

### Carga massiva de IPs

Para adicionar vários intervalos de IP em simultâneo, é necessário clicar no botão **Anexar .CSV**. Será aberto um modal onde o usuário vai carregar o arquivo:

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/239089289886-10.PNG)  

### Considerações

- O arquivo deve ter uma extensão **.csv**. Um erro será exibido se esta condição não for atendida.
  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/239089289886-9.PNG)  
- O arquivo não deve conter cabeçalhos.
- Cada intervalo de IP deve ser separado por uma vírgula (,).
- Cada IP deve ter o formato correspondente ou não será considerado na carga massiva.
  

Exemplo de arquivo a carregar:

**Nome**: test.csv

**Conteúdo**:

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/239089289886-9.PNG)  

Após anexar o arquivo, clique no botão **Archivo CSV anexado**.

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/239089289886-10.PNG)  

O sistema exibirá uma mensagem de êxito ou erro, dependendo do resultado do processo.

**Mensagem de êxito**: exibida quando todos os intervalos de IP no arquivo foram carregados com êxito.

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/239089289886-11.PNG)   

**Mensagem de erro**: é mostrada quando a adição de todos ou algum intervalos falhou. Ou devido ao formato de registro ou erro de sobreposição de intervalos.

  

O modal exibirá o número de intervalos que foram adicionados com êxito e o número de intervalos que falharam.

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/239089289886-12.PNG)   

Tem a opção de clicar no botão **Conferir resultados** onde será baixado um arquivo com extensão **.csv** com as informações dos registros que não puderam ser adicionados e uma descrição do erro. Isso é para que o usuário possa ver os erros, corrigi-los e tentar novamente realizar a carga massiva com os intervalos que faltaram.

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/239683363227-Captura-de-Pantalla-2022-11-02-a-la-s--18.16.54.png)  

## Eliminar intervalos de IPs

Para excluir um intervalo, só precisa clicar na opção **Selecionar todos** se desejar excluir todos os intervalos parametrizados ou selecionar apenas aqueles que deseja excluir.

  

Em seguida, clique no botão **Apagar**.

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/239089289886-13.PNG)  

Será exibido um modal como um aviso para o usuário possa confirmar a execução do processo.

  
![](https://http2.mlstatic.com/storage/developers-site-cms-admin/239089289886-14.PNG)  

Finalmente, uma mensagem de erro ou êxito será exibida dependendo do resultado da eliminação dos intervalos correspondentes.

Conteúdos
