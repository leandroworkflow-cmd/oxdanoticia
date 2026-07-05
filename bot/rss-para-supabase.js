const { createClient } = require('@supabase/supabase-js');
const Parser = require('rss-parser');
const https = require('https');
const http = require('http');
const zlib = require('zlib');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GROQ_KEY = process.env.GROQ_KEY;
const TABELA = 'hora';

if (!SUPABASE_URL || !SUPABASE_KEY || !GROQ_KEY) {
  console.error('❌ Faltam variáveis de ambiente: SUPABASE_URL, SUPABASE_KEY ou GROQ_KEY.');
  console.error('   Configure-as como Secrets do GitHub Actions (ou variáveis de ambiente locais).');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': UA,
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    'Accept-Language': 'pt-BR,pt;q=0.9',
    'Cache-Control': 'no-cache',
  },
  customFields: {
    item: [
      ['media:content',   'media:content',   { keepArray: false }],
      ['media:thumbnail', 'media:thumbnail', { keepArray: false }],
      ['enclosure', 'enclosure'],
    ]
  }
});

const FEEDS = [
  { nome: 'Jovem Pan',       url: 'https://jovempan.com.br/feed',                             categoria: 'Brasil'         },
  { nome: 'Folha SP',        url: 'https://feeds.folha.uol.com.br/folha/brasil/rss091.xml',   categoria: 'Brasil'         },
  { nome: 'Carta Capital',   url: 'https://www.cartacapital.com.br/feed/',                    categoria: 'Politica'       },
  { nome: 'Congresso Foco',  url: 'https://congressoemfoco.uol.com.br/feed/',                 categoria: 'Politica'       },
  { nome: 'BBC Brasil',      url: 'https://feeds.bbci.co.uk/portuguese/rss.xml',              categoria: 'Mundo'          },
  { nome: 'Infomoney',       url: 'https://www.infomoney.com.br/feed/',                       categoria: 'Economia'       },
  { nome: 'Bolavip Brasil', url: 'https://br.bolavip.com/rss/feed', categoria: 'Esportes' },
  { nome: 'Rolling Stone BR',url: 'https://rollingstone.uol.com.br/feed/',                   categoria: 'Entretenimento' },
  { nome: 'Canaltech',       url: 'https://canaltech.com.br/rss/',                            categoria: 'Tecnologia'     },
  { nome: 'Tecmundo',        url: 'https://rss.tecmundo.com.br/feed',                         categoria: 'Tecnologia'     },
];

const AUTORES = [
  'Lionor VS2', 'Carlos Mendonca', 'Ana Paula Figueiredo',
  'Roberto Dias', 'Mariana Souza', 'Felipe Cardoso',
  'Juliana Moreira', 'Redacao O X da Noticia'
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function limparHTML(str) {
  if (!str) return '';
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&nbsp;/g,' ')
    .replace(/\s+/g,' ').trim();
}

function limparUrlImagem(url) {
  if (!url) return url;
  const m = url.match(/\/thumbor\/.+?\/(https?:\/\/.+)/);
  if (m && m[1]) return m[1];
  return url;
}

function extrairImagem(item) {
  if (item.enclosure?.url) return item.enclosure.url;
  const mc = item['media:content'];
  if (mc) {
    const url = Array.isArray(mc) ? (mc[0]?.$?.url || mc[0]?.url) : (mc?.$?.url || mc?.url);
    if (url) return url;
  }
  const mt = item['media:thumbnail'];
  if (mt) {
    const url = Array.isArray(mt) ? (mt[0]?.$?.url || mt[0]?.url) : (mt?.$?.url || mt?.url);
    if (url) return url;
  }
  if (item['itunes:image']?.href) return item['itunes:image'].href;
  const c = item['content:encoded'] || item.content || item.summary || '';
  const m = c.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (m?.[1]) return m[1];
  return null;
}

// ─── VERIFICAR IMAGEM com timeout à prova de travamento ──────────────────────
function verificarImagem(url) {
  return new Promise((resolve) => {
    // Garante que resolve seja chamado apenas uma vez
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };

    // Timeout externo de segurança — nunca trava mais de 8s
    const guard = setTimeout(() => finish(true), 8000);

    try {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.request(url, { method: 'HEAD', headers: { 'User-Agent': UA } }, (res) => {
        clearTimeout(guard);
        const tam = parseInt(res.headers['content-length'] || '0');
        finish(tam === 0 || tam >= 5000);
      });
      req.on('error', () => { clearTimeout(guard); finish(true); });
      req.setTimeout(6000, () => { req.destroy(); clearTimeout(guard); finish(true); });
      req.end();
    } catch { clearTimeout(guard); finish(true); }
  });
}

