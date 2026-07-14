# Como instalar — 3 arquivos, 3 passos

## 1. Suba os arquivos para o repositório
Coloque `privacidade.html` e `termos.html` na mesma pasta onde está o `index.html` atual. Os links do rodapé (`<a href="privacidade.html">` e `<a href="termos.html">`) já existem no seu `index.html` e vão funcionar automaticamente.

**Antes de publicar**, edite os dois arquivos e troque:
- `contato@oxdanoticia.com.br` pelo e-mail real de contato
- Se tiver CNPJ/razão social, adicione na seção 1 do `privacidade.html`

## 2. Instale o banner de cookies em TODAS as páginas
Abra `cookie-banner-snippet.html`, copie o conteúdo inteiro e cole **logo antes de `</body>`** em:
- `index.html`
- `privacidade.html` (já está sem ele — pode adicionar se quiser consistência)
- `termos.html`
- `sobre.html`, `contato.html`, `anuncie.html`, `noticia.html` — qualquer outra página do site

O banner aparece na primeira visita, some depois que o usuário escolher, e lembra a escolha por 1 ano (via cookie).

## 3. (Recomendado) Ative o Google Consent Mode v2 corretamente
O snippet já dispara `gtag('consent','update', ...)` quando o usuário escolhe. Mas para funcionar 100% certo com o AdSense, o **consentimento padrão** precisa ser definido *antes* do script do AdSense carregar. No `<head>` do `index.html`, **acima** da linha:

```html
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7054499486507421" crossorigin="anonymous"></script>
```

adicione isto:

```html
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', {
  'ad_storage': 'denied',
  'ad_user_data': 'denied',
  'ad_personalization': 'denied',
  'analytics_storage': 'denied'
});
</script>
```

Isso garante que nenhum cookie de anúncio seja usado até o usuário aceitar — exatamente o que a LGPD e as políticas do AdSense exigem.

## 4. Antes de enviar para revisão do AdSense, confira
- [ ] Trocar o e-mail placeholder nas políticas
- [ ] Banner de cookies aparecendo em todas as páginas
- [ ] `sobre.html` e `contato.html` com conteúdo real (ainda não revisei esses dois — me envie se quiser que eu confira)
- [ ] Reativar o bloco de anúncio comentado no `index.html` com o `data-ad-slot` real, se quiser anúncios visíveis já na avaliação
- [ ] Confirmar que o site tem notícias originais suficientes publicadas (não só agregação) — o AdSense reprova sites com conteúdo raso ou copiado

## Nota importante
Não sou advogado — este conteúdo é um modelo de boa prática baseado nos requisitos usuais da LGPD e do Google AdSense, mas não substitui uma revisão jurídica, especialmente se o site crescer ou tratar dados mais sensíveis no futuro.
