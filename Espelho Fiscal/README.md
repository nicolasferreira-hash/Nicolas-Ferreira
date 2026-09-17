# Espelho Fiscal

Protótipo navegável do fluxo de geração de espelho de NF para garantia e devolução.

## Executar

Abra `index.html` no navegador. O protótipo é autocontido e não precisa de servidor local.

## O que está implementado

- Máscara e validação do CNPJ com dígitos verificadores.
- Validação da chave de acesso com 44 dígitos.
- Fluxo visual de consulta, conferência e resumo da nota.
- Aplicação da regra de CFOP do procedimento oficial:
	- Dentro do estado: `5.405 -> 5.411` e `5.102 -> 5.202`.
	- Fora do estado: `6.403 -> 6.411` e `6.102 -> 6.202`.
	- Uso e consumo: `5.556` ou `6.556`.
	- Óleos e derivados de petróleo: `5.661` ou `6.661`.
- Lista explícita dos dois CNPJs de emitentes autorizados.
- Mensagem de bloqueio para emitente não autorizado.
- Confirmação de que o CNPJ informado é o comprador/destinatário da NF consultada.
- Comprador da NF usado como remetente e emitente autorizado usado como destinatário do espelho.
- Seleção de produtos e quantidades para devolução total ou parcial.
- Total do espelho calculado somente com os itens selecionados.
- Nova consulta ilimitada, com limpeza completa do estado anterior.
- Importação do XML da NF com validação da chave, emitente e comprador.
- Leitura da base de cálculo, alíquota e valor do ICMS nos grupos fiscais da NF-e.
- Cálculo proporcional dos valores de ICMS em devoluções parciais; quando o ICMS não estiver destacado, o espelho informa isso sem inventar valores.
- Layout responsivo para desktop e celular.

O modo demonstração utiliza dados fiscais simulados. Para exercitar o bloqueio de emitente, use uma chave válida terminada em `9`.

## Pendências para produção

1. Implementar um backend para proteger credenciais e consultar a API oficial do SIEG Hub.
2. Implementar o backend do endpoint `/api/notas?chave=...`, protegendo as credenciais e consultando a API oficial do SIEG Hub. Enquanto ele não existir, o XML pode ser importado diretamente na etapa 2.
3. Adicionar autenticação, logs de auditoria, tratamento de indisponibilidade e testes automatizados.