// ─── Faz 1 requisição HTTP(S) e devolve o HTML já descomprimido ──────────────
function fetchHtml(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    try {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, {
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'pt-BR,pt;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
        }
      }, (res) => {
        // Redirect — devolve pro chamador decidir
        if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
          res.resume(); // descarta o corpo
          resolve({ redirect: res.headers.location });
          return;
        }

        const encoding = (res.headers['content-encoding'] || '').toLowerCase();
        let stream = res;
        if (encoding === 'gzip')          stream = res.pipe(zlib.createGunzip());
        else if (encoding === 'deflate')  stream = res.pipe(zlib.createInflate());
        else if (encoding === 'br')       stream = res.pipe(zlib.createBrotliDecompress());

        let chunks = [];
        let total = 0;
        stream.on('data', c => {
          chunks.push(c); total += c.length;
          if (total > 300000) { req.destroy(); }
        });
        stream.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8') }));
        stream.on('error', (e) => reject(e));
      });
      req.on('error', reject);
      req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
    } catch (e) { reject(e); }
  });
}

function extrairImagemDoHtml(html) {
  const padroes = [
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
  ];
  for (const re of padroes) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

// ─── BUSCAR OG:IMAGE (com suporte a gzip/brotli e até 4 redirects) ───────────
async function buscarOgImage(url, redirectsLeft = 4) {
  try {
    const r = await fetchHtml(url);
    if (r.redirect && redirectsLeft > 0) {
      const loc = r.redirect.startsWith('http') ? r.redirect : new URL(r.redirect, url).toString();
      return buscarOgImage(loc, redirectsLeft - 1);
    }
    if (!r.html) return null;

    const imgUrl = extrairImagemDoHtml(r.html);
    if (!imgUrl) return null;

    const ok = await verificarImagem(imgUrl);
    return ok ? imgUrl : null;
  } catch (e) {
    console.log(`  ⚠️  OG falhou (${e.message}) — pulando imagem`);
    return null;
  }
}

function criarSlug(titulo) {
  return titulo.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^\w\s-]/g,'').replace(/\s+/g,'-')
    .replace(/-+/g,'-').substring(0,120);
}

function autorAleatorio() {
  return AUTORES[Math.floor(Math.random() * AUTORES.length)];
}

// ─── GROQ COM RETRY ──────────────────────────────────────────────────────────
async function gerarComGroq(titulo, conteudo, categoria, tentativa = 1) {
  const MAX = 3;
  const prompt = `Jornalista do O X da Notícia. Reescreva em português brasileiro, 600-900 palavras. Sem citar fontes. Sem subtítulos de Introdução/Conclusão. Use ## e ###. Formato EXATO:\nTITULO: [título]\nCONTEUDO:\n[texto]\n\nCategoria: ${categoria}\nTítulo: ${titulo}\nTexto: ${conteudo.substring(0,500)}`;

  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };

    // Timeout externo de segurança para o Groq — nunca trava mais de 35s
    const guard = setTimeout(() => {
      console.log('  ⚠️  Groq timeout (35s) — pulando artigo');
      finish(null);
    }, 35000);

    const body = JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1500,
      temperature: 0.72
    });

    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_KEY,
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', async () => {
        clearTimeout(guard);
        try {
          const j = JSON.parse(d);

          if (res.statusCode === 429) {
            const retry = parseInt(res.headers['retry-after'] || '60');
            if (retry > 120) {
              console.log(`  ⚠️  Rate limit ${retry}s — pulando artigo`);
              finish(null); return;
            }
            console.log(`  ⏳ Rate limit ${retry}s (tentativa ${tentativa}/${MAX})`);
            if (tentativa < MAX) {
              await sleep(retry * 1000 + 2000);
              finish(await gerarComGroq(titulo, conteudo, categoria, tentativa + 1));
            } else { finish(null); }
            return;
          }

          if (j.error) {
            console.log(`  ❌ Groq: ${j.error.message}`);
            if (tentativa < MAX) {
              await sleep(10000);
              finish(await gerarComGroq(titulo, conteudo, categoria, tentativa + 1));
            } else { finish(null); }
            return;
          }

          const raw = j.choices?.[0]?.message?.content?.trim();
          if (!raw) { finish(null); return; }

          let titulo2 = titulo;
          const mt = raw.match(/TITULO:\s*(.+)/i);
          if (mt) titulo2 = mt[1].trim();

          let conteudo2 = raw;
          const mc = raw.match(/CONTEUDO:\s*([\s\S]+)/i);
          if (mc) conteudo2 = mc[1].trim();

          conteudo2 = conteudo2.replace(/\*\*/g,'').replace(/\n{3,}/g,'\n\n').trim();

          const html = conteudo2.split('\n').map(l => {
            l = l.trim(); if (!l) return '';
            if (l.startsWith('### ')) return '<h3>' + l.replace('### ','') + '</h3>';
            if (l.startsWith('## '))  return '<h2>' + l.replace('## ','')  + '</h2>';
            return '<p>' + l + '</p>';
          }).filter(Boolean).join('\n');

          finish({
            titulo: titulo2.replace(/\*\*/g,'').trim(),
            html: html + '\n<p>— <strong>' + autorAleatorio() + '</strong> | O X da Notícia</p>'
          });
        } catch(e) {
          console.log('  ❌ Parse erro: ' + e.message);
          finish(null);
        }
      });
    });

    req.on('error', async (e) => {
      clearTimeout(guard);
      console.log('  ❌ Conexão Groq: ' + e.message);
      if (tentativa < MAX) {
        await sleep(10000);
        finish(await gerarComGroq(titulo, conteudo, categoria, tentativa + 1));
      } else { finish(null); }
    });

    // Timeout interno do req (backup)
    req.setTimeout(30000, () => { req.destroy(); });
    req.write(body); req.end();
  });
}

// ─── SUPABASE ────────────────────────────────────────────────────────────────
async function jaExiste(link) {
  try {
    const { data } = await db.from(TABELA).select('id').eq('link', link).limit(1);
    return data && data.length > 0;
  } catch { return false; }
}

async function salvar(item, categoria) {
  const link = item.link || item.guid || '';
  if (!link) return false;
  if (await jaExiste(link)) { console.log('  ⏭  Já existe'); return false; }

  const tituloOriginal = limparHTML(item.title || '');
  if (!tituloOriginal) return false;
  const conteudoOriginal = limparHTML(item['content:encoded'] || item.content || item.summary || '');

  // ── Imagem ──
  const imgRss = extrairImagem(item);
  let imagem = null;
  let imgFonte = '';

  if (imgRss) {
    const imgRssLimpa = limparUrlImagem(imgRss);
    const ok = await verificarImagem(imgRssLimpa);
    if (ok) { imagem = imgRssLimpa; imgFonte = '✅ RSS'; }
    else { console.log('  ⚠️  Imagem RSS pequena, buscando OG...'); }
  }

  if (!imagem && item.link) {
    imagem = await buscarOgImage(item.link);
    if (imagem) imgFonte = '🌐 OG';
  }

  if (!imagem) {
    console.log('  ❌ Sem imagem válida, pulando');
    return false;
  }

  console.log(`  Imagem: ${imgFonte} → ${imagem.substring(0,65)}`);
  console.log(`  Gerando: ${tituloOriginal.substring(0,60)}...`);

  const resultado = await gerarComGroq(tituloOriginal, conteudoOriginal, categoria);
  if (!resultado) { console.log('  ❌ Groq falhou'); return false; }
  if (resultado.html.length < 1500) { console.log('  ❌ Conteúdo muito curto'); return false; }

  const slug = criarSlug(resultado.titulo);
  const { error } = await db.from(TABELA).insert({
    titulo:     resultado.titulo,
    conteudo:   resultado.html,
    categoria:  categoria,
    url_imagem: imagem,
    link:       link,
    criado_em:  new Date().toISOString(),
    slug:       slug,
  });

  if (error) { console.error('  ❌ Supabase: ' + error.message); return false; }
  console.log(`  ✅ OK [${categoria}] ${resultado.titulo.substring(0,65)}`);
  return true;
}

// ─── PROCESSAR FEED ──────────────────────────────────────────────────────────
async function processar(feed) {
  console.log(`\n📰 ${feed.nome} [${feed.categoria}]`);
  try {
    let r;
    try {
      r = await parser.parseURL(feed.url);
    } catch(e) {
      console.log(`  ❌ Erro ao buscar feed: ${e.message.substring(0,80)}`);
      return;
    }

    const itens = r.items || [];
    console.log(`   ${itens.length} itens`);

    let salvos = 0;
    let tentados = 0;

    for (const item of itens) {
      if (salvos >= 2) break;
      if (tentados >= 10) break;
      tentados++;

      if (await salvar(item, feed.categoria)) {
        salvos++;
        if (salvos < 2) {
          console.log('  ⏳ 8s...');
          await sleep(8000);
        }
      }
    }
    console.log(`   📊 ${salvos} publicado(s)`);
  } catch(e) {
    console.error(`  ❌ Erro: ${e.message}`);
  }
}

// ─── PRINCIPAL ────────────────────────────────────────────────────────────────
async function rodar() {
  console.log('\n========================================');
  console.log('O X da Notícia - RSS + Groq IA v4.1');
  console.log(new Date().toLocaleString('pt-BR'));
  console.log('========================================');

  for (const feed of FEEDS) {
    await processar(feed);
    console.log('  ⏳ 5s próximo feed...');
    await sleep(5000);
  }

  console.log('\n✅ Ciclo finalizado!\n');
}

async function limparAntigas() {
  const d = new Date(); d.setDate(d.getDate() - 7);
  await db.from(TABELA).delete().lt('criado_em', d.toISOString());
  console.log('🧹 Antigas removidas');
}

async function main() {
  await rodar();
  await limparAntigas();
  console.log('🏁 Execução concluída.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌ Erro fatal:', e);
    process.exit(1);
  });
